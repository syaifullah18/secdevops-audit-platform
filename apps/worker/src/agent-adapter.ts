import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
  type AdapterKind,
  type AdapterRegistry,
  type CallOptions,
  type GenerateRequest,
  type GenerateResult,
  type HealthStatus,
  type JevDecision,
  type JevQuestion,
  type ModelAdapter,
  type ModelCapabilities,
  ModelAdapterError,
  type ModelErrorCode,
  type ModelRef,
  type SandboxPolicy,
  type SandboxRunner,
  type Usage,
} from "@sdap/core";

export function mapCliFailureToErrorCode(
  exitCode: number | null,
  killedBy: "timeout" | "abort" | "oom" | null,
  stdout: string,
  stderr: string,
): ModelErrorCode {
  if (killedBy === "timeout") return "timeout";
  if (killedBy === "abort") return "unavailable";

  const combined = `${stderr}\n${stdout}`.toLowerCase();

  if (
    combined.includes("quota") ||
    combined.includes("credit balance") ||
    combined.includes("insufficient_quota") ||
    combined.includes("exceeded your current quota")
  ) {
    return "quota_exceeded";
  }

  if (
    combined.includes("rate_limit") ||
    combined.includes("429") ||
    combined.includes("too many requests") ||
    combined.includes("resource_exhausted")
  ) {
    return "rate_limited";
  }

  if (
    combined.includes("safety") ||
    combined.includes("content policy") ||
    combined.includes("blocked") ||
    combined.includes("harmful")
  ) {
    return "safety_blocked";
  }

  if (
    combined.includes("auth") ||
    combined.includes("401") ||
    combined.includes("unauthorized") ||
    combined.includes("api key") ||
    combined.includes("invalid key")
  ) {
    return "auth_failed";
  }

  if (
    combined.includes("permission denied") ||
    combined.includes("eacces") ||
    combined.includes("forbidden") ||
    combined.includes("403")
  ) {
    return "permission_denied";
  }

  if (
    combined.includes("unavailable") ||
    combined.includes("503") ||
    combined.includes("service unavailable") ||
    combined.includes("bad gateway")
  ) {
    return "unavailable";
  }

  if (
    combined.includes("invalid_output") ||
    combined.includes("invalid json") ||
    combined.includes("parse error")
  ) {
    return "invalid_output";
  }

  return "unknown";
}

export interface AgentCliAdapterOptions {
  id: string; // e.g. "agent-cli:claude" or "agent-cli:agy"
  kind?: AdapterKind | (string & {});
  command: string; // e.g. "claude" or "agy"
  argvPrefix?: readonly string[];
  sandboxRunner: SandboxRunner;
  defaultPolicy?: Partial<SandboxPolicy>;
}

export class AgentCliAdapter implements ModelAdapter {
  readonly id: string;
  readonly kind: AdapterKind | (string & {});
  private readonly command: string;
  private readonly argvPrefix?: readonly string[];
  private readonly sandboxRunner: SandboxRunner;
  private readonly defaultPolicy?: Partial<SandboxPolicy>;

  constructor(options: AgentCliAdapterOptions) {
    this.id = options.id;
    this.kind = options.kind ?? (options.id.includes("claude") ? "claude" : "gemini");
    this.command = options.command;
    this.argvPrefix = options.argvPrefix;
    this.sandboxRunner = options.sandboxRunner;
    this.defaultPolicy = options.defaultPolicy;
  }

  capabilities(_model?: string): ModelCapabilities {
    return {
      generate: true,
      decide: false,
      toolUse: true,
      parallelSubAgents: true,
      maxContextTokens: 200_000,
      selfHosted: false,
    };
  }

  async health(_opts?: CallOptions): Promise<HealthStatus> {
    try {
      const runnerHealth = await this.sandboxRunner.preflight();
      return {
        ok: runnerHealth.ok,
        adapter: this.id,
        latencyMs: runnerHealth.ok ? 1 : null,
        message: runnerHealth.message,
        checkedAt: new Date().toISOString(),
      };
    } catch (err) {
      return {
        ok: false,
        adapter: this.id,
        latencyMs: null,
        message: err instanceof Error ? err.message : String(err),
        checkedAt: new Date().toISOString(),
      };
    }
  }

  async decide(_question: JevQuestion, _opts?: CallOptions): Promise<JevDecision> {
    throw new ModelAdapterError(
      "unsupported",
      this.id,
      `System 1 decide() is not supported by ${this.id}`,
    );
  }

  async generate(req: GenerateRequest, opts?: CallOptions): Promise<GenerateResult> {
    const prompt = req.messages.map((m) => m.content).join("\n\n");
    const targetDir = req.metadata.targetDir || this.defaultPolicy?.targetDir || process.cwd();
    const outputDir =
      req.metadata.outputDir || this.defaultPolicy?.outputDir || path.resolve(process.cwd(), "out");

    // Agents see the fixed mount points when isolated, and the real directories when not.
    const isolated = this.sandboxRunner.enforcing;
    const seenTarget = isolated ? "/target" : targetDir;
    const seenOutput = isolated ? "/out" : outputDir;
    const skillDir = req.metadata.skillDir;
    const seenSkill = skillDir ? (isolated ? "/skill" : skillDir) : undefined;

    const isClaudeCli = !this.argvPrefix && this.id.includes("claude");
    const argv: string[] = this.argvPrefix
      ? [...this.argvPrefix, "-p", prompt, "--model", req.model]
      : [this.command, "-p", prompt, "--model", req.model];
    if (isClaudeCli) {
      argv.push(
        "--output-format",
        "json",
        // File tools only: no shell, no network, and edits are pre-approved because nobody is
        // there to answer a prompt in a headless run.
        "--allowedTools",
        "Read,Grep,Glob,Write,Edit",
        "--permission-mode",
        "acceptEdits",
        "--add-dir",
        seenOutput,
        ...(seenSkill ? ["--add-dir", seenSkill] : []),
      );
    }

    const home = isolated ? "/tmp" : path.join(outputDir, ".agent-home");
    if (isClaudeCli && !isolated) await mkdir(home, { recursive: true });
    const passthrough: Record<string, string> = {};
    if (isClaudeCli) {
      for (const k of ["ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL", "ANTHROPIC_AUTH_TOKEN"]) {
        const v = process.env[k];
        if (v) passthrough[k] = v;
      }
      passthrough["HOME"] = home;
      passthrough["DISABLE_TELEMETRY"] = "1";
      passthrough["DISABLE_AUTOUPDATER"] = "1";
      passthrough["CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC"] = "1";
    }

    const policy: SandboxPolicy = {
      egressAllowlist:
        this.defaultPolicy?.egressAllowlist ?? (isClaudeCli ? ["api.anthropic.com"] : []),
      env: {
        ...passthrough,
        ...(this.defaultPolicy?.env ?? {}),
        SDAP_OUTPUT_DIR: seenOutput,
        SDAP_TARGET_DIR: seenTarget,
        ...(req.metadata.env ? JSON.parse(req.metadata.env) : {}),
      },
      cpus: this.defaultPolicy?.cpus ?? 2,
      memoryMb: this.defaultPolicy?.memoryMb ?? 4096,
      timeoutSec: this.defaultPolicy?.timeoutSec ?? 3600,
      targetDir,
      outputDir,
      readOnlyMounts:
        this.defaultPolicy?.readOnlyMounts ??
        (isolated && skillDir ? [{ hostPath: skillDir, containerPath: "/skill" }] : []),
    };

    const execResult = await this.sandboxRunner.exec({
      argv,
      // A path inside the sandbox: runners map /target to the real directory.
      cwd: "/target",
      policy,
      signal: opts?.signal,
    });

    if (execResult.killedBy === "timeout") {
      throw new ModelAdapterError("timeout", this.id, "Agent CLI execution timed out", {
        retryAfterMs: 1000,
      });
    }

    if (execResult.killedBy === "abort") {
      throw new ModelAdapterError("unavailable", this.id, "Agent CLI execution was aborted");
    }

    if (execResult.exitCode !== 0) {
      const code = mapCliFailureToErrorCode(
        execResult.exitCode,
        execResult.killedBy,
        execResult.stdout,
        execResult.stderr,
      );
      throw new ModelAdapterError(
        code,
        this.id,
        execResult.stderr ||
          execResult.stdout ||
          `Agent CLI exited with code ${execResult.exitCode}`,
        { retryAfterMs: code === "rate_limited" ? 1000 : null },
      );
    }

    const parsed = isClaudeCli ? parseClaudeJson(execResult.stdout) : null;
    if (parsed?.isError) {
      throw new ModelAdapterError(
        mapCliFailureToErrorCode(0, null, parsed.text, ""),
        this.id,
        parsed.text || "Agent reported an error",
      );
    }
    const usage = parsed ? parsed.usage : parseUsage(execResult.stdout);

    return {
      text: parsed ? parsed.text : execResult.stdout,
      adapter: this.id,
      model: req.model,
      finishReason: "stop",
      usage,
    };
  }
}

interface ClaudeResult {
  text: string;
  isError: boolean;
  usage: Usage;
}

/** Reads `claude -p --output-format json`: the answer plus the tokens and cost it really used. */
export function parseClaudeJson(stdout: string): ClaudeResult | null {
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(stdout) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (typeof j !== "object" || j === null) return null;
  const u = (j["usage"] ?? {}) as Record<string, unknown>;
  const n = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  return {
    text: typeof j["result"] === "string" ? j["result"] : "",
    isError: j["is_error"] === true,
    usage: {
      inputTokens:
        n(u["input_tokens"]) +
        n(u["cache_creation_input_tokens"]) +
        n(u["cache_read_input_tokens"]),
      outputTokens: n(u["output_tokens"]),
      costUsd: n(j["total_cost_usd"]),
    },
  };
}

function parseUsage(stdout: string): Usage {
  const match = stdout.match(/Tokens:\s*(\d+)\s*input,\s*(\d+)\s*output/i);
  if (match && match[1] && match[2]) {
    const inputTokens = parseInt(match[1], 10);
    const outputTokens = parseInt(match[2], 10);
    return {
      inputTokens,
      outputTokens,
      costUsd: 0,
    };
  }
  return {
    inputTokens: 100,
    outputTokens: 50,
    costUsd: 0,
  };
}

export class InMemoryAdapterRegistry implements AdapterRegistry {
  private readonly adapters = new Map<string, ModelAdapter>();

  register(adapter: ModelAdapter): void {
    this.adapters.set(adapter.id, adapter);
  }

  get(id: string): ModelAdapter | undefined {
    return this.adapters.get(id);
  }

  resolve(ref: ModelRef): ModelAdapter {
    const adapter = this.adapters.get(ref.adapter);
    if (!adapter) {
      throw new ModelAdapterError(
        "unavailable",
        ref.adapter,
        `Adapter not registered in registry: ${ref.adapter}`,
      );
    }
    return adapter;
  }

  list(): ModelAdapter[] {
    return Array.from(this.adapters.values());
  }
}
