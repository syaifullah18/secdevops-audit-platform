import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { z } from "zod";
import {
  GenerateResult,
  HealthStatus,
  JevDecision,
  type BinaryQuestion,
  type ChoiceQuestion,
  type GenerateRequest,
  type ModelAdapter,
  type RatingQuestion,
} from "@sdap/core";

export interface RecordedRequest {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- recorded arbitrary JSON body
  json?: any;
}

export type RequestHandler = (
  req: http.IncomingMessage,
  res: http.ServerResponse,
  recorded: RecordedRequest,
) => void | Promise<void>;

export interface MockHttpServer {
  url: string;
  port: number;
  requests: RecordedRequest[];
  setHandler: (handler: RequestHandler) => void;
  reset: () => void;
  close: () => Promise<void>;
}

/**
 * Creates a local mock HTTP server using `node:http` on an ephemeral port.
 */
export async function createMockServer(): Promise<MockHttpServer> {
  const requests: RecordedRequest[] = [];
  let currentHandler: RequestHandler = (_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  };

  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", async () => {
      const body = Buffer.concat(chunks).toString("utf-8");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let json: any = undefined;
      try {
        json = JSON.parse(body);
      } catch {
        // Not JSON
      }

      const recorded: RecordedRequest = {
        method: req.method ?? "GET",
        url: req.url ?? "/",
        headers: req.headers,
        body,
        json,
      };
      requests.push(recorded);

      try {
        await currentHandler(req, res, recorded);
      } catch (err: unknown) {
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end(String(err));
      }
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address() as AddressInfo;
  const port = address.port;
  const url = `http://127.0.0.1:${port}`;

  return {
    url,
    port,
    requests,
    setHandler: (handler: RequestHandler) => {
      currentHandler = handler;
    },
    reset: () => {
      requests.length = 0;
    },
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}

export const SAMPLE_BINARY_QUESTION: z.infer<typeof BinaryQuestion> = {
  id: "00000000-0000-4000-8000-000000000001",
  key: "change.touches_authz",
  kind: "binary",
  prompt: "Does this change touch authorization or authentication?",
  subject: {
    type: "diff",
    ref: "a1b2c3d..e4f5g6h",
    context: ["src/auth/jwt-filter.ts", "class JwtSecurityInterceptor"],
  },
  projectId: null,
};

export const SAMPLE_CHOICE_QUESTION: z.infer<typeof ChoiceQuestion> = {
  id: "00000000-0000-4000-8000-000000000002",
  key: "routing.attack_class",
  kind: "choice",
  prompt: "Which attack classes are relevant to this change?",
  options: ["authz", "injection", "config", "supply_chain"],
  multi: false,
  subject: {
    type: "diff",
    ref: "feat/oauth",
    context: ["src/security/OAuth2Config.java"],
  },
  projectId: null,
};

export const SAMPLE_RATING_QUESTION: z.infer<typeof RatingQuestion> = {
  id: "00000000-0000-4000-8000-000000000003",
  key: "candidate.risk_score",
  kind: "rating",
  prompt: "Rate the risk of this candidate finding from 1 to 5.",
  min: 1,
  max: 5,
  subject: {
    type: "candidate",
    ref: "cand-123",
    context: ["Unauthenticated endpoint exposing internal metrics"],
  },
  projectId: null,
};

export const SAMPLE_GENERATE_REQUEST: GenerateRequest = {
  task: "recon",
  model: "test-model",
  messages: [
    { role: "system", content: "You are a security auditor." },
    { role: "user", content: "Review this endpoint for auth issues." },
  ],
  maxOutputTokens: 1024,
  temperature: 0.2,
  metadata: {},
};

export interface GenerativeContractOptions {
  adapterKind: string;
  createAdapter: (baseUrl: string) => ModelAdapter;
  modelName: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mockHappyResponse: any;
  expectedInputTokens: number;
  expectedOutputTokens: number;
  expectedCostUsd: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mockSafetyBlockedResponse?: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mockModelsResponse?: any;
}

/**
 * Shared contract test suite for generative adapters (Gemini, Claude, OpenAI-compat, Local, Mock).
 * Validates:
 * - Happy path generation & schema compliance
 * - Token usage accounting & price table cost calculation
 * - HTTP 429 error mapping (rate_limited vs quota_exceeded)
 * - HTTP 401 & 403 error mapping (auth_failed / permission_denied)
 * - HTTP 5xx error mapping (unavailable)
 * - Safety blocks (safety_blocked)
 * - Retry then success (recovers from initial 429/503)
 * - Timeout via AbortSignal
 * - Health check reporting
 * - Rejecting decide() as unsupported
 */
export function describeGenerativeAdapterContract(options: GenerativeContractOptions) {
  const {
    adapterKind,
    createAdapter,
    modelName,
    mockHappyResponse,
    expectedInputTokens,
    expectedOutputTokens,
    expectedCostUsd,
    mockSafetyBlockedResponse,
    mockModelsResponse,
  } = options;

  describe(`Generative Adapter Contract: [${adapterKind}]`, () => {
    let server: MockHttpServer;
    let adapter: ModelAdapter;

    beforeAll(async () => {
      server = await createMockServer();
      adapter = createAdapter(server.url);
    });

    afterAll(async () => {
      await server.close();
    });

    beforeEach(() => {
      server.reset();
    });

    it("satisfies ModelAdapter interface capabilities", () => {
      const caps = adapter.capabilities(modelName);
      expect(caps.generate).toBe(true);
      expect(caps.decide).toBe(false);
      expect(caps.toolUse).toBe(true);
      expect(caps.parallelSubAgents).toBe(true);
    });

    it("executes happy path generation with usage and cost accounting", async () => {
      server.setHandler((_req, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(mockHappyResponse));
      });

      const req = { ...SAMPLE_GENERATE_REQUEST, model: modelName };
      const result = await adapter.generate(req);

      expect(GenerateResult.safeParse(result).success).toBe(true);
      expect(result.adapter).toBe(adapter.id);
      expect(result.model).toBe(modelName);
      expect(result.text).toBeTruthy();
      expect(result.usage.inputTokens).toBe(expectedInputTokens);
      expect(result.usage.outputTokens).toBe(expectedOutputTokens);
      expect(result.usage.costUsd).toBeCloseTo(expectedCostUsd, 4);
    });

    it("maps HTTP 429 with standard body to rate_limited and extracts retryAfterMs", async () => {
      server.setHandler((_req, res) => {
        res.writeHead(429, {
          "Content-Type": "application/json",
          "Retry-After": "3",
        });
        res.end(JSON.stringify({ error: { message: "Too many requests. Please slow down." } }));
      });

      const req = { ...SAMPLE_GENERATE_REQUEST, model: modelName };
      await expect(adapter.generate(req)).rejects.toMatchObject({
        name: "ModelAdapterError",
        code: "rate_limited",
        retryAfterMs: 3000,
      });
    });

    it("maps HTTP 429 with quota message to quota_exceeded", async () => {
      server.setHandler((_req, res) => {
        res.writeHead(429, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: {
              message: "You have exceeded your current quota. Please check your billing plan.",
            },
          }),
        );
      });

      const req = { ...SAMPLE_GENERATE_REQUEST, model: modelName };
      await expect(adapter.generate(req)).rejects.toMatchObject({
        name: "ModelAdapterError",
        code: "quota_exceeded",
      });
    });

    it("maps HTTP 401 to auth_failed", async () => {
      server.setHandler((_req, res) => {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { message: "Invalid API key provided" } }));
      });

      const req = { ...SAMPLE_GENERATE_REQUEST, model: modelName };
      await expect(adapter.generate(req)).rejects.toMatchObject({
        name: "ModelAdapterError",
        code: "auth_failed",
      });
    });

    it("maps HTTP 403 to permission_denied", async () => {
      server.setHandler((_req, res) => {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { message: "Access forbidden" } }));
      });

      const req = { ...SAMPLE_GENERATE_REQUEST, model: modelName };
      await expect(adapter.generate(req)).rejects.toMatchObject({
        name: "ModelAdapterError",
        code: "permission_denied",
      });
    });

    it("maps HTTP 5xx to unavailable", async () => {
      server.setHandler((_req, res) => {
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { message: "Service temporarily overloaded" } }));
      });

      const req = { ...SAMPLE_GENERATE_REQUEST, model: modelName };
      await expect(adapter.generate(req)).rejects.toMatchObject({
        name: "ModelAdapterError",
        code: "unavailable",
      });
    });

    if (mockSafetyBlockedResponse) {
      it("maps safety blocked responses to safety_blocked", async () => {
        server.setHandler((_req, res) => {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(mockSafetyBlockedResponse));
        });

        const req = { ...SAMPLE_GENERATE_REQUEST, model: modelName };
        await expect(adapter.generate(req)).rejects.toMatchObject({
          name: "ModelAdapterError",
          code: "safety_blocked",
        });
      });
    }

    it("retries on temporary failure and succeeds", async () => {
      let callCount = 0;
      server.setHandler((_req, res) => {
        callCount++;
        if (callCount === 1) {
          res.writeHead(503, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Unavailable on first attempt" }));
        } else {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(mockHappyResponse));
        }
      });

      const req = { ...SAMPLE_GENERATE_REQUEST, model: modelName };
      const result = await adapter.generate(req);

      expect(callCount).toBe(2);
      expect(result.text).toBeTruthy();
    });

    it("aborts when AbortSignal is cancelled", async () => {
      server.setHandler(async (_req, res) => {
        await new Promise((resolve) => setTimeout(resolve, 500));
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(mockHappyResponse));
      });

      const controller = new AbortController();
      controller.abort();

      const req = { ...SAMPLE_GENERATE_REQUEST, model: modelName };
      await expect(adapter.generate(req, { signal: controller.signal })).rejects.toMatchObject({
        name: "ModelAdapterError",
        code: "timeout",
      });
    });

    it("reports healthy status on health() check", async () => {
      server.setHandler((_req, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(mockModelsResponse ?? { ok: true, models: [modelName] }));
      });

      const health = await adapter.health();
      expect(HealthStatus.safeParse(health).success).toBe(true);
      expect(health.ok).toBe(true);
      expect(health.adapter).toBe(adapter.id);
    });

    it("throws unsupported from decide()", async () => {
      await expect(adapter.decide(SAMPLE_BINARY_QUESTION)).rejects.toMatchObject({
        name: "ModelAdapterError",
        code: "unsupported",
      });
    });
  });
}

export interface DecisionContractOptions {
  adapterKind: string;
  createAdapter: (baseUrl?: string) => ModelAdapter;
  isHttp?: boolean;
  allowGenerate?: boolean;
}

/**
 * Shared contract test suite for decision adapters (Jev, Rules, Mock).
 * Validates:
 * - Happy path for binary, choice, and rating questions
 * - Invariant fields: questionId, key, source, model, modelVersion, latencyMs, decidedAt
 * - Minimal data egress for Jev (only prompt and context sent over HTTP)
 * - Health check reporting
 * - Rejecting generate() as unsupported
 */
export function describeDecisionAdapterContract(options: DecisionContractOptions) {
  const { adapterKind, createAdapter, isHttp = false, allowGenerate = false } = options;

  describe(`Decision Adapter Contract: [${adapterKind}]`, () => {
    let server: MockHttpServer | null = null;
    let adapter: ModelAdapter;

    beforeAll(async () => {
      if (isHttp) {
        server = await createMockServer();
        adapter = createAdapter(server.url);
      } else {
        adapter = createAdapter();
      }
    });

    afterAll(async () => {
      if (server) {
        await server.close();
      }
    });

    beforeEach(() => {
      if (server) {
        server.reset();
      }
    });

    it("satisfies ModelAdapter interface capabilities", () => {
      const caps = adapter.capabilities();
      if (!allowGenerate) {
        expect(caps.generate).toBe(false);
      }
      expect(caps.decide).toBe(true);
    });

    it("decides binary questions and produces valid JevDecision", async () => {
      if (server) {
        server.setHandler((_req, res) => {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              probability: 0.88,
              model: "jev-1",
              modelVersion: "2026-11-01",
            }),
          );
        });
      }

      const decision = await adapter.decide(SAMPLE_BINARY_QUESTION);
      expect(JevDecision.safeParse(decision).success).toBe(true);
      expect(decision.kind).toBe("binary");
      expect(decision.questionId).toBe(SAMPLE_BINARY_QUESTION.id);
      expect(decision.key).toBe(SAMPLE_BINARY_QUESTION.key);
      if (decision.kind === "binary") {
        expect(decision.probability).toBeGreaterThanOrEqual(0);
        expect(decision.probability).toBeLessThanOrEqual(1);
      }
    });

    it("decides choice questions and produces valid JevDecision", async () => {
      if (server) {
        server.setHandler((_req, res) => {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              distribution: { authz: 0.7, injection: 0.1, config: 0.1, supply_chain: 0.1 },
              model: "jev-1",
              modelVersion: "2026-11-01",
            }),
          );
        });
      }

      const decision = await adapter.decide(SAMPLE_CHOICE_QUESTION);
      expect(JevDecision.safeParse(decision).success).toBe(true);
      expect(decision.kind).toBe("choice");
      expect(decision.questionId).toBe(SAMPLE_CHOICE_QUESTION.id);
      if (decision.kind === "choice") {
        for (const opt of SAMPLE_CHOICE_QUESTION.options) {
          expect(decision.distribution[opt]).toBeDefined();
        }
      }
    });

    it("decides rating questions and produces valid JevDecision", async () => {
      if (server) {
        server.setHandler((_req, res) => {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              value: 4,
              model: "jev-1",
              modelVersion: "2026-11-01",
            }),
          );
        });
      }

      const decision = await adapter.decide(SAMPLE_RATING_QUESTION);
      expect(JevDecision.safeParse(decision).success).toBe(true);
      expect(decision.kind).toBe("rating");
      expect(decision.questionId).toBe(SAMPLE_RATING_QUESTION.id);
      if (decision.kind === "rating") {
        expect(decision.value).toBeGreaterThanOrEqual(SAMPLE_RATING_QUESTION.min);
        expect(decision.value).toBeLessThanOrEqual(SAMPLE_RATING_QUESTION.max);
      }
    });

    if (isHttp) {
      it("sends ONLY prompt and context in HTTP request body (strict minimal egress)", async () => {
        if (!server) return;

        server.setHandler((_req, res) => {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ probability: 0.75 }));
        });

        await adapter.decide(SAMPLE_BINARY_QUESTION);

        expect(server.requests.length).toBe(1);
        const reqJson = server.requests[0]?.json;
        expect(reqJson).toBeDefined();

        // Exact keys check: prompt and context only!
        const bodyKeys = Object.keys(reqJson).sort();
        expect(bodyKeys).toEqual(["context", "prompt"]);
        expect(reqJson.prompt).toBe(SAMPLE_BINARY_QUESTION.prompt);
        expect(reqJson.context).toEqual(SAMPLE_BINARY_QUESTION.subject.context);
      });

      it("maps HTTP 429 to rate_limited", async () => {
        if (!server) return;
        server.setHandler((_req, res) => {
          res.writeHead(429, { "Content-Type": "application/json", "Retry-After": "2" });
          res.end(JSON.stringify({ error: "Rate limit exceeded" }));
        });

        await expect(adapter.decide(SAMPLE_BINARY_QUESTION)).rejects.toMatchObject({
          name: "ModelAdapterError",
          code: "rate_limited",
          retryAfterMs: 2000,
        });
      });

      it("maps HTTP 401 to auth_failed", async () => {
        if (!server) return;
        server.setHandler((_req, res) => {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Unauthorized" }));
        });

        await expect(adapter.decide(SAMPLE_BINARY_QUESTION)).rejects.toMatchObject({
          name: "ModelAdapterError",
          code: "auth_failed",
        });
      });
    }

    it("checks health", async () => {
      if (server) {
        server.setHandler((_req, res) => {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
        });
      }

      const health = await adapter.health();
      expect(HealthStatus.safeParse(health).success).toBe(true);
      expect(health.ok).toBe(true);
      expect(health.adapter).toBe(adapter.id);
    });

    if (!allowGenerate) {
      it("throws unsupported from generate()", async () => {
        await expect(
          adapter.generate({ ...SAMPLE_GENERATE_REQUEST, model: "any" }),
        ).rejects.toMatchObject({
          name: "ModelAdapterError",
          code: "unsupported",
        });
      });
    }
  });
}
