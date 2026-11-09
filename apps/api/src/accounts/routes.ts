import { Role } from "@sdap/core";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { BadRequestError, ForbiddenError, NotFoundError } from "../errors.js";
import { parseWith } from "../http.js";
import { requireRoles } from "../rbac.js";
import { PROVIDER_NAMES, type OAuthFlow, type ProviderName } from "./oauth.js";
import { rateLimit } from "./ratelimit.js";
import { type RequestMeta, toPublic, type AccountService } from "./service.js";
import type { ClientScope } from "./types.js";

const meta = (req: FastifyRequest): RequestMeta => ({
  ip: req.ip,
  userAgent: typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : null,
});

const Email = z.string().trim().toLowerCase().email().max(254);
const Password = z.string().min(1).max(256);
const Scope = z.union([z.literal("*"), z.array(z.string().min(1).max(64)).max(200)]);

const OAUTH_COOKIE = "sdap_oauth";

const readCookie = (req: FastifyRequest, name: string): string | undefined => {
  const raw = req.headers.cookie;
  if (!raw) return undefined;
  for (const part of raw.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return rest.join("=");
  }
  return undefined;
};

const sessionView = (
  t: {
    id: string;
    createdAt: string;
    lastUsedAt: string | null;
    expiresAt: string | null;
    ip: string | null;
    userAgent: string | null;
  },
  currentId: string | undefined,
) => ({
  id: t.id,
  createdAt: t.createdAt,
  lastUsedAt: t.lastUsedAt,
  expiresAt: t.expiresAt,
  ip: t.ip,
  userAgent: t.userAgent,
  current: t.id === currentId,
});

/** Public routes: no credentials needed, rate limited. */
export const authPublicRoutes: FastifyPluginAsync<{
  accounts: AccountService;
  oauth: OAuthFlow | null;
}> = async (app, { accounts, oauth }) => {
  const cfg = accounts.cfg;
  const tight = rateLimit("auth-write", 20, 15 * 60_000);
  const loose = rateLimit("auth-read", 120, 60_000);

  app.get("/auth/config", { preHandler: [loose] }, async () => ({
    native: true,
    passwordLogin: cfg.passwordLogin,
    signupMode: cfg.signupMode,
    requireEmailVerification: cfg.requireEmailVerification,
    providers: oauth?.enabled() ?? [],
  }));

  app.post("/auth/signup", { preHandler: [tight] }, async (req, reply) => {
    const body = parseWith(
      z.object({
        email: Email,
        name: z.string().trim().min(1).max(120),
        password: Password,
        inviteToken: z.string().max(200).optional(),
      }),
      req.body,
      "sign-up",
    );
    const res = await accounts.signup(body, meta(req));
    return reply.status(res.session ? 201 : 202).send({
      requiresVerification: res.requiresVerification,
      ...(res.session ? { session: res.session } : {}),
    });
  });

  app.post("/auth/login", { preHandler: [tight] }, async (req) => {
    const body = parseWith(z.object({ email: Email, password: Password }), req.body, "login");
    return accounts.login(body, meta(req));
  });

  app.post("/auth/verify", { preHandler: [tight] }, async (req, reply) => {
    const { token } = parseWith(
      z.object({ token: z.string().min(1).max(200) }),
      req.body,
      "request",
    );
    await accounts.verifyEmail(token, meta(req));
    return reply.status(204).send();
  });

  app.post("/auth/forgot", { preHandler: [tight] }, async (req, reply) => {
    const { email } = parseWith(z.object({ email: Email }), req.body, "request");
    await accounts.forgot(email, meta(req));
    // Always the same answer, whether or not the address has an account.
    return reply.status(202).send({ ok: true });
  });

  app.post("/auth/reset", { preHandler: [tight] }, async (req, reply) => {
    const body = parseWith(
      z.object({ token: z.string().min(1).max(200), password: Password }),
      req.body,
      "request",
    );
    await accounts.reset(body.token, body.password, meta(req));
    return reply.status(204).send();
  });

  app.post("/auth/invitations/preview", { preHandler: [tight] }, async (req) => {
    const { token } = parseWith(
      z.object({ token: z.string().min(1).max(200) }),
      req.body,
      "request",
    );
    return accounts.previewInvitation(token);
  });

  // ------------------------------------------------------------- providers
  const provider = (raw: unknown): ProviderName => {
    if (
      !oauth ||
      !PROVIDER_NAMES.includes(raw as ProviderName) ||
      !oauth.enabled().includes(raw as ProviderName)
    ) {
      throw new NotFoundError("Unknown sign-in provider");
    }
    return raw as ProviderName;
  };
  const back = (reply: FastifyReply, query: Record<string, string>) =>
    reply.redirect(`${cfg.webBaseUrl}/login/callback?${new URLSearchParams(query).toString()}`);

  app.get("/auth/oauth/:provider/start", { preHandler: [tight] }, async (req, reply) => {
    const name = provider((req.params as { provider: string }).provider);
    const { url, nonce } = await oauth!.start(name);
    const secure = cfg.apiPublicUrl.startsWith("https://") ? "; Secure" : "";
    void reply.header(
      "set-cookie",
      `${OAUTH_COOKIE}=${nonce}; Path=/api/v1/auth/oauth; HttpOnly; SameSite=Lax; Max-Age=600${secure}`,
    );
    return reply.redirect(url);
  });

  app.get("/auth/oauth/:provider/callback", { preHandler: [tight] }, async (req, reply) => {
    const name = provider((req.params as { provider: string }).provider);
    const q = req.query as Record<string, string | undefined>;
    void reply.header("set-cookie", `${OAUTH_COOKIE}=; Path=/api/v1/auth/oauth; Max-Age=0`);
    if (q["error"] || !q["code"] || !q["state"]) {
      return back(reply, { error: "The sign-in was cancelled or failed. Try again." });
    }
    try {
      const profile = await oauth!.complete(
        name,
        q["code"],
        q["state"],
        readCookie(req, OAUTH_COOKIE),
      );
      const code = await accounts.signInWithProvider(name, profile, meta(req));
      return back(reply, { code });
    } catch (err) {
      req.log.info({ err: (err as Error).message }, "oauth sign-in failed");
      const shown = err instanceof ForbiddenError ? err.message : "Sign-in failed. Try again.";
      return back(reply, { error: shown });
    }
  });

  app.post("/auth/oauth/exchange", { preHandler: [tight] }, async (req) => {
    const { code } = parseWith(z.object({ code: z.string().min(1).max(200) }), req.body, "request");
    return accounts.exchangeCode(code, meta(req));
  });
};

const needAccount = (req: FastifyRequest): { id: string; tokenId: string; kind: string } => {
  const u = req.user;
  if (!u.accountId || !u.tokenId) {
    throw new ForbiddenError("This endpoint is only for accounts managed by this instance");
  }
  return { id: u.accountId, tokenId: u.tokenId, kind: u.tokenKind ?? "session" };
};

/** Routes behind authentication: the caller's own account, and admin tools. */
export const accountRoutes: FastifyPluginAsync<{ accounts: AccountService }> = async (
  app,
  { accounts },
) => {
  const tight = rateLimit("account-write", 30, 15 * 60_000);

  app.post("/auth/logout", async (req, reply) => {
    const a = needAccount(req);
    if (a.kind === "session") await accounts.logout(a.id, a.tokenId, meta(req));
    return reply.status(204).send();
  });

  app.get("/account", async (req) => {
    const a = needAccount(req);
    const user = await accounts.getUser(a.id);
    return {
      ...toPublic(user),
      identities: (await accounts.repo.identities.listByUser(a.id)).map((i) => ({
        provider: i.provider,
        email: i.email,
        linkedAt: i.createdAt,
      })),
      tokenKind: a.kind,
    };
  });

  app.patch("/account", async (req) => {
    const a = needAccount(req);
    const { name } = parseWith(
      z.object({ name: z.string().trim().min(1).max(120) }),
      req.body,
      "profile",
    );
    return accounts.updateName(a.id, name, meta(req));
  });

  app.post("/account/password", { preHandler: [tight] }, async (req, reply) => {
    const a = needAccount(req);
    const body = parseWith(
      z.object({ currentPassword: z.string().max(256).optional(), newPassword: Password }),
      req.body,
      "password",
    );
    await accounts.changePassword(
      a.id,
      { current: body.currentPassword, next: body.newPassword },
      a.kind === "session" ? a.tokenId : null,
      meta(req),
    );
    return reply.status(204).send();
  });

  app.get("/account/sessions", async (req) => {
    const a = needAccount(req);
    return (await accounts.listSessions(a.id)).map((t) => sessionView(t, a.tokenId));
  });

  app.delete("/account/sessions/:id", async (req, reply) => {
    const a = needAccount(req);
    await accounts.revokeToken(a.id, (req.params as { id: string }).id, meta(req));
    return reply.status(204).send();
  });

  app.post("/account/sessions/revoke-others", async (req) => {
    const a = needAccount(req);
    return { revoked: await accounts.revokeOtherSessions(a.id, a.tokenId, meta(req)) };
  });

  app.get("/account/tokens", async (req) => {
    const a = needAccount(req);
    return (await accounts.listApiTokens(a.id)).map((t) => ({
      id: t.id,
      name: t.name,
      prefix: t.prefix,
      roles: t.roles,
      createdAt: t.createdAt,
      lastUsedAt: t.lastUsedAt,
      expiresAt: t.expiresAt,
    }));
  });

  app.post("/account/tokens", { preHandler: [tight] }, async (req, reply) => {
    const a = needAccount(req);
    if (a.kind !== "session")
      throw new ForbiddenError("Create API tokens from a signed-in session");
    const body = parseWith(
      z.object({
        name: z.string().trim().min(1).max(100),
        roles: z.array(Role).max(5).optional(),
        expiresInDays: z.number().int().min(1).max(365).optional(),
      }),
      req.body,
      "token",
    );
    const user = await accounts.getUser(a.id);
    const { token, row } = await accounts.createApiToken(user, body, meta(req));
    // The secret is shown once; only its hash is stored.
    return reply.status(201).send({
      token,
      id: row.id,
      name: row.name,
      prefix: row.prefix,
      roles: row.roles,
      expiresAt: row.expiresAt,
    });
  });

  app.delete("/account/tokens/:id", async (req, reply) => {
    const a = needAccount(req);
    await accounts.revokeToken(a.id, (req.params as { id: string }).id, meta(req));
    return reply.status(204).send();
  });

  app.delete("/account/identities/:provider", async (req, reply) => {
    const a = needAccount(req);
    await accounts.unlinkIdentity(a.id, (req.params as { provider: string }).provider, meta(req));
    return reply.status(204).send();
  });

  app.get("/account/export", async (req, reply) => {
    const a = needAccount(req);
    void reply.header("content-disposition", 'attachment; filename="account-export.json"');
    return accounts.exportData(a.id);
  });

  app.post("/account/delete", { preHandler: [tight] }, async (req, reply) => {
    const a = needAccount(req);
    const body = parseWith(
      z.object({ email: z.string().max(254), password: z.string().max(256).optional() }),
      req.body,
      "request",
    );
    await accounts.deleteAccount(a.id, body, meta(req));
    return reply.status(204).send();
  });

  // ------------------------------------------------------------------ admin
  const admin = requireRoles();

  app.get("/admin/users", { preHandler: [admin] }, async () => accounts.listUsers());

  app.patch("/admin/users/:id", { preHandler: [admin] }, async (req) => {
    const body = parseWith(
      z.object({
        name: z.string().trim().min(1).max(120).optional(),
        roles: z.array(Role).max(5).optional(),
        clientIds: Scope.optional(),
        team: z.string().trim().max(64).nullable().optional(),
        disabled: z.boolean().optional(),
      }),
      req.body,
      "user",
    );
    return accounts.adminUpdate(
      req.user.subject,
      (req.params as { id: string }).id,
      body,
      meta(req),
    );
  });

  app.delete("/admin/users/:id", { preHandler: [admin] }, async (req, reply) => {
    await accounts.adminDelete(req.user.subject, (req.params as { id: string }).id, meta(req));
    return reply.status(204).send();
  });

  app.get("/admin/invitations", { preHandler: [admin] }, async () =>
    (await accounts.listInvitations()).map(({ tokenHash: _t, ...rest }) => rest),
  );

  app.post("/admin/invitations", { preHandler: [admin] }, async (req, reply) => {
    const body = parseWith(
      z.object({
        email: Email,
        roles: z.array(Role).min(1).max(5),
        clientIds: Scope,
        team: z.string().trim().max(64).nullable().optional(),
      }),
      req.body,
      "invitation",
    );
    const actor = req.user.accountId ? await accounts.getUser(req.user.accountId) : null;
    if (!actor)
      throw new BadRequestError("Invitations need an administrator account on this instance");
    const { invitation, link } = await accounts.createInvitation(
      actor,
      { ...body, clientIds: body.clientIds as ClientScope },
      meta(req),
    );
    const { tokenHash: _t, ...rest } = invitation;
    // The link is shown once; it is also mailed when SMTP is configured.
    return reply.status(201).send({ ...rest, link });
  });

  app.delete("/admin/invitations/:id", { preHandler: [admin] }, async (req, reply) => {
    await accounts.revokeInvitation(req.user.subject, (req.params as { id: string }).id, meta(req));
    return reply.status(204).send();
  });

  app.get("/admin/audit", { preHandler: [admin] }, async (req) => {
    const q = parseWith(
      z.object({
        limit: z.coerce.number().int().min(1).max(500).default(100),
        before: z.string().max(40).optional(),
      }),
      req.query,
      "query",
    );
    return accounts.listAudit(q.limit, q.before);
  });
};
