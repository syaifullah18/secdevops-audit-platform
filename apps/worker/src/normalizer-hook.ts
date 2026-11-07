import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  type Finding,
  Finding as FindingSchema,
  type Run,
  type Severity,
  type Store,
  type Verdict,
} from "@sdap/core";
import type { ImportFindingsFn } from "./types.js";

interface RawFinding {
  verdict?: string;
  fingerprint?: string;
  title?: string;
  description?: string;
  root_cause?: string;
  claimed_root_cause?: string;
  intended_behavior?: string;
  trace?: Array<{
    kind?: "entrypoint" | "propagation" | "sink";
    file?: string;
    line?: number;
    scope?: string;
    description?: string;
  }>;
  evidence?: Array<{
    file?: string;
    line?: number;
    description?: string;
  }>;
  severity?: {
    overall_severity?: Severity;
  };
  confidence?: {
    score?: "low" | "medium" | "high";
  };
  remediation?: {
    strategy?: string;
  };
  blockers?: string[];
  reason?: string;
}

export function createDefaultImportFindings(store: Store): ImportFindingsFn {
  return async (run: Run, artefactDir: string) => {
    const findingsJsonPath = path.join(artefactDir, "findings.json");
    let content: string;
    try {
      content = await fs.readFile(findingsJsonPath, "utf8");
    } catch {
      return [];
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      return [];
    }

    if (!Array.isArray(parsed)) {
      return [];
    }

    const now = new Date().toISOString();
    const results: Array<{ finding: Finding; isNew: boolean }> = [];

    for (const raw of parsed as RawFinding[]) {
      if (!raw || typeof raw !== "object") continue;

      const verdict: Verdict =
        raw.verdict === "confirmed" ||
        raw.verdict === "needs_validation" ||
        raw.verdict === "rejected"
          ? raw.verdict
          : "needs_validation";

      const fingerprint =
        raw.fingerprint ||
        `fp-${crypto
          .createHash("sha256")
          .update(raw.title || "finding")
          .digest("hex")
          .slice(0, 16)}`;

      const overallSeverity: Severity = raw.severity?.overall_severity ?? "medium";

      const trace =
        raw.trace && raw.trace.length > 0
          ? raw.trace.map((t) => ({
              kind: t.kind ?? ("sink" as const),
              file: t.file ?? "src/index.ts",
              line: t.line ?? 1,
              scope: t.scope ?? "defaultScope",
              description: t.description ?? "Trace step description",
            }))
          : [
              {
                kind: "sink" as const,
                file: "src/index.ts",
                line: 1,
                scope: "defaultScope",
                description: "Primary sink",
              },
            ];

      const location = { file: trace[0]!.file, line: trace[0]!.line };

      const evidence =
        raw.evidence && raw.evidence.length > 0
          ? raw.evidence.map((e) => ({
              file: e.file ?? "src/index.ts",
              line: e.line ?? 1,
              description: e.description ?? "Evidence description",
            }))
          : [
              {
                file: location.file,
                line: location.line,
                description: "Observed evidence",
              },
            ];

      const remediation = raw.remediation?.strategy
        ? { strategy: raw.remediation.strategy, codeChanges: [] }
        : null;

      const findingPayload = {
        id: crypto.randomUUID(),
        projectId: run.projectId,
        fingerprint,
        sourceRun: run.id,
        firstRun: run.id,
        attackClass: run.scope.attackClasses[0] ?? "authz",
        cwe: null,
        title: raw.title || "Untitled finding",
        description: raw.description || "No description provided.",
        rootCause: raw.root_cause || raw.claimed_root_cause || null,
        location,
        trace,
        evidence,
        verdict,
        originalSeverity: overallSeverity,
        verifiedSeverity: verdict === "confirmed" ? overallSeverity : null,
        confidence: raw.confidence?.score ?? ("medium" as const),
        status: "new" as const,
        owner: null,
        firstSeen: now,
        lastSeen: now,
        slaDue: null,
        model: { adapter: "agent-cli:claude", model: "claude-opus-5-5" },
        phase: "validate" as const,
        blockers: raw.blockers ?? [],
        rejectionReason: raw.reason ?? null,
        remediation,
        triageSuggestion: null,
        rootCauseGroup: null,
      };

      const validatedFinding = FindingSchema.parse(findingPayload);
      const upsertResult = await store.findings.upsert(validatedFinding);
      results.push(upsertResult);
    }

    return results;
  };
}
