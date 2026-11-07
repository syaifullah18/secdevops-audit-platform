import { z } from "zod";
import { Id, IsoDateTime } from "./common.js";
import { Verdict } from "./enums.js";

/**
 * System 1 (Jev-style) typed questions. A decision model answers with calibrated
 * probabilities and never produces free text. System 1 is advisory only: it can
 * route, rank and escalate, but never block a merge or close a finding.
 */

/** What the question is about. Context is kept minimal (PRD 1b open point on data egress). */
export const JevSubject = z.object({
  type: z.enum(["diff", "finding", "candidate", "file", "task"]),
  /** Opaque reference, e.g. a commit range, fingerprint or path. */
  ref: z.string().min(1),
  /** Minimal snippets or metadata. Adapters must not add more context than given here. */
  context: z.array(z.string()).max(32).default([]),
});
export type JevSubject = z.infer<typeof JevSubject>;

const QuestionBase = z.object({
  id: Id,
  /**
   * Stable key used for threshold calibration and the learning loop,
   * e.g. "change.touches_authz", "candidate.reachable_from_input".
   */
  key: z.string().regex(/^[a-z0-9_]+(\.[a-z0-9_]+)+$/),
  /** The question, phrased for the decision model. */
  prompt: z.string().min(1),
  subject: JevSubject,
  projectId: Id.nullable(),
});

export const BinaryQuestion = QuestionBase.extend({ kind: z.literal("binary") });
export const ChoiceQuestion = QuestionBase.extend({
  kind: z.literal("choice"),
  options: z.array(z.string().min(1)).min(2).max(64),
  /** Allow several options to be selected (e.g. attack-class routing). */
  multi: z.boolean().default(false),
});
export const RatingQuestion = QuestionBase.extend({
  kind: z.literal("rating"),
  min: z.number().int(),
  max: z.number().int(),
});

export const JevQuestion = z.discriminatedUnion("kind", [
  BinaryQuestion,
  ChoiceQuestion,
  RatingQuestion,
]);
export type JevQuestion = z.infer<typeof JevQuestion>;

const Probability = z.number().min(0).max(1);

/** Where a System 1 answer came from. `rules`/`local_classifier` are the no-Jev fallback. */
export const DecisionSource = z.enum(["jev", "rules", "local_classifier", "mock"]);
export type DecisionSource = z.infer<typeof DecisionSource>;

const DecisionBase = z.object({
  questionId: Id,
  key: z.string(),
  source: DecisionSource,
  /** Pinned decision-model version, recorded for reproducibility (PRD 1b learning loop). */
  model: z.string().min(1),
  modelVersion: z.string().min(1),
  latencyMs: z.number().nonnegative(),
  decidedAt: IsoDateTime,
});

export const BinaryDecision = DecisionBase.extend({
  kind: z.literal("binary"),
  /** P(yes). */
  probability: Probability,
});
export const ChoiceDecision = DecisionBase.extend({
  kind: z.literal("choice"),
  /** Probability per option; for single-choice these sum to ~1. */
  distribution: z.record(z.string(), Probability),
});
export const RatingDecision = DecisionBase.extend({
  kind: z.literal("rating"),
  /** Expected value on the question's scale. */
  value: z.number(),
  distribution: z.record(z.string(), Probability).optional(),
});

export const JevDecision = z.discriminatedUnion("kind", [
  BinaryDecision,
  ChoiceDecision,
  RatingDecision,
]);
export type JevDecision = z.infer<typeof JevDecision>;

/** Learning-loop row: a decision plus the later System 2 verdict or human decision. */
export const DecisionOutcome = z.object({
  question: JevQuestion,
  decision: JevDecision,
  laterVerdict: Verdict.nullable(),
  humanLabel: z.string().nullable(),
  resolvedAt: IsoDateTime.nullable(),
});
export type DecisionOutcome = z.infer<typeof DecisionOutcome>;

/** Router config: when System 1 escalates to System 2 (PRD 1b "Router"). */
export const EscalationPolicy = z.object({
  /** Escalate when P(yes) >= threshold for this question key. */
  thresholds: z.record(z.string(), Probability).default({}),
  defaultThreshold: Probability.default(0.5),
  /** Probabilities within +/- band of 0.5 are "uncertain" and escalate. */
  uncertaintyBand: z.number().min(0).max(0.5).default(0.1),
});
export type EscalationPolicy = z.infer<typeof EscalationPolicy>;

export type EscalationReason = "above_threshold" | "uncertain" | null;

/** Pure router rule for a binary decision. Returns why it escalates, or null. */
export const escalationReason = (
  decision: z.infer<typeof BinaryDecision>,
  policy: EscalationPolicy,
): EscalationReason => {
  const threshold = policy.thresholds[decision.key] ?? policy.defaultThreshold;
  if (decision.probability >= threshold) return "above_threshold";
  if (Math.abs(decision.probability - 0.5) <= policy.uncertaintyBand) return "uncertain";
  return null;
};
