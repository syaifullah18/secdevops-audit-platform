/**
 * Prompts for the phases of the security-audit skill. The agent reads the pinned skill itself
 * (SKILL.md and the phase documents), so the methodology is the skill's, not ours. These prompts
 * only fix the paths, the phase boundary and the files each phase must leave behind.
 */
export interface PromptPaths {
  /** Repository under review, read-only. */
  target: string;
  /** Writable run directory for artefacts. */
  output: string;
  /** The skill directory (contains SKILL.md). */
  skill: string;
}

const RULES = (p: PromptPaths): string =>
  [
    `Skill directory: ${p.skill} (read SKILL.md first, then the documents named below).`,
    `Target repository (read-only, never modify): ${p.target}`,
    `Output directory (write all artefacts here): ${p.output}`,
    "Work in full audit mode. Inspect source only: do not run, build or install anything from the target, and do not use the network.",
    "Use only the Read, Grep, Glob, Write and Edit tools. Write files only inside the output directory.",
    "Report only what the source supports. A candidate without a concrete affected principal, resource or security outcome is not a finding.",
  ].join("\n");

export const reconPrompt = (p: PromptPaths): string =>
  `${RULES(p)}

Phase: RECONNAISSANCE. Read ${p.skill}/RECONNAISSANCE.md and follow it.
Produce in the output directory:
- architecture.md: components, trust boundaries, entry points, data stores and sensitive flows.
- coverage-ledger.json: the coverage ledger as defined in SKILL.md (validated by ${p.skill}/validate-coverage-ledger.cjs), with one unit per area that needs review.
Finish with a one-paragraph summary.`;

export const huntPrompt = (p: PromptPaths, label: string, attackClass: string | null): string =>
  `${RULES(p)}

Phase: HUNTING, slice "${label}"${attackClass ? ` (attack class: ${attackClass})` : ""}. Read ${p.skill}/HUNTING.md and ${p.skill}/ATTACK-CLASSES.md, and use ${p.output}/architecture.md and ${p.output}/coverage-ledger.json from reconnaissance.
Find candidate vulnerabilities for this slice. Write them as a JSON array to ${p.output}/candidates-${label.replace(/[^A-Za-z0-9._-]+/g, "_")}.json, each with a title, the attack path (entrypoint to sink with file and line), the evidence, and your reasoning. An empty array is a valid result.`;

export const validatePrompt = (p: PromptPaths): string =>
  `${RULES(p)}

Phase: VALIDATION AND REPORTING. Read ${p.skill}/VALIDATION-AND-REPORTING.md and ${p.skill}/report-schema.json.
Independently re-check every candidate in ${p.output}/candidates-*.json against the source and decide a verdict (confirmed, needs_validation or rejected) with the evidence.
Produce in the output directory:
- findings.json: a JSON array of findings that satisfies ${p.skill}/report-schema.json (checked by ${p.skill}/validate-findings.cjs). It must exist even when it is [].
- coverage-ledger.json: updated with what was actually reviewed.
- REPORT.md, FINDINGS-DETAIL.md and NEEDS-VALIDATION.md as described in the skill.
Do not invent findings to fill the report.`;
