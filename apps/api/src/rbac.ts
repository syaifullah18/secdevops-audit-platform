import type { AccessScope, Role } from "@sdap/core";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { AuthUser, AuthVerifier } from "./auth.js";
import { ForbiddenError, UnauthorizedError } from "./errors.js";

declare module "fastify" {
  interface FastifyRequest {
    user: AuthUser;
    scope: AccessScope;
  }
}

/** Authenticates the bearer token and sets `req.user` and the isolation `req.scope`. */
export const createAuthPreHandler = (authVerifier: AuthVerifier) => {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const authHeader = req.headers.authorization;
    const match = authHeader ? /^Bearer\s+(\S+)$/i.exec(authHeader) : null;
    if (!match?.[1]) {
      void reply.header("www-authenticate", "Bearer");
      throw new UnauthorizedError("Missing or malformed Authorization header");
    }

    let user: AuthUser;
    try {
      user = await authVerifier.verify(match[1]);
    } catch (err) {
      // Details (expired, bad signature, wrong audience, ...) go to the log, not the caller.
      req.log.info({ err: (err as Error).message }, "token verification failed");
      void reply.header("www-authenticate", 'Bearer error="invalid_token"');
      throw new UnauthorizedError("Invalid or expired token");
    }
    if (user.roles.length === 0) {
      throw new ForbiddenError("Token carries no recognised role");
    }
    req.user = user;
    req.scope = { clientIds: user.clientIds };
  };
};

export const hasAnyRole = (user: AuthUser, ...roles: Role[]): boolean =>
  user.roles.some((r) => roles.includes(r));

/** Route guard: the caller needs at least one of `allowedRoles`. `admin` is always allowed. */
export const requireRoles = (...allowedRoles: Role[]) => {
  return async (req: FastifyRequest): Promise<void> => {
    if (!req.user) throw new UnauthorizedError();
    if (!hasAnyRole(req.user, "admin", ...allowedRoles)) {
      throw new ForbiddenError(`Requires one of: ${["admin", ...allowedRoles].join(", ")}`);
    }
  };
};

/** True when the caller may act on `clientId` (used before creating or moving a project). */
export const scopeIncludes = (scope: AccessScope, clientId: string): boolean =>
  scope.clientIds === "*" || scope.clientIds.includes(clientId);
