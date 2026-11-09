import {
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import type {
  AttackClass,
  AuditMode,
  DecisionOutcome,
  EscalationPolicy,
  Exception,
  FindingStatus,
  GateRule,
  ModelAttribution,
  ModelRoute,
  PhaseName,
  PlatformEvent,
  RunArtifacts,
  RunScope,
  RunStatus,
  Severity,
  SlaDays,
  SliceAttempt,
  TraceStep,
  EvidenceItem,
  Trigger,
  Usage,
  ValidatorStatus,
  Verdict,
  WorkStatus,
} from "@sdap/core";

export const policies = pgTable("policies", {
  id: uuid("id").primaryKey(),
  name: text("name").notNull(),
  /** null = platform-wide policy. */
  clientId: varchar("client_id", { length: 64 }),
  mode: text("mode").$type<"enforce" | "report_only">().notNull(),
  rules: jsonb("rules").$type<GateRule[]>().notNull(),
  slaDays: jsonb("sla_days").$type<SlaDays>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
});

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey(),
    slug: varchar("slug", { length: 64 }).notNull(),
    name: varchar("name", { length: 200 }).notNull(),
    repoUrl: text("repo_url").notNull(),
    defaultBranch: text("default_branch").notNull().default("main"),
    team: varchar("team", { length: 64 }).notNull(),
    clientId: varchar("client_id", { length: 64 }).notNull(),
    policyId: uuid("policy_id").references(() => policies.id),
    /** Reference into the secret store, never the secret. */
    webhookSecretRef: text("webhook_secret_ref"),
    modelRouting: jsonb("model_routing").$type<ModelRoute[]>().notNull().default([]),
    escalation: jsonb("escalation").$type<EscalationPolicy | null>().default(null),
    criticalPaths: jsonb("critical_paths").$type<string[]>().notNull().default([]),
    monthlyTokenBudget: integer("monthly_token_budget"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
  },
  (table) => [
    index("projects_client_id_idx").on(table.clientId),
    uniqueIndex("projects_slug_idx").on(table.slug),
  ],
);

export const runs = pgTable(
  "runs",
  {
    id: uuid("id").primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    mode: text("mode").$type<AuditMode>().notNull(),
    repeat: integer("repeat").notNull().default(1),
    trigger: jsonb("trigger").$type<Trigger>().notNull(),
    ref: text("ref").notNull(),
    commitSha: text("commit_sha"),
    baseCommitSha: text("base_commit_sha"),
    previousRunId: uuid("previous_run_id"),
    scope: jsonb("scope").$type<RunScope>().notNull(),
    status: text("status").$type<RunStatus>().notNull(),
    validators: jsonb("validators")
      .$type<{ findings: ValidatorStatus; coverageLedger: ValidatorStatus }>()
      .notNull(),
    skillVersion: text("skill_version").notNull(),
    usage: jsonb("usage").$type<Usage>().notNull(),
    artifacts: jsonb("artifacts").$type<RunArtifacts>().notNull(),
    failureReason: text("failure_reason"),
    retries: integer("retries").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "string" }),
    endedAt: timestamp("ended_at", { withTimezone: true, mode: "string" }),
  },
  (table) => [
    index("runs_project_id_idx").on(table.projectId),
    index("runs_status_idx").on(table.status),
  ],
);

export const runPhases = pgTable(
  "run_phases",
  {
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id),
    name: text("name").$type<PhaseName>().notNull(),
    status: text("status").$type<WorkStatus>().notNull(),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "string" }),
    endedAt: timestamp("ended_at", { withTimezone: true, mode: "string" }),
    sliceCount: integer("slice_count").notNull().default(0),
    slicesDone: integer("slices_done").notNull().default(0),
    usage: jsonb("usage").$type<Usage>().notNull(),
  },
  (table) => [primaryKey({ columns: [table.runId, table.name] })],
);

export const slices = pgTable(
  "slices",
  {
    id: uuid("id").primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id),
    phase: text("phase").$type<PhaseName>().notNull(),
    label: text("label").notNull(),
    attackClass: text("attack_class").$type<AttackClass | null>(),
    coverageIds: jsonb("coverage_ids").$type<string[]>().notNull().default([]),
    paths: jsonb("paths").$type<string[]>().notNull().default([]),
    status: text("status").$type<WorkStatus>().notNull(),
    attempts: jsonb("attempts").$type<SliceAttempt[]>().notNull().default([]),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "string" }),
    endedAt: timestamp("ended_at", { withTimezone: true, mode: "string" }),
  },
  (table) => [index("slices_run_id_idx").on(table.runId)],
);

export const findings = pgTable(
  "findings",
  {
    id: uuid("id").primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    fingerprint: text("fingerprint").notNull(),
    secondaryFingerprint: text("secondary_fingerprint").notNull(),
    sourceRun: uuid("source_run")
      .notNull()
      .references(() => runs.id),
    firstRun: uuid("first_run")
      .notNull()
      .references(() => runs.id),
    attackClass: text("attack_class").$type<AttackClass>().notNull(),
    cwe: text("cwe"),
    title: text("title").notNull(),
    description: text("description").notNull(),
    rootCause: text("root_cause"),
    location: jsonb("location")
      .$type<{ file: string; line: number; endLine?: number; symbol?: string }>()
      .notNull(),
    trace: jsonb("trace").$type<TraceStep[]>().notNull(),
    evidence: jsonb("evidence").$type<EvidenceItem[]>().notNull(),
    verdict: text("verdict").$type<Verdict>().notNull(),
    originalSeverity: text("original_severity").$type<Severity | null>(),
    verifiedSeverity: text("verified_severity").$type<Severity | null>(),
    confidence: text("confidence").$type<"low" | "medium" | "high" | null>(),
    status: text("status").$type<FindingStatus>().notNull(),
    owner: text("owner"),
    firstSeen: timestamp("first_seen", { withTimezone: true, mode: "string" }).notNull(),
    lastSeen: timestamp("last_seen", { withTimezone: true, mode: "string" }).notNull(),
    slaDue: timestamp("sla_due", { withTimezone: true, mode: "string" }),
    model: jsonb("model").$type<ModelAttribution>().notNull(),
    phase: text("phase").$type<PhaseName>().notNull(),
    blockers: jsonb("blockers").$type<string[]>().notNull().default([]),
    rejectionReason: text("rejection_reason"),
    remediation: jsonb("remediation").$type<{
      strategy: string;
      codeChanges: { file: string; fixedCode: string }[];
    } | null>(),
    triageSuggestion: jsonb("triage_suggestion").$type<unknown>(),
    rootCauseGroup: text("root_cause_group"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
  },
  (table) => [
    uniqueIndex("findings_project_fingerprint_idx").on(table.projectId, table.fingerprint),
    index("findings_secondary_fingerprint_idx").on(table.secondaryFingerprint),
    index("findings_project_id_idx").on(table.projectId),
    index("findings_verdict_idx").on(table.verdict),
    index("findings_status_idx").on(table.status),
  ],
);

export const triageEvents = pgTable(
  "triage_events",
  {
    id: uuid("id").primaryKey(),
    findingId: uuid("finding_id")
      .notNull()
      .references(() => findings.id),
    from: text("from").$type<FindingStatus>().notNull(),
    to: text("to").$type<FindingStatus>().notNull(),
    actor: jsonb("actor").$type<{ subject: string; role: string }>().notNull(),
    reason: text("reason"),
    at: timestamp("at", { withTimezone: true, mode: "string" }).notNull(),
  },
  (table) => [index("triage_events_finding_id_idx").on(table.findingId)],
);

export const exceptions = pgTable(
  "exceptions",
  {
    id: uuid("id").primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    fingerprint: text("fingerprint").notNull(),
    kind: text("kind").$type<Exception["kind"]>().notNull(),
    reason: text("reason").notNull(),
    approver: text("approver").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
    /** Set when the exception is revoked (e.g. finding reopened); kept for audit. */
    revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "string" }),
  },
  (table) => [index("exceptions_project_id_idx").on(table.projectId)],
);

export const events = pgTable(
  "events",
  {
    id: uuid("id").primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    seq: integer("seq").notNull(),
    type: text("type").notNull(),
    payload: jsonb("payload").$type<PlatformEvent["payload"]>().notNull(),
    at: timestamp("at", { withTimezone: true, mode: "string" }).notNull(),
  },
  (table) => [uniqueIndex("events_run_id_seq_idx").on(table.runId, table.seq)],
);

export const decisions = pgTable(
  "decisions",
  {
    id: uuid("id").primaryKey(),
    questionId: uuid("question_id").notNull(),
    key: text("key").notNull(),
    projectId: uuid("project_id").references(() => projects.id),
    question: jsonb("question").$type<DecisionOutcome["question"]>().notNull(),
    decision: jsonb("decision").$type<DecisionOutcome["decision"]>().notNull(),
    laterVerdict: text("later_verdict").$type<Verdict | null>(),
    humanLabel: text("human_label"),
    decidedAt: timestamp("decided_at", { withTimezone: true, mode: "string" }).notNull(),
  },
  (table) => [
    index("decisions_question_id_idx").on(table.questionId),
    index("decisions_key_idx").on(table.key),
  ],
);

// ---------------------------------------------------------------------------------------------
// Native accounts (AUTH_NATIVE=true). See apps/api/src/accounts and docs/decisions.md D-018.
// ---------------------------------------------------------------------------------------------

export const accountUsers = pgTable(
  "account_users",
  {
    id: uuid("id").primaryKey(),
    /** Lower-cased. */
    email: varchar("email", { length: 254 }).notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    passwordHash: text("password_hash"),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true, mode: "string" }),
    roles: jsonb("roles").$type<string[]>().notNull(),
    /** `"*"` or a list of client ids. */
    clientIds: jsonb("client_ids").$type<string[] | "*">().notNull(),
    team: varchar("team", { length: 64 }),
    disabledAt: timestamp("disabled_at", { withTimezone: true, mode: "string" }),
    failedLogins: integer("failed_logins").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true, mode: "string" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true, mode: "string" }),
  },
  (t) => [uniqueIndex("account_users_email_uq").on(t.email)],
);

/** Sessions and API tokens. Only the SHA-256 of the secret is stored. */
export const accessTokens = pgTable(
  "access_tokens",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => accountUsers.id, { onDelete: "cascade" }),
    kind: text("kind").$type<"session" | "api_token">().notNull(),
    name: varchar("name", { length: 100 }),
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    prefix: varchar("prefix", { length: 24 }).notNull(),
    roles: jsonb("roles").$type<string[] | null>(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true, mode: "string" }),
    revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "string" }),
    ip: varchar("ip", { length: 64 }),
    userAgent: varchar("user_agent", { length: 300 }),
  },
  (t) => [
    uniqueIndex("access_tokens_hash_uq").on(t.tokenHash),
    index("access_tokens_user_idx").on(t.userId, t.kind),
  ],
);

export const oneTimeTokens = pgTable(
  "one_time_tokens",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => accountUsers.id, { onDelete: "cascade" }),
    purpose: text("purpose")
      .$type<"verify_email" | "reset_password" | "oauth_exchange">()
      .notNull(),
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true, mode: "string" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  },
  (t) => [uniqueIndex("one_time_tokens_hash_uq").on(t.tokenHash)],
);

export const accountIdentities = pgTable(
  "account_identities",
  {
    provider: varchar("provider", { length: 32 }).notNull(),
    subject: varchar("subject", { length: 255 }).notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => accountUsers.id, { onDelete: "cascade" }),
    email: varchar("email", { length: 254 }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.provider, t.subject] }),
    index("account_identities_user_idx").on(t.userId),
  ],
);

export const accountInvitations = pgTable(
  "account_invitations",
  {
    id: uuid("id").primaryKey(),
    email: varchar("email", { length: 254 }).notNull(),
    roles: jsonb("roles").$type<string[]>().notNull(),
    clientIds: jsonb("client_ids").$type<string[] | "*">().notNull(),
    team: varchar("team", { length: 64 }),
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    invitedBy: varchar("invited_by", { length: 254 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true, mode: "string" }),
    revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "string" }),
  },
  (t) => [uniqueIndex("account_invitations_hash_uq").on(t.tokenHash)],
);

/** Account and admin events. Append-only; survives deletion of the user it describes. */
export const accountAudit = pgTable(
  "account_audit",
  {
    id: uuid("id").primaryKey(),
    at: timestamp("at", { withTimezone: true, mode: "string" }).notNull(),
    actor: varchar("actor", { length: 254 }).notNull(),
    action: varchar("action", { length: 64 }).notNull(),
    target: varchar("target", { length: 255 }),
    ip: varchar("ip", { length: 64 }),
    details: jsonb("details").$type<Record<string, unknown> | null>(),
  },
  (t) => [index("account_audit_at_idx").on(t.at)],
);
