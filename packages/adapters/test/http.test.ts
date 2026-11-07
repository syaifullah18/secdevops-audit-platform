import { describe, expect, it } from "vitest";
import { isRetryableCode, mapHttpStatusToErrorCode, parseRetryAfter } from "../src/http.js";

describe("HTTP Error Mapping and Retry-After Parsing", () => {
  it("parses integer seconds from Retry-After", () => {
    expect(parseRetryAfter("30")).toBe(30_000);
    expect(parseRetryAfter("0")).toBe(0);
    expect(parseRetryAfter(null)).toBeNull();
    expect(parseRetryAfter("")).toBeNull();
  });

  it("parses HTTP-Date from Retry-After", () => {
    const futureDate = new Date(Date.now() + 60_000).toUTCString();
    const parsed = parseRetryAfter(futureDate);
    expect(parsed).not.toBeNull();
    expect(parsed!).toBeGreaterThan(0);
    expect(parsed!).toBeLessThanOrEqual(65_000);
  });

  it("maps 429 status correctly based on response body", () => {
    expect(mapHttpStatusToErrorCode(429, "Rate limit reached. Try again later.")).toBe(
      "rate_limited",
    );
    expect(mapHttpStatusToErrorCode(429, "You exceeded your current quota.")).toBe(
      "quota_exceeded",
    );
    expect(mapHttpStatusToErrorCode(429, "insufficient_quota for project")).toBe("quota_exceeded");
    expect(mapHttpStatusToErrorCode(429, "Resource has been exhausted (e.g. check quota).")).toBe(
      "quota_exceeded",
    );
  });

  it("maps 401 and 403 to auth_failed and permission_denied", () => {
    expect(mapHttpStatusToErrorCode(401, "Unauthorized token")).toBe("auth_failed");
    expect(mapHttpStatusToErrorCode(403, "Forbidden resource")).toBe("permission_denied");
  });

  it("maps 5xx status codes to unavailable", () => {
    expect(mapHttpStatusToErrorCode(500, "Internal Server Error")).toBe("unavailable");
    expect(mapHttpStatusToErrorCode(502, "Bad Gateway")).toBe("unavailable");
    expect(mapHttpStatusToErrorCode(503, "Service Unavailable")).toBe("unavailable");
    expect(mapHttpStatusToErrorCode(504, "Gateway Timeout")).toBe("unavailable");
  });

  it("maps safety keywords in error bodies to safety_blocked", () => {
    expect(
      mapHttpStatusToErrorCode(400, "Content filter blocked output due to safety policies"),
    ).toBe("safety_blocked");
    expect(mapHttpStatusToErrorCode(400, "Harmful content detected by moderation API")).toBe(
      "safety_blocked",
    );
  });

  it("identifies retryable error codes", () => {
    expect(isRetryableCode("rate_limited")).toBe(true);
    expect(isRetryableCode("timeout")).toBe(true);
    expect(isRetryableCode("unavailable")).toBe(true);

    expect(isRetryableCode("quota_exceeded")).toBe(false);
    expect(isRetryableCode("auth_failed")).toBe(false);
    expect(isRetryableCode("permission_denied")).toBe(false);
    expect(isRetryableCode("safety_blocked")).toBe(false);
    expect(isRetryableCode("unsupported")).toBe(false);
  });

  it("handles retry-after-ms header in executeHttpRequest", async () => {
    const { createMockServer } = await import("./contract.js");
    const { executeHttpRequest } = await import("../src/http.js");
    const server = await createMockServer();

    try {
      server.setHandler((_req, res) => {
        res.writeHead(429, {
          "Content-Type": "application/json",
          "retry-after-ms": "150",
        });
        res.end(JSON.stringify({ error: "Rate limit exceeded" }));
      });

      await expect(
        executeHttpRequest({
          adapterId: "test-adapter",
          url: server.url,
          retryConfig: { maxRetries: 0, initialDelayMs: 10, maxDelayMs: 50, backoffFactor: 1 },
          defaultTimeoutMs: 1000,
        }),
      ).rejects.toMatchObject({
        name: "ModelAdapterError",
        code: "rate_limited",
        retryAfterMs: 150,
      });
    } finally {
      await server.close();
    }
  });

  it("retries on timeout if attempt < maxRetries and caller has not aborted", async () => {
    const { createMockServer } = await import("./contract.js");
    const { executeHttpRequest } = await import("../src/http.js");
    const server = await createMockServer();

    let attempts = 0;
    try {
      server.setHandler(async (req, res) => {
        attempts++;
        if (attempts === 1) {
          // Never answer the first attempt: it can only end by the client-side timeout.
          // Waiting for the client to abort keeps this independent of machine load.
          await new Promise<void>((resolve) => req.on("close", () => resolve()));
          res.destroy();
        } else {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, attempt: attempts }));
        }
      });

      const response = await executeHttpRequest({
        adapterId: "test-adapter",
        url: server.url,
        retryConfig: { maxRetries: 1, initialDelayMs: 10, maxDelayMs: 50, backoffFactor: 1 },
        // Attempt 1 hangs and times out; attempt 2 answers at once, well inside the margin.
        defaultTimeoutMs: 250,
      });

      expect(attempts).toBe(2);
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.attempt).toBe(2);
    } finally {
      await server.close();
    }
  });
});
