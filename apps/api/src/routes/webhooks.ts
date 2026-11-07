import crypto from "node:crypto";
import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import type { Project, Store } from "@sdap/core";
import { z } from "zod";
import { setAudit } from "../audit.js";
import { BadRequestError, UnauthorizedError } from "../errors.js";
import type { Queue } from "../queue.js";
import { queueRun } from "../run-service.js";

export type WebhookProvider = "github" | "gitlab" | "bitbucket";
const PROVIDERS: readonly string[] = ["github", "gitlab", "bitbucket"];

export type WebhookSecretResolver = (
  project: Pick<Project, "id" | "slug">,
) => Promise<string | null | undefined> | string | null | undefined;

export interface WebhookOptions {
  store: Store;
  queue: Queue;
  skillVersion: string;
  /** Per-project secret lookup; falls back to `secrets` keyed by project id or slug. */
  secretResolver?: WebhookSecretResolver;
  secrets: Readonly<Record<string, string>>;
}

declare module "fastify" {
  interface FastifyRequest {
    /** Exact request bytes, kept for HMAC verification. */
    rawBody?: Buffer;
  }
}

const sha256 = (data: string | Buffer): Buffer => crypto.createHash("sha256").update(data).digest();

/** Constant-time string comparison (digests first, so lengths always match). */
const safeEqual = (a: string, b: string): boolean => crypto.timingSafeEqual(sha256(a), sha256(b));

/** GitHub and Bitbucket Server: `sha256=<hex HMAC-SHA256 of the raw body>`. */
const verifyHmac = (raw: Buffer, header: string | undefined, secret: string): boolean => {
  if (!header?.startsWith("sha256=")) return false;
  const expected = crypto.createHmac("sha256", secret).update(raw).digest("hex");
  return safeEqual(header.slice("sha256=".length).trim().toLowerCase(), expected);
};

const verifySignature = (
  provider: WebhookProvider,
  req: FastifyRequest,
  raw: Buffer,
  secret: string,
): boolean => {
  const header = (name: string): string | undefined => {
    const v = req.headers[name];
    return Array.isArray(v) ? v[0] : v;
  };
  switch (provider) {
    case "github":
      return verifyHmac(raw, header("x-hub-signature-256"), secret);
    case "bitbucket":
      return verifyHmac(raw, header("x-hub-signature") ?? header("x-hub-signature-256"), secret);
    case "gitlab": {
      // GitLab sends the configured secret token verbatim; there is no body signature.
      const token = header("x-gitlab-token");
      return token !== undefined && safeEqual(token, secret);
    }
  }
};

export interface Trigger {
  ref: string;
  commitSha: string | null;
  /** PR/MR URL when the event is a pull request. */
  source: string | null;
}

const str = z.string().min(1).optional();
const sha = z
  .string()
  .regex(/^[0-9a-f]{7,64}$/i)
  .optional()
  .catch(undefined);

const GithubBody = z.object({
  ref: str,
  after: sha,
  deleted: z.boolean().optional(),
  action: str,
  pull_request: z
    .object({ html_url: str, head: z.object({ ref: str, sha }).optional() })
    .optional(),
});
const GitlabBody = z.object({
  object_kind: str,
  ref: str,
  checkout_sha: z.string().nullable().optional().catch(undefined),
  after: sha,
  object_attributes: z
    .object({
      action: str,
      source_branch: str,
      url: str,
      last_commit: z.object({ id: sha }).optional(),
    })
    .optional(),
});
const BitbucketRef = z.object({
  type: str,
  name: str,
  target: z.object({ hash: sha }).optional(),
});
const BitbucketBody = z.object({
  push: z
    .object({ changes: z.array(z.object({ new: BitbucketRef.nullable().optional() })) })
    .optional(),
  pullrequest: z
    .object({
      source: z
        .object({
          branch: z.object({ name: str }).optional(),
          commit: z.object({ hash: sha }).optional(),
        })
        .optional(),
      links: z.object({ html: z.object({ href: str }).optional() }).optional(),
    })
    .optional(),
});

const PR_ACTIONS = new Set(["opened", "synchronize", "reopened", "ready_for_review"]);
const MR_ACTIONS = new Set(["open", "update", "reopen"]);

/** `refs/heads/x` becomes `x`; tags keep their full ref so a tag and a branch never collide. */
const refName = (ref: string): string => (ref.startsWith("refs/heads/") ? ref.slice(11) : ref);

const hexOrNull = (v: string | null | undefined): string | null =>
  v && /^[0-9a-f]{7,64}$/i.test(v) && !/^0+$/.test(v) ? v.toLowerCase() : null;

/**
 * Maps a provider payload to a run trigger. Returns null for events that must not start a
 * run (ping, branch deletion, PR closed/labelled, ...). Push, pull/merge request and tag
 * events are supported.
 */
export const mapEvent = (provider: WebhookProvider, req: FastifyRequest): Trigger | null => {
  const body: unknown = req.body ?? {};
  const eventHeader =
    req.headers["x-github-event"] ?? req.headers["x-gitlab-event"] ?? req.headers["x-event-key"];
  const event = Array.isArray(eventHeader) ? eventHeader[0] : eventHeader;

  if (provider === "github") {
    const b = GithubBody.parse(body);
    if (event === "ping") return null;
    if (b.pull_request && (event === undefined || event === "pull_request")) {
      if (b.action !== undefined && !PR_ACTIONS.has(b.action)) return null;
      return {
        ref: b.pull_request.head?.ref ?? "HEAD",
        commitSha: hexOrNull(b.pull_request.head?.sha),
        source: b.pull_request.html_url ?? null,
      };
    }
    if (b.ref && (event === undefined || event === "push") && !b.deleted) {
      return { ref: refName(b.ref), commitSha: hexOrNull(b.after), source: null };
    }
    return null;
  }

  if (provider === "gitlab") {
    const b = GitlabBody.parse(body);
    const mr = b.object_attributes;
    if (mr && (b.object_kind === undefined || b.object_kind === "merge_request")) {
      if (mr.action !== undefined && !MR_ACTIONS.has(mr.action)) return null;
      return {
        ref: mr.source_branch ?? "HEAD",
        commitSha: hexOrNull(mr.last_commit?.id),
        source: mr.url ?? null,
      };
    }
    if (
      b.ref &&
      (b.object_kind === undefined || b.object_kind === "push" || b.object_kind === "tag_push")
    ) {
      const sha = hexOrNull(b.checkout_sha) ?? hexOrNull(b.after);
      return sha === null && b.after !== undefined
        ? null
        : { ref: refName(b.ref), commitSha: sha, source: null };
    }
    return null;
  }

  const b = BitbucketBody.parse(body);
  const change = b.push?.changes.find((c) => c.new)?.new;
  if (change?.name) {
    const ref = change.type === "tag" ? `refs/tags/${change.name}` : change.name;
    return { ref, commitSha: hexOrNull(change.target?.hash), source: null };
  }
  const pr = b.pullrequest;
  if (pr?.source?.branch?.name) {
    return {
      ref: pr.source.branch.name,
      commitSha: hexOrNull(pr.source.commit?.hash),
      source: pr.links?.html?.href ?? null,
    };
  }
  return null;
};

const repoUrlOf = (body: unknown): string | undefined => {
  const parsed = z
    .object({
      repository: z
        .object({
          html_url: str,
          clone_url: str,
          links: z.object({ html: z.object({ href: str }).optional() }).optional(),
        })
        .optional(),
      project: z.object({ web_url: str, git_http_url: str }).optional(),
    })
    .safeParse(body ?? {});
  if (!parsed.success) return undefined;
  const { repository, project } = parsed.data;
  return (
    repository?.html_url ??
    repository?.clone_url ??
    repository?.links?.html?.href ??
    project?.web_url ??
    project?.git_http_url
  );
};

const normaliseUrl = (u: string): string => u.replace(/\.git$/, "").replace(/\/+$/, "");

/**
 * `POST /webhooks/{github,gitlab,bitbucket}`. Authenticated by signature, not by OIDC: the
 * project is located first (id, slug, or repository URL), then the request must carry a valid
 * signature for that project's secret. Unknown project, missing secret and bad signature are
 * all the same 401, so callers cannot probe which projects exist.
 */
export const webhookRoutes: FastifyPluginAsync<WebhookOptions> = async (app, opts) => {
  const { store } = opts;

  app.post("/webhooks/:provider", async (req, reply) => {
    const { provider } = req.params as { provider: string };
    if (!PROVIDERS.includes(provider)) {
      throw new BadRequestError(`Unsupported webhook provider: ${provider}`);
    }
    const kind = provider as WebhookProvider;
    setAudit(req, { actor: `webhook:${kind}`, action: "webhook.receive", target: kind });

    const query = (req.query ?? {}) as Record<string, string | undefined>;
    const all = await store.projects.list({ clientIds: "*" });
    const repoUrl = repoUrlOf(req.body);
    const project =
      (query["projectId"] ? all.find((p) => p.id === query["projectId"]) : undefined) ??
      (query["project"] ? all.find((p) => p.slug === query["project"]) : undefined) ??
      (repoUrl ? all.find((p) => normaliseUrl(p.repoUrl) === normaliseUrl(repoUrl)) : undefined);

    const secret = project
      ? ((await opts.secretResolver?.(project)) ??
        opts.secrets[project.id] ??
        opts.secrets[project.slug])
      : undefined;
    const raw = req.rawBody;
    if (!project || !secret || !raw || !verifySignature(kind, req, raw, secret)) {
      throw new UnauthorizedError("Invalid webhook signature");
    }

    const trigger = mapEvent(kind, req);
    if (!trigger) {
      setAudit(req, { actor: `webhook:${kind}`, action: "webhook.ignored", target: project.id });
      return reply.status(202).send({ status: "ignored" });
    }

    const run = await queueRun(
      { store, queue: opts.queue, skillVersion: opts.skillVersion },
      {
        projectId: project.id,
        mode: "focused",
        repeat: 1,
        ref: trigger.ref || project.defaultBranch,
        commitSha: trigger.commitSha,
        scope: {},
        trigger: {
          kind: "webhook",
          actor: `webhook:${kind}`,
          ref: trigger.source ?? trigger.commitSha ?? trigger.ref,
        },
      },
    );
    setAudit(req, {
      actor: `webhook:${kind}`,
      action: "webhook.run_create",
      target: run.id,
      details: { projectId: project.id },
    });
    return reply.status(202).send({ runId: run.id, status: "queued", run });
  });
};
