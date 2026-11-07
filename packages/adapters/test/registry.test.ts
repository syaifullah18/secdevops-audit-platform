import { describe, expect, it } from "vitest";
import { ModelAdapterError } from "@sdap/core";
import { MockAdapter } from "../src/adapters/mock.js";
import { configFromEnv, createAdapterRegistry } from "../src/registry.js";

describe("Adapter Registry & Config", () => {
  it("registers mock, rules, and local by default when no keys are provided", () => {
    const registry = createAdapterRegistry({});
    const ids = registry.list().map((a) => a.id);

    expect(ids).toContain("mock");
    expect(ids).toContain("rules");
    expect(ids).toContain("local");
    expect(ids).not.toContain("gemini");
    expect(ids).not.toContain("claude");
    expect(ids).not.toContain("jev");
  });

  it("registers keyed adapters when credentials are provided", () => {
    const registry = createAdapterRegistry({
      gemini: { apiKey: "gemini-key" },
      claude: { apiKey: "claude-key" },
      jev: { apiUrl: "http://localhost:3000/jev" },
      openaiCompat: { apiKey: "openai-key", baseUrl: "http://localhost:8000/v1" },
    });

    const ids = registry.list().map((a) => a.id);
    expect(ids).toContain("gemini");
    expect(ids).toContain("claude");
    expect(ids).toContain("jev");
    expect(ids).toContain("openai_compat");
  });

  it("resolves a registered model adapter successfully", () => {
    const registry = createAdapterRegistry({
      gemini: { apiKey: "key-123" },
    });

    const adapter = registry.resolve({ adapter: "gemini", model: "gemini-4-argon" });
    expect(adapter.id).toBe("gemini");
  });

  it("throws ModelAdapterError('unavailable') when resolving an unregistered adapter", () => {
    const registry = createAdapterRegistry({});

    expect(() => registry.resolve({ adapter: "claude", model: "claude-3-5-sonnet" })).toThrowError(
      /not registered/,
    );

    try {
      registry.resolve({ adapter: "claude", model: "claude-3-5-sonnet" });
      expect.unreachable();
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(ModelAdapterError);
      expect((err as ModelAdapterError).code).toBe("unavailable");
    }
  });

  it("allows registering custom adapters at runtime", () => {
    const registry = createAdapterRegistry({});
    const customMock = new MockAdapter({ id: "agent-cli:custom" });
    registry.register(customMock);

    expect(registry.get("agent-cli:custom")).toBe(customMock);
    expect(registry.resolve({ adapter: "agent-cli:custom", model: "custom-1" })).toBe(customMock);
  });

  it("derives configuration correctly from environment variables via configFromEnv()", () => {
    const env = {
      JEV_API_URL: "https://jev.internal/api",
      JEV_API_KEY: "jev-secret",
      GEMINI_API_KEY: "gemini-secret",
      ANTHROPIC_API_KEY: "anthropic-secret",
      OPENAI_API_KEY: "openai-secret",
      OPENAI_BASE_URL: "https://api.openai.com/v1",
      LOCAL_MODEL_PROVIDER: "vllm",
      LOCAL_MODEL_BASE_URL: "http://vllm-host:8000/v1",
    };

    const config = configFromEnv(env);
    const registry = createAdapterRegistry(config);

    expect(registry.get("jev")).toBeDefined();
    expect(registry.get("gemini")).toBeDefined();
    expect(registry.get("claude")).toBeDefined();
    expect(registry.get("openai_compat")).toBeDefined();
    expect(registry.get("local")).toBeDefined();
  });
});
