import { createHash } from "node:crypto";
import type { Finding } from "@sdap/core";

const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "from",
  "are",
  "was",
  "not",
  "but",
  "any",
  "into",
  "its",
  "has",
  "have",
  "can",
  "which",
  "when",
  "than",
  "then",
  "there",
  "their",
  "does",
  "doesn",
  "without",
  "before",
  "after",
  "only",
  "also",
  "being",
  "been",
  "will",
]);

/** Normalize a repository path: forward slashes, no leading `./`, collapsed separators. */
export const normalizePath = (p: string): string =>
  p
    .replace(/\\/g, "/")
    .replace(/\/{2,}/g, "/")
    .replace(/^(\.\/)+/, "")
    .trim();

/** Lowercased, de-duplicated, sorted content words of a root-cause sentence. */
export const rootCauseWords = (text: string | null): string[] => {
  if (!text) return [];
  const words = text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w) && !/^\d+$/.test(w));
  return [...new Set(words)].sort();
};

/** Sink trace step if present, else the first step (same rule as the finding location). */
const anchorStep = (f: Pick<Finding, "trace" | "location">) =>
  f.trace.find((s) => s.kind === "sink") ?? f.trace[0];

/**
 * Line-number independent identity used to carry a finding forward when the
 * skill's own fingerprint changes (code moved, renamed, re-ordered). Hash of:
 * attack class + normalized sink file + sink scope + root-cause words.
 */
export const secondaryFingerprint = (
  f: Pick<Finding, "attackClass" | "trace" | "location" | "rootCause">,
): string => {
  const step = anchorStep(f);
  const file = normalizePath(step?.file ?? f.location.file);
  const scope = (step?.scope ?? "").trim().toLowerCase();
  const material = [f.attackClass, file, scope, rootCauseWords(f.rootCause).join(" ")].join(
    "\u0000",
  );
  return `sfp1:${createHash("sha256").update(material).digest("hex").slice(0, 32)}`;
};

/**
 * Deterministic RFC 9562 version-5-shaped UUID, so the same (project, fingerprint)
 * always yields the same platform id.
 */
export const deterministicFindingId = (projectId: string, fingerprint: string): string => {
  const h = createHash("sha256")
    .update(`sdap-finding\u0000${projectId}\u0000${fingerprint}`)
    .digest();
  const b = Buffer.from(h.subarray(0, 16));
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x50;
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80;
  const x = b.toString("hex");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
};
