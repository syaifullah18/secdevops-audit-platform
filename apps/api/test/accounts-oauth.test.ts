import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { MemoryAccountRepo } from "../src/accounts/memory-repo.js";
import { MemoryMailer } from "../src/accounts/mailer.js";
import { OAuthFlow } from "../src/accounts/oauth.js";
import { AccountService } from "../src/accounts/service.js";
import { loadConfig } from "../src/config.js";
import { MemoryQueue } from "../src/queue.js";
import { MemoryStore } from "./fake-store.js";

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

describe("provider sign-in (GitHub, PKCE)", () => {
  let app: FastifyInstance;
  let svc: AccountService;
  let profile: { id: number; verified: boolean; email: string };
  let tokenBody: string;

  beforeEach(async () => {
    profile = { id: 4242, verified: true, email: "dev@example.test" };
    const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith("/login/oauth/access_token")) {
        tokenBody = String(init?.body);
        return json({ access_token: "gho_fake" });
      }
      if (u.endsWith("/user")) return json({ id: profile.id, login: "dev", name: "Dev Eloper" });
      if (u.endsWith("/user/emails")) {
        return json([{ email: profile.email, primary: true, verified: profile.verified }]);
      }
      return new Response("nope", { status: 404 });
    }) as typeof fetch;

    const accounts = {
      ...loadConfig({}, {}).accounts,
      enabled: true,
      signupMode: "open" as const,
      requireEmailVerification: false,
      webBaseUrl: "https://app.test",
      apiPublicUrl: "https://api.test",
    };
    svc = new AccountService(new MemoryAccountRepo(), new MemoryMailer(), accounts);
    const oauth = new OAuthFlow(
      "x".repeat(40),
      { github: { clientId: "cid", clientSecret: "secret" } },
      "https://api.test",
      fakeFetch,
    );
    app = await buildApp({
      store: new MemoryStore(),
      queue: new MemoryQueue(),
      accounts: svc,
      oauth,
      config: { logLevel: "silent", accounts },
    });
  });
  afterEach(async () => {
    await app.close();
  });

  const start = async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/auth/oauth/github/start" });
    const location = new URL(res.headers.location as string);
    const cookie = String(res.headers["set-cookie"]).split(";")[0]!;
    return { res, location, cookie };
  };

  it("advertises only configured providers", async () => {
    const cfg = (await app.inject({ method: "GET", url: "/api/v1/auth/config" })).json();
    expect(cfg.providers).toEqual(["github"]);
    expect(
      (await app.inject({ method: "GET", url: "/api/v1/auth/oauth/google/start" })).statusCode,
    ).toBe(404);
  });

  it("redirects with PKCE S256 and a state bound to an HttpOnly cookie", async () => {
    const { res, location } = await start();
    expect(res.statusCode).toBe(302);
    expect(location.origin + location.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(location.searchParams.get("code_challenge_method")).toBe("S256");
    expect(location.searchParams.get("redirect_uri")).toBe(
      "https://api.test/api/v1/auth/oauth/github/callback",
    );
    expect(String(res.headers["set-cookie"])).toMatch(/HttpOnly.*SameSite=Lax/);
  });

  it("signs a new user in through a one-time code, not a session in the URL", async () => {
    const { location, cookie } = await start();
    const state = location.searchParams.get("state")!;
    const cb = await app.inject({
      method: "GET",
      url: `/api/v1/auth/oauth/github/callback?code=abc&state=${state}`,
      headers: { cookie },
    });
    expect(cb.statusCode).toBe(302);
    const back = new URL(cb.headers.location as string);
    expect(back.origin + back.pathname).toBe("https://app.test/login/callback");
    expect(back.searchParams.get("code")).toMatch(/^x_/);
    expect(tokenBody).toContain("code_verifier=");

    const ex = await app.inject({
      method: "POST",
      url: "/api/v1/auth/oauth/exchange",
      payload: { code: back.searchParams.get("code") },
    });
    expect(ex.statusCode).toBe(200);
    expect(ex.json().user).toMatchObject({
      email: "dev@example.test",
      roles: ["admin"],
      hasPassword: false,
    });
    // The code works once.
    const again = await app.inject({
      method: "POST",
      url: "/api/v1/auth/oauth/exchange",
      payload: { code: back.searchParams.get("code") },
    });
    expect(again.statusCode).toBe(400);
  });

  it("refuses a callback whose state does not match the browser cookie", async () => {
    const { location } = await start();
    const cb = await app.inject({
      method: "GET",
      url: `/api/v1/auth/oauth/github/callback?code=abc&state=${location.searchParams.get("state")}`,
      headers: { cookie: "sdap_oauth=someone-elses-nonce" },
    });
    expect(new URL(cb.headers.location as string).searchParams.get("error")).toBeTruthy();
    expect(await svc.repo.users.count()).toBe(0);
  });

  it("does not match an account by an address the provider has not verified", async () => {
    await svc.signup({
      email: "dev@example.test",
      name: "Pw User",
      password: "correct horse battery",
    });
    profile.verified = false;
    const { location, cookie } = await start();
    const cb = await app.inject({
      method: "GET",
      url: `/api/v1/auth/oauth/github/callback?code=abc&state=${location.searchParams.get("state")}`,
      headers: { cookie },
    });
    expect(new URL(cb.headers.location as string).searchParams.get("error")).toMatch(/verified/);
  });

  it("links to an existing account by a provider-verified address and keeps its password", async () => {
    await svc.signup({
      email: "dev@example.test",
      name: "Pw User",
      password: "correct horse battery",
    });
    const { location, cookie } = await start();
    const cb = await app.inject({
      method: "GET",
      url: `/api/v1/auth/oauth/github/callback?code=abc&state=${location.searchParams.get("state")}`,
      headers: { cookie },
    });
    const code = new URL(cb.headers.location as string).searchParams.get("code")!;
    const ex = await app.inject({
      method: "POST",
      url: "/api/v1/auth/oauth/exchange",
      payload: { code },
    });
    expect(ex.json().user.hasPassword).toBe(true);
    const token = ex.json().token as string;
    const me = await app.inject({
      method: "GET",
      url: "/api/v1/account",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(me.json().identities).toEqual([expect.objectContaining({ provider: "github" })]);
    // The only remaining way to sign in must not be removable.
    const un = await app.inject({
      method: "DELETE",
      url: "/api/v1/account/identities/github",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(un.statusCode).toBe(204); // a password still exists, so unlinking is allowed
  });
});
