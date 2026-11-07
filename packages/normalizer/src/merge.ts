import {
  computeSlaDue,
  DEFAULT_SLA_DAYS,
  Finding,
  SEVERITY_RANK,
  type Id,
  type SlaDays,
  type Verdict,
} from "@sdap/core";
import { secondaryFingerprint } from "./fingerprint.js";

export interface MergeOptions {
  /** SLA table used when the verified severity changes or a finding regresses. */
  slaDays?: SlaDays;
}

export interface VerdictChange {
  from: Verdict;
  to: Verdict;
  at: string;
  /** Run that produced the new verdict. */
  runId: Id;
}

export interface MergeOutcome {
  finding: Finding;
  /** True when no existing finding matched. */
  isNew: boolean;
  matchedBy: "fingerprint" | "secondary" | null;
  /** The existing finding that was matched, before the merge. */
  previous: Finding | null;
  /** Set when the verdict differs from the existing finding's verdict. Persist this. */
  verdictChange: VerdictChange | null;
  /** A `fixed` finding that a later run confirmed again; status reset to `confirmed`. */
  regression: boolean;
  /** The skill fingerprint changed and the finding was carried forward by secondary match. */
  fingerprintChanged: boolean;
}

const CONFIDENCE = ["low", "medium", "high"] as const;
type Confidence = (typeof CONFIDENCE)[number];
const confRank = (c: Confidence | null): number => (c === null ? -1 : CONFIDENCE.indexOf(c));
const maxConf = (a: Confidence | null, b: Confidence | null): Confidence | null =>
  confRank(a) >= confRank(b) ? a : b;
const bumpConf = (c: Confidence | null, steps: number): Confidence | null =>
  c === null ? null : (CONFIDENCE[Math.min(confRank(c) + steps, CONFIDENCE.length - 1)] ?? c);

const VERDICT_PRECEDENCE: Record<Verdict, number> = {
  confirmed: 2,
  needs_validation: 1,
  rejected: 0,
};

/**
 * Repeat-N collapse: several observations of one fingerprint (from independent
 * runs) become one finding. The strongest verdict wins (confirmed > needs_validation
 * > rejected); among confirmed observations the highest verified severity wins,
 * then the latest. Confidence rises one step per additional distinct run that
 * reached the same verdict, capped at `high`. Input order is run order.
 */
export const collapseRepeats = (incoming: readonly Finding[]): Finding[] => {
  const groups = new Map<string, Finding[]>();
  for (const f of incoming) {
    const key = `${f.projectId}|${f.fingerprint}`;
    const g = groups.get(key);
    if (g) g.push(f);
    else groups.set(key, [f]);
  }
  return [...groups.values()].map((group) => {
    let best = group[0] as Finding;
    for (const f of group.slice(1)) {
      const dv = VERDICT_PRECEDENCE[f.verdict] - VERDICT_PRECEDENCE[best.verdict];
      const ds =
        (f.verifiedSeverity ? SEVERITY_RANK[f.verifiedSeverity] : -1) -
        (best.verifiedSeverity ? SEVERITY_RANK[best.verifiedSeverity] : -1);
      if (dv > 0 || (dv === 0 && ds >= 0)) best = f;
    }
    const agreeing = new Set(
      group.filter((f) => f.verdict === best.verdict).map((f) => f.sourceRun),
    );
    const confidence = group
      .filter((f) => f.verdict === best.verdict)
      .reduce<Confidence | null>((acc, f) => maxConf(acc, f.confidence), null);
    const first = group.reduce((a, b) => (a.firstSeen <= b.firstSeen ? a : b));
    return {
      ...best,
      confidence: bumpConf(confidence, agreeing.size - 1),
      firstSeen: first.firstSeen,
      firstRun: first.firstRun,
    };
  });
};

const carry = (
  existing: Finding,
  incoming: Finding,
  now: string,
  opts: MergeOptions,
): Omit<MergeOutcome, "isNew" | "matchedBy" | "previous"> => {
  const regression = existing.status === "fixed" && incoming.verdict === "confirmed";
  const status = regression ? ("confirmed" as const) : existing.status;
  const severityChanged = incoming.verifiedSeverity !== existing.verifiedSeverity;
  const slaDays = opts.slaDays ?? DEFAULT_SLA_DAYS;
  // SLA runs from firstSeen. A regression restarts it from now; an unchanged
  // severity keeps the stored date (it may come from a project-specific policy).
  const slaDue = regression
    ? computeSlaDue(incoming.verifiedSeverity, now, slaDays)
    : severityChanged
      ? computeSlaDue(incoming.verifiedSeverity, existing.firstSeen, slaDays)
      : existing.slaDue;

  const merged = Finding.parse({
    ...incoming,
    id: existing.id,
    firstSeen: existing.firstSeen,
    firstRun: existing.firstRun,
    lastSeen: now,
    sourceRun: incoming.sourceRun,
    status,
    owner: existing.owner ?? incoming.owner,
    slaDue,
    cwe: incoming.cwe ?? existing.cwe,
    attackClass:
      incoming.attackClass === "other" && existing.attackClass !== "other"
        ? existing.attackClass
        : incoming.attackClass,
    originalSeverity: incoming.originalSeverity ?? existing.originalSeverity,
    confidence:
      incoming.verdict === existing.verdict
        ? maxConf(existing.confidence, incoming.confidence)
        : incoming.confidence,
    triageSuggestion: incoming.triageSuggestion ?? existing.triageSuggestion,
    rootCauseGroup: existing.rootCauseGroup ?? incoming.rootCauseGroup,
  });

  return {
    finding: merged,
    verdictChange:
      existing.verdict === incoming.verdict
        ? null
        : { from: existing.verdict, to: incoming.verdict, at: now, runId: incoming.sourceRun },
    regression,
    fingerprintChanged: existing.fingerprint !== incoming.fingerprint,
  };
};

/**
 * Merge a run's findings into the stored ones.
 *
 * Matching: skill fingerprint first, then {@link secondaryFingerprint} (code moved,
 * skill fingerprint changed). A match keeps `id`, `status`, `owner`, `firstSeen`,
 * `firstRun`; updates `lastSeen` and `sourceRun`; and takes the new content and
 * verdict. Verdict changes (e.g. confirmed -> rejected) keep the triage status and
 * are reported in `verdictChange` for the caller to record. `fixed` + confirmed
 * again is a regression: status returns to `confirmed`. Duplicate fingerprints in
 * `incoming` are collapsed first (repeat-N). Existing findings that are not matched
 * are not returned. Results follow the order of the collapsed `incoming`.
 */
export const mergeFindings = (
  existing: readonly Finding[],
  incoming: readonly Finding[],
  now: Date | string,
  opts: MergeOptions = {},
): MergeOutcome[] => {
  const nowIso = (typeof now === "string" ? new Date(now) : now).toISOString();
  const batch = collapseRepeats(incoming);

  const byFingerprint = new Map(existing.map((e) => [`${e.projectId}|${e.fingerprint}`, e]));
  const bySecondary = new Map<string, Finding[]>();
  for (const e of existing) {
    const key = `${e.projectId}|${secondaryFingerprint(e)}`;
    const list = bySecondary.get(key);
    if (list) list.push(e);
    else bySecondary.set(key, [e]);
  }

  const claimed = new Set<Finding>();
  const matches = new Map<Finding, { prev: Finding; by: "fingerprint" | "secondary" }>();
  // Pass 1: exact skill fingerprint.
  for (const f of batch) {
    const hit = byFingerprint.get(`${f.projectId}|${f.fingerprint}`);
    if (hit && !claimed.has(hit)) {
      claimed.add(hit);
      matches.set(f, { prev: hit, by: "fingerprint" });
    }
  }
  // Pass 2: secondary fingerprint, never stealing an existing finding another
  // incoming one matched exactly. Oldest candidate wins.
  const incomingKeys = new Set(batch.map((f) => `${f.projectId}|${f.fingerprint}`));
  for (const f of batch) {
    if (matches.has(f)) continue;
    const candidates = (bySecondary.get(`${f.projectId}|${secondaryFingerprint(f)}`) ?? [])
      .filter((e) => !claimed.has(e) && !incomingKeys.has(`${e.projectId}|${e.fingerprint}`))
      .sort((a, b) => (a.firstSeen < b.firstSeen ? -1 : a.firstSeen > b.firstSeen ? 1 : 0));
    const hit = candidates[0];
    if (hit) {
      claimed.add(hit);
      matches.set(f, { prev: hit, by: "secondary" });
    }
  }

  return batch.map((f): MergeOutcome => {
    const m = matches.get(f);
    if (!m) {
      return {
        finding: Finding.parse({ ...f, lastSeen: nowIso }),
        isNew: true,
        matchedBy: null,
        previous: null,
        verdictChange: null,
        regression: false,
        fingerprintChanged: false,
      };
    }
    return { isNew: false, matchedBy: m.by, previous: m.prev, ...carry(m.prev, f, nowIso, opts) };
  });
};
