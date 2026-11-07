CREATE TABLE "decisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"question_id" uuid NOT NULL,
	"key" text NOT NULL,
	"project_id" uuid,
	"question" jsonb NOT NULL,
	"decision" jsonb NOT NULL,
	"later_verdict" text,
	"human_label" text,
	"decided_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exceptions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"fingerprint" text NOT NULL,
	"kind" text NOT NULL,
	"reason" text NOT NULL,
	"approver" text NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "findings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"fingerprint" text NOT NULL,
	"secondary_fingerprint" text NOT NULL,
	"source_run" uuid NOT NULL,
	"first_run" uuid NOT NULL,
	"attack_class" text NOT NULL,
	"cwe" text,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"root_cause" text,
	"location" jsonb NOT NULL,
	"trace" jsonb NOT NULL,
	"evidence" jsonb NOT NULL,
	"verdict" text NOT NULL,
	"original_severity" text,
	"verified_severity" text,
	"confidence" text,
	"status" text NOT NULL,
	"owner" text,
	"first_seen" timestamp with time zone NOT NULL,
	"last_seen" timestamp with time zone NOT NULL,
	"sla_due" timestamp with time zone,
	"model" jsonb NOT NULL,
	"phase" text NOT NULL,
	"blockers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"rejection_reason" text,
	"remediation" jsonb,
	"triage_suggestion" jsonb,
	"root_cause_group" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "policies" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"mode" text NOT NULL,
	"rules" jsonb NOT NULL,
	"sla_days" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY NOT NULL,
	"slug" varchar(64) NOT NULL,
	"name" varchar(200) NOT NULL,
	"repo_url" text NOT NULL,
	"default_branch" text DEFAULT 'main' NOT NULL,
	"team" varchar(64) NOT NULL,
	"client_id" varchar(64) NOT NULL,
	"policy_id" uuid,
	"model_routing" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"escalation" jsonb DEFAULT 'null'::jsonb,
	"critical_paths" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"monthly_token_budget" integer,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "run_phases" (
	"run_id" uuid NOT NULL,
	"name" text NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"slice_count" integer DEFAULT 0 NOT NULL,
	"slices_done" integer DEFAULT 0 NOT NULL,
	"usage" jsonb NOT NULL,
	CONSTRAINT "run_phases_run_id_name_pk" PRIMARY KEY("run_id","name")
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"mode" text NOT NULL,
	"repeat" integer DEFAULT 1 NOT NULL,
	"trigger" jsonb NOT NULL,
	"ref" text NOT NULL,
	"commit_sha" text,
	"base_commit_sha" text,
	"previous_run_id" uuid,
	"scope" jsonb NOT NULL,
	"status" text NOT NULL,
	"validators" jsonb NOT NULL,
	"skill_version" text NOT NULL,
	"usage" jsonb NOT NULL,
	"artifacts" jsonb NOT NULL,
	"failure_reason" text,
	"retries" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "slices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"phase" text NOT NULL,
	"label" text NOT NULL,
	"attack_class" text,
	"coverage_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"paths" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text NOT NULL,
	"attempts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "triage_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"finding_id" uuid NOT NULL,
	"from" text NOT NULL,
	"to" text NOT NULL,
	"actor" jsonb NOT NULL,
	"reason" text,
	"at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exceptions" ADD CONSTRAINT "exceptions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_source_run_runs_id_fk" FOREIGN KEY ("source_run") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_first_run_runs_id_fk" FOREIGN KEY ("first_run") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_policy_id_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."policies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_phases" ADD CONSTRAINT "run_phases_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slices" ADD CONSTRAINT "slices_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "triage_events" ADD CONSTRAINT "triage_events_finding_id_findings_id_fk" FOREIGN KEY ("finding_id") REFERENCES "public"."findings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "decisions_question_id_idx" ON "decisions" USING btree ("question_id");--> statement-breakpoint
CREATE INDEX "decisions_key_idx" ON "decisions" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "events_run_id_seq_idx" ON "events" USING btree ("run_id","seq");--> statement-breakpoint
CREATE INDEX "exceptions_project_id_idx" ON "exceptions" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "findings_project_fingerprint_idx" ON "findings" USING btree ("project_id","fingerprint");--> statement-breakpoint
CREATE INDEX "findings_secondary_fingerprint_idx" ON "findings" USING btree ("secondary_fingerprint");--> statement-breakpoint
CREATE INDEX "findings_project_id_idx" ON "findings" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "findings_verdict_idx" ON "findings" USING btree ("verdict");--> statement-breakpoint
CREATE INDEX "findings_status_idx" ON "findings" USING btree ("status");--> statement-breakpoint
CREATE INDEX "projects_client_id_idx" ON "projects" USING btree ("client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "projects_slug_idx" ON "projects" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "runs_project_id_idx" ON "runs" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "runs_status_idx" ON "runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "slices_run_id_idx" ON "slices" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "triage_events_finding_id_idx" ON "triage_events" USING btree ("finding_id");