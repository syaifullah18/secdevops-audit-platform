import {
  JevDecision,
  ModelAdapterError,
  type CallOptions,
  type GenerateRequest,
  type GenerateResult,
  type HealthStatus,
  type JevQuestion,
  type ModelAdapter,
  type ModelCapabilities,
} from "@sdap/core";
import { RulesAdapterConfig } from "../types.js";

const AUTH_KEYWORDS = [
  "auth",
  "login",
  "oauth",
  "jwt",
  "token",
  "session",
  "password",
  "credential",
  "role",
  "permission",
  "principal",
  "security",
  "rbac",
  "acl",
];

const FILTER_KEYWORDS = ["filter", "interceptor", "middleware", "guard"];

const CI_IAC_KEYWORDS = [
  ".github",
  ".gitlab-ci",
  "bitbucket-pipelines",
  "jenkins",
  "pipeline",
  "workflow",
  "dockerfile",
  "docker-compose",
  "terraform",
  "k8s",
  "kubernetes",
  "helm",
  "cloudformation",
  "ansible",
  ".tf",
];

const INPUT_REACHABLE_KEYWORDS = [
  "req.",
  "request",
  "param",
  "query",
  "body",
  "endpoint",
  "route",
  "controller",
  "@getmapping",
  "@postmapping",
  "@requestmapping",
];

/**
 * Deterministic rules-based adapter for System 1 triage when Jev is not configured.
 * Uses path matching and keyword heuristics over subject context and reference.
 */
export class RulesAdapter implements ModelAdapter {
  readonly id: string;
  readonly kind = "rules" as const;
  private readonly config: RulesAdapterConfig;

  constructor(config?: Partial<RulesAdapterConfig>) {
    this.config = RulesAdapterConfig.parse(config ?? {});
    this.id = this.config.id;
  }

  capabilities(_model?: string): ModelCapabilities {
    return {
      generate: false,
      decide: true,
      toolUse: false,
      parallelSubAgents: false,
      maxContextTokens: null,
      selfHosted: true,
    };
  }

  async generate(_req: GenerateRequest, _opts?: CallOptions): Promise<GenerateResult> {
    throw new ModelAdapterError(
      "unsupported",
      this.id,
      "Rules adapter is a decision-only model; generate() is not supported",
    );
  }

  async decide(question: JevQuestion, _opts?: CallOptions): Promise<JevDecision> {
    const contextItems = question.subject.context ?? [];
    const fullText = [question.subject.ref, ...contextItems].join(" ").toLowerCase();

    const baseDecision = {
      questionId: question.id,
      key: question.key,
      source: "rules" as const,
      model: this.config.model,
      modelVersion: this.config.modelVersion,
      latencyMs: 0,
      decidedAt: new Date().toISOString(),
    };

    if (question.kind === "binary") {
      const isAuthRelevant = this.matchesAny(fullText, AUTH_KEYWORDS, FILTER_KEYWORDS);
      const isCiIacRelevant = this.matchesAny(fullText, CI_IAC_KEYWORDS);
      const isInputRelevant = this.matchesAny(fullText, INPUT_REACHABLE_KEYWORDS);

      let probability = 0.1;
      const keyLower = question.key.toLowerCase();
      const promptLower = question.prompt.toLowerCase();

      if (
        keyLower.includes("auth") ||
        keyLower.includes("security") ||
        promptLower.includes("auth") ||
        promptLower.includes("security")
      ) {
        probability = isAuthRelevant ? 0.9 : 0.1;
      } else if (
        keyLower.includes("ci") ||
        keyLower.includes("pipeline") ||
        keyLower.includes("iac") ||
        promptLower.includes("ci") ||
        promptLower.includes("pipeline") ||
        promptLower.includes("deployment")
      ) {
        probability = isCiIacRelevant ? 0.9 : 0.1;
      } else if (
        keyLower.includes("input") ||
        keyLower.includes("reach") ||
        promptLower.includes("user input") ||
        promptLower.includes("reachable")
      ) {
        probability = isInputRelevant ? 0.85 : 0.15;
      } else {
        // Generic heuristic: check if any prompt word (>3 letters) appears in the subject context
        const promptWords = promptLower
          .split(/[^a-z0-9]+/)
          .filter((w) => w.length > 3 && !["does", "this", "that", "with"].includes(w));
        const hasPromptWordMatch = promptWords.some((word) => fullText.includes(word));
        probability = hasPromptWordMatch ? 0.8 : 0.2;
      }

      return JevDecision.parse({
        ...baseDecision,
        kind: "binary",
        probability,
      });
    }

    if (question.kind === "choice") {
      const options = question.options;
      const scores: Record<string, number> = {};

      for (const opt of options) {
        const optLower = opt.toLowerCase();
        let score = 1; // baseline smoothing

        if (fullText.includes(optLower)) {
          score += 10;
        }

        // Domain-specific keyword boosts
        if (optLower.includes("auth") && this.matchesAny(fullText, AUTH_KEYWORDS)) {
          score += 8;
        }
        if (
          (optLower.includes("inject") || optLower.includes("sql") || optLower.includes("rce")) &&
          this.matchesAny(fullText, ["sql", "query", "exec", "command", "database"])
        ) {
          score += 8;
        }
        if (
          (optLower.includes("config") || optLower.includes("iac")) &&
          this.matchesAny(fullText, CI_IAC_KEYWORDS)
        ) {
          score += 8;
        }

        scores[opt] = score;
      }

      const totalScore = Object.values(scores).reduce((a, b) => a + b, 0);
      const distribution: Record<string, number> = {};

      for (const opt of options) {
        const prob = scores[opt]! / totalScore;
        distribution[opt] = Math.round(prob * 1000) / 1000;
      }

      // Ensure sum equals 1.0 for single choice by adjusting the largest entry
      if (!question.multi) {
        const currentSum = Object.values(distribution).reduce((a, b) => a + b, 0);
        const diff = Math.round((1.0 - currentSum) * 1000) / 1000;
        const highestOption = Object.entries(distribution).sort((a, b) => b[1] - a[1])[0]?.[0];
        if (highestOption && diff !== 0) {
          distribution[highestOption] =
            Math.round((distribution[highestOption]! + diff) * 1000) / 1000;
        }
      }

      return JevDecision.parse({
        ...baseDecision,
        kind: "choice",
        distribution,
      });
    }

    // Rating question
    const min = question.min;
    const max = question.max;
    const hasMatch =
      this.matchesAny(fullText, AUTH_KEYWORDS, FILTER_KEYWORDS, CI_IAC_KEYWORDS) ||
      fullText.length > 20;

    const value = hasMatch ? max : min;

    return JevDecision.parse({
      ...baseDecision,
      kind: "rating",
      value,
    });
  }

  async health(_opts?: CallOptions): Promise<HealthStatus> {
    return {
      ok: true,
      adapter: this.id,
      latencyMs: 0,
      message: null,
      checkedAt: new Date().toISOString(),
    };
  }

  private matchesAny(text: string, ...keywordLists: string[][]): boolean {
    for (const list of keywordLists) {
      for (const kw of list) {
        if (text.includes(kw)) {
          return true;
        }
      }
    }
    return false;
  }
}
