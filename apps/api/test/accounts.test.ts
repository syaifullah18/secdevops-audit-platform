import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { MemoryAccountRepo } from "../src/accounts/memory-repo.js";
import type { AccountRepo } from "../src/accounts/types.js";
import { createPglitePgRepo } from "./pglite-repo.js";
import { MemoryMailer } from "../src/accounts/mailer.js";
import { AccountService } from "../src/accounts/service.js";
import type { AccountsConfig } from "../src/config.js";
import { loadConfig } from "../src/config.js";
import { MemoryQueue } from "../src/queue.js";
import { MemoryStore } from "./fake-store.js";

const PW = "correct horse battery";

interface Ctx {
  app: FastifyInstance;
  mailer: MemoryMailer;
  svc: AccountService;
  repo: AccountRepo;
  close: () => Promise<void>;
  now: { t: number };
}

const make = async (
  over: Partial<AccountsConfig> = {},
  backend: "memory" | "postgres" = "memory",
): Promise<Ctx> => {
  const pg = backend === "postgres" ? await createPglitePgRepo() : null;
  const repo: AccountRepo = pg ? pg.repo : new MemoryAccountRepo();
  const mailer = new MemoryMailer();
  const now = { t: Date.parse("2026-11-08T10:00:00Z") };
  const cfg = loadConfig({}, {}).accounts;
  const accounts: AccountsConfig = {
    ...cfg,
    enabled: true,
    signupMode: "open",
    requireEmailVerification: false,
    webBaseUrl: "https://app.test",
    ...over,
  };
  const svc = new AccountService(repo, mailer, accounts, () => new Date(now.t));
  const app = await buildApp({
    store: new MemoryStore(),
    queue: new MemoryQueue(),
    accounts: svc,
    config: { logLevel: "silent", accounts },
  });
  return {
    app,
    mailer,
    svc,
    repo,
    now,
    close: async () => {
      await app.close();
      await pg?.close();
    },
  };
};

const post = (c: Ctx, url: string, body: unknown, token?: string) =>
  c.app.inject({
    method: "POST",
    url: `/api/v1${url}`,
    payload: body as object,
    ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}),
  });
const call = (
  c: Ctx,
  method: "GET" | "PATCH" | "DELETE",
  url: string,
  token: string,
  body?: unknown,
) =>
  c.app.inject({
    method,
    url: `/api/v1${url}`,
    headers: { authorization: `Bearer ${token}` },
    ...(body ? { payload: body as object } : {}),
  });

const signup = async (c: Ctx, email: string, name = "Test User") => {
  const res = await post(c, "/auth/signup", { email, name, password: PW });
  return { res, body: res.json() as { session?: { token: string; user: { roles: string[] } } } };
};

describe.each(["memory", "postgres"] as const)("native accounts on %s", (backend) => {
  let c: Ctx;
  beforeEach(async () => {
    c = await make({}, backend);
  });
  afterEach(async () => {
    await c.close();
  });

  it("makes the first sign-up an admin with access to every client, later ones viewers with none", async () => {
    const first = await signup(c, "owner@example.test");
    expect(first.res.statusCode).toBe(201);
    expect(first.body.session?.user.roles).toEqual(["admin"]);
    const second = await signup(c, "viewer@example.test");
    const me = await call(c, "GET", "/account", second.body.session!.token);
    expect(me.json()).toMatchObject({ roles: ["viewer"], clientIds: [] });
    const ownerMe = await call(c, "GET", "/account", first.body.session!.token);
    expect(ownerMe.json().clientIds).toBe("*");
  });

  it("rejects short passwords and duplicate emails", async () => {
    expect(
      (await post(c, "/auth/signup", { email: "a@example.test", name: "A", password: "short" }))
        .statusCode,
    ).toBe(400);
    await signup(c, "dup@example.test");
    expect((await signup(c, "DUP@example.test")).res.statusCode).toBe(409);
  });

  it("logs in with the right password and gives the same error for a wrong one or an unknown email", async () => {
    await signup(c, "u@example.test");
    const ok = await post(c, "/auth/login", { email: "U@example.test", password: PW });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().token).toMatch(/^sdap_s_/);
    const wrong = await post(c, "/auth/login", {
      email: "u@example.test",
      password: "nope-nope-nope",
    });
    const unknown = await post(c, "/auth/login", { email: "who@example.test", password: PW });
    expect(wrong.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(wrong.json().message).toBe(unknown.json().message);
  });

  it("locks the account after repeated failures", async () => {
    await signup(c, "lock@example.test");
    for (let i = 0; i < 5; i++) {
      await post(c, "/auth/login", { email: "lock@example.test", password: "wrong-wrong-wrong" });
    }
    const res = await post(c, "/auth/login", { email: "lock@example.test", password: PW });
    expect(res.statusCode).toBe(403);
    c.now.t += 16 * 60_000;
    expect(
      (await post(c, "/auth/login", { email: "lock@example.test", password: PW })).statusCode,
    ).toBe(200);
  });

  it("ends the session on logout and after expiry", async () => {
    const { body } = await signup(c, "s@example.test");
    const token = body.session!.token;
    expect((await call(c, "GET", "/account", token)).statusCode).toBe(200);
    await post(c, "/auth/logout", {}, token);
    expect((await call(c, "GET", "/account", token)).statusCode).toBe(401);

    const again = (await post(c, "/auth/login", { email: "s@example.test", password: PW })).json()
      .token;
    c.now.t += 15 * 86_400_000;
    expect((await call(c, "GET", "/account", again)).statusCode).toBe(401);
  });

  it("sends a verification mail and blocks login until it is used", async () => {
    await c.close();
    c = await make(
      {
        requireEmailVerification: true,
        signupMode: "open",
        bootstrapAdminEmail: "someone@else.test",
      },
      backend,
    );
    const res = await post(c, "/auth/signup", { email: "v@example.test", name: "V", password: PW });
    expect(res.statusCode).toBe(202);
    expect(res.json().requiresVerification).toBe(true);
    expect(
      (await post(c, "/auth/login", { email: "v@example.test", password: PW })).statusCode,
    ).toBe(403);

    const token = /verify\/(\S+)/.exec(c.mailer.last()!.text)![1]!;
    expect((await post(c, "/auth/verify", { token })).statusCode).toBe(204);
    expect((await post(c, "/auth/verify", { token })).statusCode).toBe(400);
    expect(
      (await post(c, "/auth/login", { email: "v@example.test", password: PW })).statusCode,
    ).toBe(200);
  });

  it("resets a password with a one-time link and signs out other sessions", async () => {
    const { body } = await signup(c, "r@example.test");
    const old = body.session!.token;
    expect((await post(c, "/auth/forgot", { email: "ghost@example.test" })).statusCode).toBe(202);
    expect(c.mailer.sent).toHaveLength(0);
    expect((await post(c, "/auth/forgot", { email: "r@example.test" })).statusCode).toBe(202);
    const token = /reset\/(\S+)/.exec(c.mailer.last()!.text)![1]!;
    expect(
      (await post(c, "/auth/reset", { token, password: "a brand new password" })).statusCode,
    ).toBe(204);
    expect(
      (await post(c, "/auth/reset", { token, password: "another new password" })).statusCode,
    ).toBe(400);
    expect((await call(c, "GET", "/account", old)).statusCode).toBe(401);
    expect(
      (await post(c, "/auth/login", { email: "r@example.test", password: "a brand new password" }))
        .statusCode,
    ).toBe(200);
  });

  it("changes password only with the current one and keeps the calling session", async () => {
    const { body } = await signup(c, "p@example.test");
    const keep = body.session!.token;
    const other = (await post(c, "/auth/login", { email: "p@example.test", password: PW })).json()
      .token;
    expect(
      (
        await post(
          c,
          "/account/password",
          { currentPassword: "wrong-wrong-wrong", newPassword: "new password here" },
          keep,
        )
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await post(
          c,
          "/account/password",
          { currentPassword: PW, newPassword: "new password here" },
          keep,
        )
      ).statusCode,
    ).toBe(204);
    expect((await call(c, "GET", "/account", keep)).statusCode).toBe(200);
    expect((await call(c, "GET", "/account", other)).statusCode).toBe(401);
  });

  it("lists and revokes sessions", async () => {
    const { body } = await signup(c, "l@example.test");
    const a = body.session!.token;
    const b = (await post(c, "/auth/login", { email: "l@example.test", password: PW })).json()
      .token;
    const list = (await call(c, "GET", "/account/sessions", a)).json() as Array<{
      id: string;
      current: boolean;
    }>;
    expect(list).toHaveLength(2);
    expect(list.filter((s) => s.current)).toHaveLength(1);
    expect((await post(c, "/account/sessions/revoke-others", {}, a)).json().revoked).toBe(1);
    expect((await call(c, "GET", "/account", b)).statusCode).toBe(401);
  });

  it("issues API tokens that never exceed the owner's roles and show the secret once", async () => {
    const { body } = await signup(c, "t@example.test");
    const session = body.session!.token;
    const created = await post(
      c,
      "/account/tokens",
      { name: "ci", roles: ["viewer"], expiresInDays: 30 },
      session,
    );
    expect(created.statusCode).toBe(201);
    const { token } = created.json() as { token: string };
    expect(token).toMatch(/^sdap_pat_/);
    const list = (await call(c, "GET", "/account/tokens", session)).json() as Array<
      Record<string, unknown>
    >;
    expect(JSON.stringify(list)).not.toContain(token);

    // The token authenticates but is limited to the viewer role, so admin routes refuse it.
    expect((await call(c, "GET", "/projects", token)).statusCode).toBe(200);
    expect((await call(c, "GET", "/admin/users", token)).statusCode).toBe(403);
    // A token cannot mint more tokens.
    expect((await post(c, "/account/tokens", { name: "x" }, token)).statusCode).toBe(403);

    const id = (list[0] as { id: string }).id;
    expect((await call(c, "DELETE", `/account/tokens/${id}`, session)).statusCode).toBe(204);
    expect((await call(c, "GET", "/projects", token)).statusCode).toBe(401);

    const viewer = await signup(c, "viewer@example.test");
    const denied = await post(
      c,
      "/account/tokens",
      { name: "too much", roles: ["security"] },
      viewer.body.session!.token,
    );
    expect(denied.statusCode).toBe(403);
  });

  it("limits user administration to admins and protects the last admin", async () => {
    const owner = (await signup(c, "owner@example.test")).body.session!;
    const user = (await signup(c, "u2@example.test")).body.session!;
    expect((await call(c, "GET", "/admin/users", user.token)).statusCode).toBe(403);

    const users = (await call(c, "GET", "/admin/users", owner.token)).json() as Array<{
      id: string;
      email: string;
    }>;
    const u2 = users.find((u) => u.email === "u2@example.test")!;
    const promoted = await call(c, "PATCH", `/admin/users/${u2.id}`, owner.token, {
      roles: ["security"],
      clientIds: ["client-a"],
      team: "red",
    });
    expect(promoted.json()).toMatchObject({
      roles: ["security"],
      clientIds: ["client-a"],
      team: "red",
    });

    const ownerId = users.find((u) => u.email === "owner@example.test")!.id;
    expect(
      (await call(c, "PATCH", `/admin/users/${ownerId}`, owner.token, { roles: ["viewer"] }))
        .statusCode,
    ).toBe(409);
    expect(
      (await call(c, "PATCH", `/admin/users/${ownerId}`, owner.token, { disabled: true }))
        .statusCode,
    ).toBe(409);

    await call(c, "PATCH", `/admin/users/${u2.id}`, owner.token, { disabled: true });
    expect((await call(c, "GET", "/account", user.token)).statusCode).toBe(401);
    expect(
      (await post(c, "/auth/login", { email: "u2@example.test", password: PW })).statusCode,
    ).toBe(403);
  });

  it("closes sign-up in invite mode, and an invitation creates an account with its roles", async () => {
    await c.close();
    c = await make({ signupMode: "invite" }, backend);
    const owner = (await signup(c, "owner@example.test")).body.session!;
    expect((await signup(c, "rando@example.test")).res.statusCode).toBe(403);

    const inv = await post(
      c,
      "/admin/invitations",
      { email: "new@example.test", roles: ["developer"], clientIds: ["client-a"], team: "blue" },
      owner.token,
    );
    expect(inv.statusCode).toBe(201);
    const link = (inv.json() as { link: string }).link;
    const invite = new URL(link).searchParams.get("invite")!;
    expect((await post(c, "/auth/invitations/preview", { token: invite })).json().email).toBe(
      "new@example.test",
    );

    const wrong = await post(c, "/auth/signup", {
      email: "other@example.test",
      name: "O",
      password: PW,
      inviteToken: invite,
    });
    expect(wrong.statusCode).toBe(400);
    const ok = await post(c, "/auth/signup", {
      email: "new@example.test",
      name: "N",
      password: PW,
      inviteToken: invite,
    });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().session.user).toMatchObject({
      roles: ["developer"],
      clientIds: ["client-a"],
      team: "blue",
    });
    expect(
      (
        await post(c, "/auth/signup", {
          email: "new@example.test",
          name: "N",
          password: PW,
          inviteToken: invite,
        })
      ).statusCode,
    ).toBe(400);
  });

  it("records account events in the audit log, readable by admins only", async () => {
    const owner = (await signup(c, "owner@example.test")).body.session!;
    await post(c, "/auth/login", { email: "owner@example.test", password: "bad-bad-bad-bad" });
    const user = (await signup(c, "u3@example.test")).body.session!;
    expect((await call(c, "GET", "/admin/audit", user.token)).statusCode).toBe(403);
    const events = (await call(c, "GET", "/admin/audit", owner.token)).json() as Array<{
      action: string;
    }>;
    const actions = events.map((e) => e.action);
    expect(actions).toContain("account.signup");
    expect(actions).toContain("account.login_failed");
  });

  it("deletes an account only with the email and password, and never the last admin", async () => {
    const owner = (await signup(c, "owner@example.test")).body.session!;
    const user = (await signup(c, "gone@example.test")).body.session!;
    expect(
      (
        await post(
          c,
          "/account/delete",
          { email: "gone@example.test", password: "wrong-wrong-wrong" },
          user.token,
        )
      ).statusCode,
    ).toBe(400);
    expect(
      (await post(c, "/account/delete", { email: "gone@example.test", password: PW }, user.token))
        .statusCode,
    ).toBe(204);
    expect(
      (await post(c, "/auth/login", { email: "gone@example.test", password: PW })).statusCode,
    ).toBe(401);
    expect(
      (await post(c, "/account/delete", { email: "owner@example.test", password: PW }, owner.token))
        .statusCode,
    ).toBe(409);
  });

  it("rejects an OIDC-style or unknown bearer on account routes", async () => {
    expect((await call(c, "GET", "/account", "not-a-real-token")).statusCode).toBe(401);
    expect((await c.app.inject({ method: "GET", url: "/api/v1/account" })).statusCode).toBe(401);
  });
});
