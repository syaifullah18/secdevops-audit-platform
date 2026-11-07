#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * Fake Agent CLI for @sdap/worker testing.
 * Simulates claude / agy CLI execution inside the SandboxRunner interface.
 * Does not make real network calls or use real LLM binaries.
 */

const fs = require("node:fs");
const path = require("node:path");

const args = process.argv.slice(2);

let prompt = "";
let model = "claude-opus-5-5";
let outputDir = process.env.SDAP_OUTPUT_DIR || "";

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === "-p" || arg === "--prompt") {
    prompt = args[++i] || "";
  } else if (arg === "--model") {
    model = args[++i] || "";
  } else if (arg === "-o" || arg === "--out" || arg === "--output-dir") {
    outputDir = args[++i] || "";
  }
}

// Extract output directory from prompt if not explicitly given
if (!outputDir) {
  const outMatch = prompt.match(/(?:output in|output directory:?|out:?)\s+([^\s\n]+)/i);
  if (outMatch && outMatch[1]) {
    outputDir = outMatch[1];
  } else {
    outputDir = path.resolve("out");
  }
}

// 1. Quota error simulation
if (
  model.includes("quota") ||
  prompt.includes("SIMULATE_QUOTA") ||
  process.env.SDAP_SIMULATE_ERROR === "quota_exceeded"
) {
  process.stderr.write(`Error: quota_exceeded: Insufficient credit balance or quota exceeded for model ${model}\n`);
  process.exit(1);
}

// 2. Rate limit simulation
if (
  model.includes("rate") ||
  prompt.includes("SIMULATE_RATE_LIMIT") ||
  process.env.SDAP_SIMULATE_ERROR === "rate_limited"
) {
  process.stderr.write(`Error: 429 rate_limited: Rate limit reached for model ${model}. Please retry later.\n`);
  process.exit(1);
}

// 3. Safety block simulation
if (
  model.includes("safety") ||
  prompt.includes("SIMULATE_SAFETY") ||
  process.env.SDAP_SIMULATE_ERROR === "safety_blocked"
) {
  process.stderr.write(`Error: safety_blocked: Prompt blocked by AI safety content filters.\n`);
  process.exit(1);
}

// 4. Permission denied simulation
if (
  model.includes("permission") ||
  prompt.includes("SIMULATE_PERMISSION") ||
  process.env.SDAP_SIMULATE_ERROR === "permission_denied"
) {
  process.stderr.write(`Error: permission_denied: EACCES permission denied to read or write file.\n`);
  process.exit(1);
}

// 5. Timeout simulation
if (
  model.includes("timeout") ||
  prompt.includes("SIMULATE_TIMEOUT") ||
  process.env.SDAP_SIMULATE_ERROR === "timeout"
) {
  // Sleep indefinitely until killed
  const start = Date.now();
  while (Date.now() - start < 120000) {
    // busy wait or block
  }
}

// Make sure output directory exists
fs.mkdirSync(outputDir, { recursive: true });

// Check quarantine to see if we've already retried an invalid run
const quarantineDir = path.join(outputDir, "quarantine");
const hasQuarantinedFiles = fs.existsSync(quarantineDir) && fs.readdirSync(quarantineDir).length > 0;

// 6. Invalid output simulation
if (
  model.includes("invalid") ||
  prompt.includes("SIMULATE_INVALID_FINDINGS_ALWAYS") ||
  process.env.SDAP_SIMULATE_INVALID_ALWAYS === "true" ||
  (prompt.includes("SIMULATE_INVALID_FINDINGS") && !hasQuarantinedFiles) ||
  (process.env.SDAP_SIMULATE_INVALID === "true" && !hasQuarantinedFiles)
) {
  const invalidFindings = '{"verdict": "confirmed"} {"verdict": "concatenated_json_not_an_array"}';
  fs.writeFileSync(path.join(outputDir, "findings.json"), invalidFindings, "utf8");
  process.stdout.write("Wrote invalid findings.json for validation testing.\n");
  process.exit(0);
}

// 7. Normal success run: write valid findings.json and coverage-ledger.json
const validFindings = [
  {
    verdict: "confirmed",
    fingerprint: "authz-service-missing-check",
    title: "Missing authorization check in order service",
    description: "An attacker can access orders without an ownership check.",
    root_cause: "Order controller omits user scope before fetching record.",
    intended_behavior: "Verify authenticated user matches order owner.",
    trace: [
      {
        kind: "entrypoint",
        file: "src/routes/orders.ts",
        line: 15,
        scope: "GET /orders/:id",
        description: "Request parameters passed to service.",
      },
      {
        kind: "sink",
        file: "src/services/order.ts",
        line: 42,
        scope: "OrderService.getOrder",
        description: "Direct DB query without user check.",
      },
    ],
    evidence: [
      {
        file: "src/services/order.ts",
        line: 42,
        description: "Query findOne({ id }) without userId filter.",
      },
    ],
    conditions: [],
    execution: {
      attacker_perspective: "Authenticated remote user",
      payloads: ["victim-order-id-456"],
      instructions: ["Send GET /orders/victim-order-id-456 with attacker bearer token."],
      observed_result: "Victim order JSON returned with status 200.",
    },
    remediation: {
      strategy: "Add { userId: req.user.id } constraint to database query.",
    },
    severity: {
      likelihood: { score: "medium", reason: "Directly accessible via public REST API." },
      impact: { score: "high", reason: "Complete exposure of customer purchase records." },
      overall_severity: "high",
    },
    confidence: {
      score: "high",
      reason: "Verified via synthetic sandbox execution.",
    },
  },
];

// Write valid coverage-ledger.json matching validate-coverage-ledger.cjs
const canonicalRefs = {
  surface: "src/routes/orders.ts#GET /orders/:id",
  boundary: "src/services/order.ts#getOrder",
  subsystem: "orders",
  attack_class: "ATTACK-CLASSES.md#Access control",
};

function encodeCanonicalRef(value) {
  return encodeURIComponent(String(value)).replace(/[!'()*~]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

const canonicalCoverageId = [
  encodeCanonicalRef(canonicalRefs.surface),
  encodeCanonicalRef(canonicalRefs.boundary),
  encodeCanonicalRef(canonicalRefs.subsystem),
  encodeCanonicalRef(canonicalRefs.attack_class),
].join("::");

const validLedger = [
  {
    coverage_id: canonicalCoverageId,
    canonical_refs: canonicalRefs,
    surface: "Order lookup endpoint",
    boundary: "Order ownership",
    subsystem: "orders",
    attack_class: "Access control",
    starting_paths: ["src/routes/orders.ts", "src/services/order.ts"],
    ordinary_attack_class_block: "ATTACK-CLASSES.md#Access control",
    selected_companion_blocks: [],
    excluded_blocks: [
      {
        block: "WEB-PROTOCOL-AND-AUTH.md#Cache behavior",
        reason: "Orders endpoint is uncacheable.",
      },
    ],
    prior_status: "new",
    attempts: [],
    wave: 1,
    status: "planned",
    agent_id: null,
    reviewed_paths: [],
    local_checks: [],
    result_fingerprints: [],
    unresolved: [],
  },
];

fs.writeFileSync(path.join(outputDir, "findings.json"), JSON.stringify(validFindings, null, 2), "utf8");
fs.writeFileSync(
  path.join(outputDir, "coverage-ledger.json"),
  JSON.stringify(validLedger, null, 2),
  "utf8"
);
fs.writeFileSync(
  path.join(outputDir, "architecture.md"),
  "# Architecture\n\nTarget architecture review.\n",
  "utf8"
);
fs.writeFileSync(
  path.join(outputDir, "REPORT.md"),
  "# Security Audit Report\n\n1 finding confirmed.\n",
  "utf8"
);
fs.writeFileSync(
  path.join(outputDir, "FINDINGS-DETAIL.md"),
  "# Findings Detail\n\n- Missing authorization check\n",
  "utf8"
);
fs.writeFileSync(
  path.join(outputDir, "NEEDS-VALIDATION.md"),
  "# Needs Validation\n\nNone.\n",
  "utf8"
);

process.stdout.write(
  `Fake agent completed successfully for model ${model}. Tokens: 120 input, 80 output.\n`
);
process.exit(0);
