CREATE TABLE "access_tokens" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"name" varchar(100),
	"token_hash" varchar(64) NOT NULL,
	"prefix" varchar(24) NOT NULL,
	"roles" jsonb,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"ip" varchar(64),
	"user_agent" varchar(300)
);
--> statement-breakpoint
CREATE TABLE "account_audit" (
	"id" uuid PRIMARY KEY NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"actor" varchar(254) NOT NULL,
	"action" varchar(64) NOT NULL,
	"target" varchar(255),
	"ip" varchar(64),
	"details" jsonb
);
--> statement-breakpoint
CREATE TABLE "account_identities" (
	"provider" varchar(32) NOT NULL,
	"subject" varchar(255) NOT NULL,
	"user_id" uuid NOT NULL,
	"email" varchar(254),
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "account_identities_provider_subject_pk" PRIMARY KEY("provider","subject")
);
--> statement-breakpoint
CREATE TABLE "account_invitations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" varchar(254) NOT NULL,
	"roles" jsonb NOT NULL,
	"client_ids" jsonb NOT NULL,
	"team" varchar(64),
	"token_hash" varchar(64) NOT NULL,
	"invited_by" varchar(254) NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "account_users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" varchar(254) NOT NULL,
	"name" varchar(120) NOT NULL,
	"password_hash" text,
	"email_verified_at" timestamp with time zone,
	"roles" jsonb NOT NULL,
	"client_ids" jsonb NOT NULL,
	"team" varchar(64),
	"disabled_at" timestamp with time zone,
	"failed_logins" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"last_login_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "one_time_tokens" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "exceptions" ADD COLUMN "revoked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "policies" ADD COLUMN "client_id" varchar(64);--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "webhook_secret_ref" text;--> statement-breakpoint
ALTER TABLE "access_tokens" ADD CONSTRAINT "access_tokens_user_id_account_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."account_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_identities" ADD CONSTRAINT "account_identities_user_id_account_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."account_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "one_time_tokens" ADD CONSTRAINT "one_time_tokens_user_id_account_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."account_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "access_tokens_hash_uq" ON "access_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "access_tokens_user_idx" ON "access_tokens" USING btree ("user_id","kind");--> statement-breakpoint
CREATE INDEX "account_audit_at_idx" ON "account_audit" USING btree ("at");--> statement-breakpoint
CREATE INDEX "account_identities_user_idx" ON "account_identities" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "account_invitations_hash_uq" ON "account_invitations" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "account_users_email_uq" ON "account_users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "one_time_tokens_hash_uq" ON "one_time_tokens" USING btree ("token_hash");