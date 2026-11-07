import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ModelAdapterError } from "@sdap/core";
import { describe, expect, it } from "vitest";
import {
  AgentCliAdapter,
  InMemoryAdapterRegistry,
  mapCliFailureToErrorCode,
} from "../src/agent-adapter.js";
import { FakeSandboxRunner } from "../src/fakes.js";

describe("mapCliFailureToErrorCode", () => {
  it("maps timeout killedBy to timeout", () => {
    expect(mapCliFailureToErrorCode(null, "timeout", "", "")).toBe("timeout");
  });

  it("maps abort killedBy to unavailable", () => {
    expect(mapCliFailureToErrorCode(null, "abort", "", "")).toBe("unavailable");
  });

  it("identifies quota exceeded from stderr", () => {
    expect(
      mapCliFailureToErrorCode(1, null, "", "Error: quota_exceeded: Insufficient credit balance"),
    ).toBe("quota_exceeded");
  });

  it("identifies rate limit errors", () => {
    expect(mapCliFailureToErrorCode(1, null, "", "429 Too Many Requests: Rate limit reached")).toBe(
      "rate_limited",
    );
  });

  it("identifies safety blocks", () => {
    expect(mapCliFailureToErrorCode(1, null, "", "Prompt was blocked by safety policy")).toBe(
      "safety_blocked",
    );
  });

  it("identifies permission denied", () => {
    expect(mapCliFailureToErrorCode(1, null, "", "EACCES: permission denied to open file")).toBe(
      "permission_denied",
    );
  });

  it("identifies auth errors", () => {
    expect(mapCliFailureToErrorCode(1, null, "", "401 Unauthorized: Invalid API key")).toBe(
      "auth_failed",
    );
  });

  it("defaults to unknown for unrecognized error", () => {
    expect(mapCliFailureToErrorCode(1, null, "", "Some unexpected internal crash")).toBe("unknown");
  });
});

describe("AgentCliAdapter", () => {
  const fakeAgentScript = path.resolve(__dirname, "fixtures/fake-agent.cjs");

  it("executes fake agent CLI via SandboxRunner and returns result", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-exec-"));
    const sandboxRunner = new FakeSandboxRunner();
    const adapter = new AgentCliAdapter({
      id: "agent-cli:claude",
      command: process.execPath,
      argvPrefix: [process.execPath, fakeAgentScript],
      sandboxRunner,
    });

    const result = await adapter.generate({
      task: "hunt",
      model: "claude-opus-5-5",
      messages: [{ role: "user", content: "Test prompt" }],
      maxOutputTokens: 4096,
      metadata: { outputDir: tmpDir },
    });

    expect(result.adapter).toBe("agent-cli:claude");
    expect(result.model).toBe("claude-opus-5-5");
    expect(result.text).toContain("Fake agent completed successfully");
    expect(result.usage.inputTokens).toBeGreaterThan(0);
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("throws ModelAdapterError with quota_exceeded when simulated", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-quota-"));
    const sandboxRunner = new FakeSandboxRunner();
    const adapter = new AgentCliAdapter({
      id: "agent-cli:claude",
      command: process.execPath,
      argvPrefix: [process.execPath, fakeAgentScript],
      sandboxRunner,
    });

    await expect(
      adapter.generate({
        task: "hunt",
        model: "claude-opus-quota-exceeded",
        messages: [{ role: "user", content: "Test prompt" }],
        maxOutputTokens: 4096,
        metadata: { outputDir: tmpDir },
      }),
    ).rejects.toThrow(ModelAdapterError);

    try {
      await adapter.generate({
        task: "hunt",
        model: "claude-opus-quota-exceeded",
        messages: [{ role: "user", content: "Test prompt" }],
        maxOutputTokens: 4096,
        metadata: { outputDir: tmpDir },
      });
    } catch (err) {
      expect(err).toBeInstanceOf(ModelAdapterError);
      const mae = err as ModelAdapterError;
      expect(mae.code).toBe("quota_exceeded");
      expect(mae.shouldFallBack).toBe(true);
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("supports health check through sandbox runner", async () => {
    const sandboxRunner = new FakeSandboxRunner();
    const adapter = new AgentCliAdapter({
      id: "agent-cli:claude",
      command: "claude",
      sandboxRunner,
    });

    const healthOk = await adapter.health();
    expect(healthOk.ok).toBe(true);

    sandboxRunner.setPreflightStatus(false, "Runtime binary missing");
    const healthFail = await adapter.health();
    expect(healthFail.ok).toBe(false);
    expect(healthFail.message).toContain("Runtime binary missing");
  });
});

describe("InMemoryAdapterRegistry", () => {
  it("registers and resolves adapters", () => {
    const registry = new InMemoryAdapterRegistry();
    const sandboxRunner = new FakeSandboxRunner();
    const adapter = new AgentCliAdapter({
      id: "agent-cli:claude",
      command: "claude",
      sandboxRunner,
    });

    registry.register(adapter);
    expect(registry.get("agent-cli:claude")).toBe(adapter);
    expect(registry.resolve({ adapter: "agent-cli:claude", model: "m1" })).toBe(adapter);
    expect(registry.list()).toHaveLength(1);

    expect(() => registry.resolve({ adapter: "non-existent", model: "m" })).toThrow(
      ModelAdapterError,
    );
  });
});
