#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
// A stand-in for `claude -p` that behaves like a finished audit: it reads the phase from the
// prompt and leaves the artefacts that phase must produce, then reports usage as JSON.
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
const prompt = args[args.indexOf("-p") + 1] || "";
const out = process.env.SDAP_OUTPUT_DIR;
const golden = process.env.TEST_GOLDEN_DIR;
const seenCwd = process.cwd();

if (prompt.includes("Phase: RECONNAISSANCE")) {
  fs.writeFileSync(path.join(out, "architecture.md"), "# Architecture\n");
  fs.writeFileSync(path.join(out, "coverage-ledger.json"), "[]");
}
if (prompt.includes("Phase: VALIDATION AND REPORTING")) {
  // The skill requires records sorted by fingerprint; the real validator checks this.
  const records = JSON.parse(fs.readFileSync(path.join(golden, "findings.json"), "utf8"));
  records.sort((a, b) =>
    a.fingerprint < b.fingerprint ? -1 : a.fingerprint > b.fingerprint ? 1 : 0,
  );
  fs.writeFileSync(path.join(out, "findings.json"), JSON.stringify(records, null, 2));
  fs.writeFileSync(path.join(out, "coverage-ledger.json"), "[]");
  for (const f of ["REPORT.md", "FINDINGS-DETAIL.md", "NEEDS-VALIDATION.md"]) {
    fs.writeFileSync(path.join(out, f), "# " + f + "\n");
  }
}
// The target must be the checked-out repository, not the worker's own directory.
const sawRepoFile = fs.existsSync(path.join(seenCwd, "app.ts"));
process.stdout.write(
  JSON.stringify({
    is_error: false,
    result: sawRepoFile ? "ok" : "wrong-cwd",
    total_cost_usd: 0.25,
    usage: { input_tokens: 1000, output_tokens: 200 },
  }),
);
