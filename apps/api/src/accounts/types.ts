import type { Role } from "@sdap/core";

export type ClientScope = string[] | "*";

export interface UserRow {
  id: string;
  /** Lower-cased; unique. */
  email: string;
  name: string;
  /** null when the account only signs in through a provider. */
  passwordHash: string | null;
  emailVerifiedAt: string | null;
  roles: Role[];
  clientIds: ClientScope;
  team: string | null;
  disabledAt: string | null;
  failedLogins: number;
  lockedUntil: string | null;
  createdAt: string;
  lastLoginAt: string | null;
}

export type AccessTokenKind = "session" | "api_token";

/** A bearer credential. Only the SHA-256 of the secret is stored. */
export interface AccessTokenRow {
  id: string;
  userId: string;
  kind: AccessTokenKind;
  name: string | null;
  tokenHash: string;
  /** First characters of the secret, to recognise it in a list. */
  prefix: string;
  /** Narrows the owner's roles (API tokens only); null = all of them. */
  roles: Role[] | null;
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  ip: string | null;
  userAgent: string | null;
}

export type OneTimePurpose = "verify_email" | "reset_password" | "oauth_exchange";

export interface OneTimeTokenRow {
  id: string;
  userId: string;
  purpose: OneTimePurpose;
  tokenHash: string;
  expiresAt: string;
  usedAt: string | null;
  createdAt: string;
}

export interface IdentityRow {
  provider: string;
  subject: string;
  userId: string;
  email: string | null;
  createdAt: string;
}

export interface InvitationRow {
  id: string;
  email: string;
  roles: Role[];
  clientIds: ClientScope;
  team: string | null;
  tokenHash: string;
  invitedBy: string;
  createdAt: string;
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
}

export interface AuditEventRow {
  id: string;
  at: string;
  actor: string;
  action: string;
  target: string | null;
  ip: string | null;
  details: Record<string, unknown> | null;
}

/** Persistence for native accounts. Implemented in memory (tests) and on PostgreSQL. */
export interface AccountRepo {
  users: {
    create(u: UserRow): Promise<UserRow>;
    get(id: string): Promise<UserRow | null>;
    getByEmail(email: string): Promise<UserRow | null>;
    update(id: string, patch: Partial<Omit<UserRow, "id" | "createdAt">>): Promise<UserRow>;
    list(): Promise<UserRow[]>;
    count(): Promise<number>;
    /** Removes the user and everything that belongs to it. */
    delete(id: string): Promise<void>;
  };
  tokens: {
    create(t: AccessTokenRow): Promise<void>;
    getByHash(hash: string): Promise<AccessTokenRow | null>;
    listByUser(userId: string, kind: AccessTokenKind): Promise<AccessTokenRow[]>;
    touch(id: string, at: string, expiresAt?: string | null): Promise<void>;
    revoke(id: string, userId: string, at: string): Promise<boolean>;
    /** Revokes every session of the user, except `exceptId`. Returns how many. */
    revokeSessions(userId: string, at: string, exceptId?: string): Promise<number>;
  };
  oneTime: {
    create(t: OneTimeTokenRow): Promise<void>;
    /** Marks a live token as used and returns it; null when unknown, used or expired. */
    consume(hash: string, purpose: OneTimePurpose, now: string): Promise<OneTimeTokenRow | null>;
    /** Invalidates earlier tokens of a purpose for a user (a new reset replaces the old link). */
    invalidate(userId: string, purpose: OneTimePurpose, now: string): Promise<void>;
  };
  identities: {
    find(provider: string, subject: string): Promise<IdentityRow | null>;
    link(i: IdentityRow): Promise<void>;
    unlink(userId: string, provider: string): Promise<boolean>;
    listByUser(userId: string): Promise<IdentityRow[]>;
  };
  invitations: {
    create(i: InvitationRow): Promise<void>;
    getByHash(hash: string): Promise<InvitationRow | null>;
    list(): Promise<InvitationRow[]>;
    markAccepted(id: string, at: string): Promise<void>;
    revoke(id: string, at: string): Promise<boolean>;
  };
  audit: {
    append(e: AuditEventRow): Promise<void>;
    list(opts: { limit: number; before?: string }): Promise<AuditEventRow[]>;
  };
  ping(): Promise<void>;
}
