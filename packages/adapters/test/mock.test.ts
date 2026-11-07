import { describe, expect, it } from "vitest";
import { MockAdapter } from "../src/adapters/mock.js";
import {
  describeDecisionAdapterContract,
  SAMPLE_BINARY_QUESTION,
  SAMPLE_GENERATE_REQUEST,
} from "./contract.js";

describe("Mock Adapter", () => {
  describeDecisionAdapterContract({
    adapterKind: "mock",
    createAdapter: () => new MockAdapter(),
    isHttp: false,
    allowGenerate: true,
  });

  it("supports generate() deterministically", async () => {
    const adapter = new MockAdapter({ cannedText: "Custom canned output" });
    const result = await adapter.generate(SAMPLE_GENERATE_REQUEST);
    expect(result.text).toBe("Custom canned output");
    expect(result.finishReason).toBe("stop");
    expect(result.usage.costUsd).toBe(0);
  });

  it("supports scripted failures (e.g. quota_exceeded on first call)", async () => {
    const adapter = new MockAdapter();
    adapter.failNext("quota_exceeded", { message: "Quota exhausted in mock" });

    await expect(adapter.generate(SAMPLE_GENERATE_REQUEST)).rejects.toMatchObject({
      name: "ModelAdapterError",
      code: "quota_exceeded",
      message: "Quota exhausted in mock",
    });

    // Next call succeeds normally
    const result = await adapter.generate(SAMPLE_GENERATE_REQUEST);
    expect(result.text).toBeTruthy();
  });

  it("supports scripted health failure", async () => {
    const adapter = new MockAdapter();
    expect((await adapter.health()).ok).toBe(true);

    adapter.setHealthOk(false);
    const unhealthy = await adapter.health();
    expect(unhealthy.ok).toBe(false);
    expect(unhealthy.message).toContain("unhealthy");
  });

  it("supports scripted decision outputs", async () => {
    const adapter = new MockAdapter();
    adapter.setCannedDecision({
      kind: "binary",
      probability: 0.95,
      model: "scripted-model",
      modelVersion: "2.0.0",
    });

    const decision = await adapter.decide(SAMPLE_BINARY_QUESTION);
    expect(decision.kind).toBe("binary");
    if (decision.kind === "binary") {
      expect(decision.probability).toBe(0.95);
    }
  });
});
