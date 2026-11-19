import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { MemoryAccountRepo } from "../src/accounts/memory-repo.js";
import { MemoryMailer } from "../src/accounts/mailer.js";
import { AccountService } from "../src/accounts/service.js";
import { loadConfig } from "../src/config.js";
import { MemoryQueue } from "../src/queue.js";
import { MemoryStore } from "./fake-store.js";

const PW = "correct horse battery";
const WEB = { "x-sdap-csrf": "1" };

describe("browser sessions use an HttpOnly cookie", () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    const accounts = {
      ...loadConfig({}, {}).accounts,
      enabled: true,
      signupMode: "open" as const,
      requireEmailVerification: false,
      webBaseUrl: "https://app.test",
      apiPublicUrl: "https://app.test",
    };
    app = await buildApp({
      store: new MemoryStore(),
      queue: new MemoryQueue(),
      accounts: new AccountService(new MemoryAccountRepo(), new MemoryMailer(), accounts),
      config: { logLevel: "silent", accounts },
    });
  });
  afterEach(async () => app.close());

  const signup = (headers: Record<string, string> = WEB) =>
    app.inject({
      method: "POST",
      url: "/api/v1/auth/signup",
      headers,
      payload: { email: "a@example.test", name: "A", password: PW },
    });
  const cookieOf = (res: { headers: Record<string, unknown> }): string => {
    const raw = res.headers["set-cookie"];
    return String(Array.isArray(raw) ? raw[0] : raw);
  };

  it("sets a Strict, HttpOnly, Secure cookie and keeps the token out of the body", async () => {
    const res = await signup();
    expect(res.statusCode).toBe(201);
    expect(res.json().session.token).toBeUndefined();
    const c = cookieOf(res);
    expect(c).toMatch(/^sdap_session=sdap_s_/);
    expect(c).toMatch(/HttpOnly/);
    expect(c).toMatch(/SameSite=Strict/);
    expect(c).toMatch(/Secure/);
    expect(c).toMatch(/Path=\/api\/v1/);
  });

  it("authenticates later calls from the cookie alone", async () => {
    const cookie = cookieOf(await signup()).split(";")[0]!;
    const me = await app.inject({ method: "GET", url: "/api/v1/account", headers: { cookie } });
    expect(me.statusCode).toBe(200);
    expect(me.json().email).toBe("a@example.test");
  });

  it("refuses a state-changing call that relies on the cookie without the CSRF header", async () => {
    const cookie = cookieOf(await signup()).split(";")[0]!;
    const patch = (headers: Record<string, string>) =>
      app.inject({
        method: "PATCH",
        url: "/api/v1/account",
        headers: { cookie, ...headers },
        payload: { name: "B" },
      });
    expect((await patch({})).statusCode).toBe(403);
    expect((await patch(WEB)).statusCode).toBe(200);
  });

  it("does not need the CSRF header when a bearer token is used", async () => {
    const res = await signup({});
    expect(res.headers["set-cookie"]).toBeUndefined();
    const token = res.json().session.token as string;
    expect(token).toMatch(/^sdap_s_/);
    const patch = await app.inject({
      method: "PATCH",
      url: "/api/v1/account",
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "C" },
    });
    expect(patch.statusCode).toBe(200);
  });

  it("logs in with the cookie too, and a wrong password sets none", async () => {
    await signup();
    const bad = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      headers: WEB,
      payload: { email: "a@example.test", password: "nope nope nope" },
    });
    expect(bad.statusCode).toBe(401);
    expect(bad.headers["set-cookie"]).toBeUndefined();
    const ok = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      headers: WEB,
      payload: { email: "a@example.test", password: PW },
    });
    expect(ok.statusCode).toBe(200);
    expect(cookieOf(ok)).toMatch(/^sdap_session=sdap_s_/);
    expect(ok.json().token).toBeUndefined();
  });

  it("sign-out revokes the session and clears the cookie", async () => {
    const cookie = cookieOf(await signup()).split(";")[0]!;
    const out = await app.inject({
      method: "POST",
      url: "/api/v1/auth/logout",
      headers: { cookie, ...WEB },
    });
    expect(out.statusCode).toBe(204);
    expect(cookieOf(out)).toMatch(/^sdap_session=;.*Max-Age=0/);
    const again = await app.inject({ method: "GET", url: "/api/v1/account", headers: { cookie } });
    expect(again.statusCode).toBe(401);
  });

  it("answers 401 and removes a cookie that no longer maps to a session", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/account",
      headers: { cookie: "sdap_session=sdap_s_unknown" },
    });
    expect(res.statusCode).toBe(401);
    expect(cookieOf(res)).toMatch(/Max-Age=0/);
  });

  it("ignores the cookie when an Authorization header is present", async () => {
    const cookie = cookieOf(await signup()).split(";")[0]!;
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/account",
      headers: { cookie, authorization: "Bearer sdap_s_wrong" },
    });
    expect(res.statusCode).toBe(401);
  });
});
