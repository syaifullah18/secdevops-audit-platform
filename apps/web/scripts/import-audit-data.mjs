#!/usr/bin/env node
/**
 * Convert real security-audit-skill run folders into mock-API data for the dashboard.
 *
 *   node scripts/import-audit-data.mjs /path/to/security-audit-skill
 *
 * Each child folder holding run-1/ becomes one project. The output is written to
 * src/api/audit-data.generated.json, which is git-ignored on purpose: it describes real,
 * possibly unfixed vulnerabilities and must never be committed to this open-source repo.
 * Use it with `VITE_MOCK_DATASET=audit pnpm dev`.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = process.argv[2];
if (!root || !existsSync(root)) {
  console.error("usage: import-audit-data.mjs <audit-data-dir>");
  process.exit(1);
}

const uuid = (key) => {
  const h = createHash("sha1").update(key).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
const json = (p) => JSON.parse(readFileSync(p, "utf8"));
const slugOf = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
const clip = (s, n) => (s && s.length > n ? `${s.slice(0, n - 1)}…` : s || "");
const SEV = {
  critical: "critical",
  high: "high",
  medium: "medium",
  low: "low",
  info: "informational",
  informational: "informational",
};
const SLA = { critical: 7, high: 30, medium: 90, low: 180 };
const VERDICT = {
  CONFIRMED: "confirmed",
  PLAUSIBLE: "needs_validation",
  PARTIAL: "needs_validation",
  REFUTED: "rejected",
  REJECTED: "rejected",
};

const CWE_CLASS = [
  ["authz", [639, 862, 863, 285, 284, 269, 915]],
  ["authn", [287, 306, 384, 307, 613, 640, 603]],
  ["injection", [89, 78, 94, 917, 611, 643, 90, 564]],
  ["client_side", [79, 352, 601, 1021, 80]],
  ["secrets", [798, 259, 321, 532, 312, 256, 522]],
  ["crypto", [327, 328, 916, 759, 330, 326]],
  ["supply_chain", [1035, 1104, 937, 829]],
  ["resource_exhaustion", [400, 770, 405, 1333]],
  ["config", [16, 1004, 614, 552, 489, 1188]],
  ["data_isolation", [200, 201, 359, 497]],
];
const HUNTER_CLASS = {
  AUTHN: "authn",
  AUTHZ: "authz",
  INJECT: "injection",
  CONFIG: "config",
  CLIENT: "client_side",
};
const attackClassOf = (cwe, hunterId) => {
  const n = Number(String(cwe || "").replace(/\D/g, ""));
  for (const [cls, list] of CWE_CLASS) if (list.includes(n)) return cls;
  return HUNTER_CLASS[String(hunterId || "").split("-")[0]] ?? "other";
};
const adapterOf = (m) => (/claude/i.test(m) ? "anthropic" : /gemini/i.test(m) ? "google" : "other");
const modelOf = (m) =>
  String(m || "unknown")
    .replace(/\s*\(.*\)\s*$/, "")
    .trim() || "unknown";

/** "src/a/B.java:380-440: text" -> evidence item; lines without file:line are skipped. */
const parseEvidence = (lines) =>
  lines
    .map((l) => /^([\w./@+-]+\.[\w]+):(\d+)(?:[-,]\d+)*[:\s]+(.*)$/.exec(String(l).trim()))
    .filter(Boolean)
    .map((m) => ({ file: m[1], line: Number(m[2]), description: clip(m[3] || m[1], 300) }));

const slugs = [];
const out = {
  projects: [],
  runs: [],
  slices: [],
  findings: [],
  generatedAt: new Date().toISOString(),
};

for (const dir of readdirSync(root).sort()) {
  const runDir = join(root, dir, "run-1");
  if (!existsSync(runDir)) continue;
  const slug = slugOf(dir);
  slugs.push(slug);
  const projectId = uuid(`project:${slug}`);
  const runId = uuid(`run:${slug}:1`);
  const meta = existsSync(join(runDir, "run-metadata.json"))
    ? json(join(runDir, "run-metadata.json"))
    : {};
  const ledger = existsSync(join(runDir, "coverage-ledger.json"))
    ? json(join(runDir, "coverage-ledger.json"))
    : {};
  const day = "2026-11-07";
  const t = (hhmm) => `${day}T${hhmm}:00Z`;

  // ---- findings ----------------------------------------------------------------------------
  const raw = [];
  if (existsSync(join(runDir, "findings.json"))) {
    for (const f of json(join(runDir, "findings.json")).findings) {
      const ev = parseEvidence(f.evidence ?? []);
      raw.push({
        key: f.id ?? f.hunter_id,
        title: f.title,
        cwe: f.cwe,
        file: f.file,
        line: f.line,
        verdict: VERDICT[f.verdict],
        original: SEV[f.hunter_severity] ?? null,
        verified: SEV[f.severity] ?? null,
        description: f.reasoning,
        rootCause: null,
        evidence: ev,
        flow: f.hunter_data_flow,
        reach: f.reachability,
        confidence: null,
        fix: f.fix,
        models: f.hunter_models ?? [],
        verifier: f.verifier_model,
        hunterId: f.hunter_id,
        owner: null,
        blockers: (f.refutation_attempts ?? []).filter((r) =>
          /^did not|^could not|^cannot/i.test(r),
        ),
        reason: f.reasoning,
      });
    }
  } else if (existsSync(join(runDir, "findings-verified.json"))) {
    for (const f of json(join(runDir, "findings-verified.json"))) {
      raw.push({
        key: f.id,
        title: f.title,
        cwe: f.cwe,
        file: f.file,
        line: f.line,
        verdict: VERDICT[f.verdict],
        original: SEV[f.original_severity] ?? null,
        verified: SEV[f.verified_severity] ?? null,
        description: f.attack_scenario,
        rootCause: null,
        evidence: [
          { file: f.file, line: f.line, description: clip(f.code_excerpt || f.title, 300) },
        ],
        flow: f.data_flow,
        reach: f.exploit_preconditions,
        confidence: ["low", "medium", "high"].includes(f.confidence) ? f.confidence : null,
        fix: f.fix || f.recommendation,
        models: ["gemini-4-argon-high"],
        verifier: "claude-sonnet",
        hunterId: f.id,
        owner: null,
        blockers: f.exploit_preconditions ? [clip(f.exploit_preconditions, 240)] : [],
        reason: f.evidence,
      });
    }
  }

  for (const r of raw) {
    if (!r.verdict) continue;
    const cls = attackClassOf(r.cwe, r.hunterId);
    const file = String(r.file || "unknown").replace(/^\/+/, "");
    const line = Number.isInteger(r.line) && r.line > 0 ? r.line : 1;
    const evidence = r.evidence.length
      ? r.evidence
      : [{ file, line, description: clip(r.title, 300) }];
    const steps =
      r.evidence.length > 1
        ? r.evidence
        : [{ file, line, description: clip(r.flow || r.reach || r.title, 300) }];
    const trace = steps.slice(0, 6).map((s, i, a) => ({
      kind:
        a.length === 1
          ? "sink"
          : i === 0
            ? "entrypoint"
            : i === a.length - 1
              ? "sink"
              : "propagation",
      file: s.file,
      line: s.line,
      scope: s.file.split("/").pop(),
      description: s.description,
    }));
    const rejected = r.verdict === "rejected";
    const needs = r.verdict === "needs_validation";
    const model = modelOf(r.models[0] ?? r.verifier);
    out.findings.push({
      id: uuid(`finding:${slug}:${r.key}`),
      projectId,
      fingerprint: `${slug}:${cls}:${slugOf(String(r.key))}`.slice(0, 200),
      sourceRun: runId,
      firstRun: runId,
      attackClass: cls,
      cwe: /^CWE-\d{1,5}$/.test(r.cwe || "") ? r.cwe : null,
      title: r.title,
      description: clip(r.description || r.title, 1800),
      rootCause: null,
      location: { file, line },
      trace,
      evidence,
      verdict: r.verdict,
      originalSeverity: r.original,
      verifiedSeverity: r.verdict === "confirmed" ? (r.verified ?? r.original ?? "low") : null,
      confidence: r.confidence,
      status: rejected ? "false_positive" : needs ? "new" : "confirmed",
      owner: null,
      firstSeen: t("09:00"),
      lastSeen: t("09:00"),
      slaDue:
        r.verdict === "confirmed" && SLA[r.verified]
          ? new Date(Date.parse(t("09:00")) + SLA[r.verified] * 864e5)
              .toISOString()
              .replace(".000Z", "Z")
          : null,
      model: { adapter: adapterOf(model), model },
      phase: "record_verify",
      blockers: needs
        ? r.blockers.length
          ? r.blockers.map((b) => clip(b, 240))
          : ["Needs a deployment or runtime check; cannot be proven from source alone."]
        : [],
      rejectionReason: rejected
        ? clip(r.reason || "Refuted by the adversarial verifier.", 400)
        : null,
      remediation: r.fix && !rejected ? { strategy: clip(r.fix, 1200), codeChanges: [] } : null,
      triageSuggestion: null,
      rootCauseGroup: null,
    });
  }
  const mine = out.findings.filter((f) => f.projectId === projectId);

  // ---- slices & run ------------------------------------------------------------------------
  const sliceModels = ledger.slices && !Array.isArray(ledger.slices) ? ledger.slices : null;
  const names = sliceModels
    ? Object.keys(sliceModels)
    : ["core", "vendor", "pdc"].filter((n) =>
        existsSync(join(runDir, "hunt", `findings-${n}.json`)),
      );
  names.forEach((name, i) => {
    const model = modelOf(sliceModels ? sliceModels[name] : "gemini-4-argon-high");
    const start = t(`09:${String(10 + i * 4).padStart(2, "0")}`);
    const end = t(`09:${String(13 + i * 4).padStart(2, "0")}`);
    out.slices.push({
      id: uuid(`slice:${slug}:${name}`),
      runId,
      phase: "hunt",
      label: String(name).toLowerCase(),
      attackClass: HUNTER_CLASS[String(name).split("-")[0]] ?? null,
      coverageIds: [],
      paths: [],
      status: "succeeded",
      attempts: [
        {
          attempt: 1,
          model: { adapter: adapterOf(model), model },
          status: "succeeded",
          startedAt: start,
          endedAt: end,
          errorCode: null,
          errorMessage: null,
          usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
          logKey: null,
        },
      ],
      startedAt: start,
      endedAt: end,
    });
  });
  const phase = (name, a, b, n) => ({
    runId,
    name,
    status: "succeeded",
    startedAt: t(a),
    endedAt: t(b),
    sliceCount: n,
    slicesDone: n,
    usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
  });
  const sha = /^[0-9a-f]{7,64}$/.test(meta.source_ref || "") ? meta.source_ref : null;
  const art = (n) => (existsSync(join(runDir, n)) ? `runs/${runId}/${n}` : null);
  out.runs.push({
    id: runId,
    projectId,
    mode: "full",
    repeat: 1,
    trigger: { kind: "manual", actor: "imported", ref: null },
    ref: "imported",
    commitSha: sha,
    baseCommitSha: null,
    previousRunId: null,
    scope: {
      paths: (meta.scope_paths ?? []).filter((p) => !p.startsWith("/") && !p.includes("..")),
      attackClasses: [],
      maxRuntimeSec: 14400,
      tokenBudget: null,
    },
    status: "succeeded",
    phases: [
      phase("recon", "09:00", "09:10", 1),
      phase("hunt", "09:10", "09:40", names.length),
      phase("validate", "09:40", "10:20", 1),
      phase("report", "10:20", "10:30", 1),
    ],
    validators: { findings: "passed", coverageLedger: "passed" },
    skillVersion: "imported-run-1",
    usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
    artifacts: {
      findingsJson: art("findings.json") ?? art("findings-verified.json"),
      coverageLedgerJson: art("coverage-ledger.json"),
      architectureMd: art("architecture.md"),
      reportMd: art("REPORT.md"),
      findingsDetailMd: art("FINDINGS-DETAIL.md"),
      needsValidationMd: art("NEEDS-VALIDATION.md"),
    },
    failureReason: null,
    retries: 0,
    createdAt: t("08:59"),
    startedAt: t("09:00"),
    endedAt: t("10:30"),
  });
  out.projects.push({
    id: projectId,
    slug,
    name: dir,
    repoUrl: `https://git.example.invalid/${slug}.git`,
    defaultBranch: "main",
    team: slug.slice(0, 40),
    clientId: slug.slice(0, 40),
    policyId: null,
    webhookSecretRef: null,
    modelRouting: [],
    escalation: null,
    criticalPaths: [],
    monthlyTokenBudget: null,
    createdAt: t("08:00"),
    updatedAt: t("10:30"),
  });
  const c = (v) => mine.filter((f) => f.verdict === v).length;
  console.log(
    `${dir}: ${mine.length} findings (${c("confirmed")} confirmed, ${c("needs_validation")} need validation, ${c("rejected")} rejected), ${names.length} slices`,
  );
}

const dest = join(dirname(fileURLToPath(import.meta.url)), "../src/api/audit-data.generated.json");
writeFileSync(dest, `${JSON.stringify(out, null, 2)}\n`);
console.log(`wrote ${dest}`);
