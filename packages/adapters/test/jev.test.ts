import { describe, expect, it } from "vitest";
import { JevAdapter } from "../src/adapters/jev.js";
import {
  createMockServer,
  describeDecisionAdapterContract,
  SAMPLE_BINARY_QUESTION,
} from "./contract.js";

describe("Jev Adapter", () => {
  describeDecisionAdapterContract({
    adapterKind: "jev",
    createAdapter: (baseUrl?: string) =>
      new JevAdapter({
        apiUrl: baseUrl ?? "http://localhost:3000/api/decide",
        apiKey: "fake-jev-key",
        model: "jev-1",
        modelVersion: "2026-11-01",
        retry: {
          maxRetries: 2,
          initialDelayMs: 10,
          maxDelayMs: 50,
          backoffFactor: 1.5,
        },
      }),
    isHttp: true,
  });

  it("throws invalid_output when Jev returns invalid decision payload", async () => {
    const server = await createMockServer();
    try {
      server.setHandler((_req, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        // Return payload without probability
        res.end(JSON.stringify({ notAProbability: "invalid" }));
      });

      const adapter = new JevAdapter({
        apiUrl: server.url,
        apiKey: "fake-key",
        retry: { maxRetries: 0, initialDelayMs: 10, maxDelayMs: 50, backoffFactor: 1 },
      });

      await expect(adapter.decide(SAMPLE_BINARY_QUESTION)).rejects.toMatchObject({
        name: "ModelAdapterError",
        code: "invalid_output",
      });
    } finally {
      await server.close();
    }
  });
});
