import type { FastifyReply, FastifyRequest } from "fastify";

/**
 * The browser keeps its session in an HttpOnly cookie, so page scripts can never read it.
 * - Path `/api/v1`: only API calls carry it.
 * - SameSite=Strict: it is not sent on requests started by other sites.
 * - Secure: set whenever the public URL is https.
 * State-changing calls that rely on the cookie must also send `X-SDAP-CSRF`: a custom header
 * cannot be added by another site without a CORS preflight, which this API never grants.
 */
export const SESSION_COOKIE = "sdap_session";
export const CSRF_HEADER = "x-sdap-csrf";
const COOKIE_PATH = "/api/v1";

export const readCookie = (req: FastifyRequest, name: string): string | undefined => {
  const raw = req.headers.cookie;
  if (!raw) return undefined;
  for (const part of raw.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return rest.join("=");
  }
  return undefined;
};

/** True for the web app, which always sends the CSRF header and wants a cookie, not a body token. */
export const isBrowserRequest = (req: FastifyRequest): boolean => {
  const v = req.headers[CSRF_HEADER];
  return typeof v === "string" && v.length > 0;
};

const attrs = (secure: boolean): string =>
  `Path=${COOKIE_PATH}; HttpOnly; SameSite=Strict${secure ? "; Secure" : ""}`;

export const setSessionCookie = (
  reply: FastifyReply,
  token: string,
  expiresAt: string,
  secure: boolean,
): void => {
  const maxAge = Math.max(0, Math.floor((Date.parse(expiresAt) - Date.now()) / 1000));
  void reply.header(
    "set-cookie",
    `${SESSION_COOKIE}=${token}; ${attrs(secure)}; Max-Age=${maxAge}`,
  );
};

export const clearSessionCookie = (reply: FastifyReply, secure: boolean): void => {
  void reply.header("set-cookie", `${SESSION_COOKIE}=; ${attrs(secure)}; Max-Age=0`);
};
