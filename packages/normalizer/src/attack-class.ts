import { KNOWN_ATTACK_CLASSES, type AttackClass } from "@sdap/core";
import type { LedgerUnit } from "./schemas.js";

/** Exact `ATTACK-CLASSES.md#<heading>` blocks of the pinned skill, lowercased. */
const BLOCK_HEADINGS: Readonly<Record<string, AttackClass>> = {
  injection: "injection",
  "access control": "authz",
  "resource and file handling": "injection",
  "cryptography and secrets": "crypto",
  "business logic": "other",
  "feature abuse and data leakage": "data_isolation",
  "chained vulnerabilities and trust boundaries": "other",
  wildcard: "other",
  "obvious things": "other",
};

/** Companion files of the skill, by file name. */
const FILE_FAMILIES: Readonly<Record<string, AttackClass>> = {
  "client-side.md": "client_side",
  "data-isolation-and-lifecycle.md": "data_isolation",
  "resource-exhaustion-and-availability.md": "resource_exhaustion",
  "supply-chain-and-release.md": "supply_chain",
  "cloud-and-deployment.md": "config",
  "web-protocol-and-auth.md": "authn",
};

/** Keyword fallback for free-form refs (community packs, renamed blocks). */
const KEYWORDS: readonly (readonly [RegExp, AttackClass])[] = [
  [/authenticat|session|login|oauth|jwt|credential stuffing/, "authn"],
  [/access control|authoriz|idor|privilege|tenant/, "authz"],
  [/inject|xss|sqli|traversal|ssrf|deserializ|command exec/, "injection"],
  [/secret|crypto|tls|cipher|hash/, "crypto"],
  [/supply|dependenc|release|ci\/cd|pipeline/, "supply_chain"],
  [/denial|exhaust|availability|rate limit/, "resource_exhaustion"],
  [/isolation|leak|lifecycle/, "data_isolation"],
  [/client|browser|csrf|cors|dom/, "client_side"],
  [/config|deploy|cloud|header/, "config"],
];

const isKnown = (s: string): s is (typeof KNOWN_ATTACK_CLASSES)[number] =>
  (KNOWN_ATTACK_CLASSES as readonly string[]).includes(s);

/**
 * Map a ledger `canonical_refs.attack_class` (e.g. `ATTACK-CLASSES.md#Access control`)
 * to a platform attack-class family. Falls back to `other` (docs/decisions.md D-006).
 */
export const mapAttackClass = (ref: string): AttackClass => {
  const trimmed = ref.trim();
  const lower = trimmed.toLowerCase();
  if (isKnown(lower)) return lower;
  const hash = lower.indexOf("#");
  const file = hash === -1 ? "" : (lower.slice(0, hash).split("/").pop() ?? "");
  const heading = hash === -1 ? lower : lower.slice(hash + 1).trim();
  const byFile = FILE_FAMILIES[file];
  if (byFile) return byFile;
  const byHeading = Object.hasOwn(BLOCK_HEADINGS, heading) ? BLOCK_HEADINGS[heading] : undefined;
  if (byHeading) return byHeading;
  for (const [re, family] of KEYWORDS) if (re.test(lower)) return family;
  return "other";
};

/**
 * Attack class of a finding: the family of the first ledger unit listing the
 * fingerprint in `result_fingerprints` whose class maps to something other than
 * `other`; otherwise `other`.
 */
export const attackClassFor = (fingerprint: string, ledger: readonly LedgerUnit[]): AttackClass => {
  let found: AttackClass | null = null;
  for (const unit of ledger) {
    if (!unit.result_fingerprints.includes(fingerprint)) continue;
    const mapped = mapAttackClass(unit.canonical_refs.attack_class);
    if (mapped !== "other") return mapped;
    found = mapped;
  }
  return found ?? "other";
};
