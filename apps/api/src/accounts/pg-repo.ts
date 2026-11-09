import { and, desc, eq, isNull, lt, ne, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Role } from "@sdap/core";
import * as schema from "../db/schema.js";
import type {
  AccessTokenKind,
  AccessTokenRow,
  AccountRepo,
  AuditEventRow,
  IdentityRow,
  InvitationRow,
  OneTimePurpose,
  OneTimeTokenRow,
  UserRow,
} from "./types.js";

type Db = NodePgDatabase<typeof schema>;

/** The driver returns `2026-11-08 10:00:00+00`; the service compares ISO strings. */
const iso = (v: string | null): string | null => (v === null ? null : new Date(v).toISOString());
const isoReq = (v: string): string => new Date(v).toISOString();

const user = (r: typeof schema.accountUsers.$inferSelect): UserRow => ({
  id: r.id,
  email: r.email,
  name: r.name,
  passwordHash: r.passwordHash,
  emailVerifiedAt: iso(r.emailVerifiedAt),
  roles: r.roles as Role[],
  clientIds: r.clientIds,
  team: r.team,
  disabledAt: iso(r.disabledAt),
  failedLogins: r.failedLogins,
  lockedUntil: iso(r.lockedUntil),
  createdAt: isoReq(r.createdAt),
  lastLoginAt: iso(r.lastLoginAt),
});

const token = (r: typeof schema.accessTokens.$inferSelect): AccessTokenRow => ({
  id: r.id,
  userId: r.userId,
  kind: r.kind,
  name: r.name,
  tokenHash: r.tokenHash,
  prefix: r.prefix,
  roles: (r.roles as Role[] | null) ?? null,
  createdAt: isoReq(r.createdAt),
  expiresAt: iso(r.expiresAt),
  lastUsedAt: iso(r.lastUsedAt),
  revokedAt: iso(r.revokedAt),
  ip: r.ip,
  userAgent: r.userAgent,
});

const oneTime = (r: typeof schema.oneTimeTokens.$inferSelect): OneTimeTokenRow => ({
  id: r.id,
  userId: r.userId,
  purpose: r.purpose,
  tokenHash: r.tokenHash,
  expiresAt: isoReq(r.expiresAt),
  usedAt: iso(r.usedAt),
  createdAt: isoReq(r.createdAt),
});

const invitation = (r: typeof schema.accountInvitations.$inferSelect): InvitationRow => ({
  id: r.id,
  email: r.email,
  roles: r.roles as Role[],
  clientIds: r.clientIds,
  team: r.team,
  tokenHash: r.tokenHash,
  invitedBy: r.invitedBy,
  createdAt: isoReq(r.createdAt),
  expiresAt: isoReq(r.expiresAt),
  acceptedAt: iso(r.acceptedAt),
  revokedAt: iso(r.revokedAt),
});

const patchToColumns = (p: Partial<Omit<UserRow, "id" | "createdAt">>) => ({ ...p });

/** AccountRepo on PostgreSQL, sharing the pool of the main store. */
export class PgAccountRepo implements AccountRepo {
  constructor(private readonly db: Db) {}

  users: AccountRepo["users"] = {
    create: async (u) => {
      const [row] = await this.db
        .insert(schema.accountUsers)
        .values(patchToColumns(u) as typeof schema.accountUsers.$inferInsert)
        .returning();
      return user(row!);
    },
    get: async (id) => {
      const [row] = await this.db
        .select()
        .from(schema.accountUsers)
        .where(eq(schema.accountUsers.id, id));
      return row ? user(row) : null;
    },
    getByEmail: async (email) => {
      const [row] = await this.db
        .select()
        .from(schema.accountUsers)
        .where(eq(schema.accountUsers.email, email));
      return row ? user(row) : null;
    },
    update: async (id, patch) => {
      const [row] = await this.db
        .update(schema.accountUsers)
        .set(patchToColumns(patch))
        .where(eq(schema.accountUsers.id, id))
        .returning();
      if (!row) throw new Error("user not found");
      return user(row);
    },
    list: async () =>
      (await this.db.select().from(schema.accountUsers).orderBy(schema.accountUsers.createdAt)).map(
        user,
      ),
    count: async () => {
      const [r] = await this.db.select({ n: sql<number>`count(*)::int` }).from(schema.accountUsers);
      return r?.n ?? 0;
    },
    delete: async (id) => {
      // Tokens, one-time tokens and identities go with the user (ON DELETE CASCADE).
      await this.db.delete(schema.accountUsers).where(eq(schema.accountUsers.id, id));
    },
  };

  tokens: AccountRepo["tokens"] = {
    create: async (t) => void (await this.db.insert(schema.accessTokens).values(t)),
    getByHash: async (hash) => {
      const [row] = await this.db
        .select()
        .from(schema.accessTokens)
        .where(eq(schema.accessTokens.tokenHash, hash));
      return row ? token(row) : null;
    },
    listByUser: async (userId, kind: AccessTokenKind) =>
      (
        await this.db
          .select()
          .from(schema.accessTokens)
          .where(
            and(
              eq(schema.accessTokens.userId, userId),
              eq(schema.accessTokens.kind, kind),
              isNull(schema.accessTokens.revokedAt),
            ),
          )
          .orderBy(desc(schema.accessTokens.createdAt))
      ).map(token),
    touch: async (id, at, expiresAt) => {
      await this.db
        .update(schema.accessTokens)
        .set({ lastUsedAt: at, ...(expiresAt !== undefined ? { expiresAt } : {}) })
        .where(eq(schema.accessTokens.id, id));
    },
    revoke: async (id, userId, at) => {
      const rows = await this.db
        .update(schema.accessTokens)
        .set({ revokedAt: at })
        .where(
          and(
            eq(schema.accessTokens.id, id),
            eq(schema.accessTokens.userId, userId),
            isNull(schema.accessTokens.revokedAt),
          ),
        )
        .returning({ id: schema.accessTokens.id });
      return rows.length > 0;
    },
    revokeSessions: async (userId, at, exceptId) => {
      const rows = await this.db
        .update(schema.accessTokens)
        .set({ revokedAt: at })
        .where(
          and(
            eq(schema.accessTokens.userId, userId),
            eq(schema.accessTokens.kind, "session"),
            isNull(schema.accessTokens.revokedAt),
            exceptId ? ne(schema.accessTokens.id, exceptId) : undefined,
          ),
        )
        .returning({ id: schema.accessTokens.id });
      return rows.length;
    },
  };

  oneTime: AccountRepo["oneTime"] = {
    create: async (t) => void (await this.db.insert(schema.oneTimeTokens).values(t)),
    consume: async (hash, purpose: OneTimePurpose, now) => {
      // One statement: two concurrent requests cannot both use the same token.
      const [row] = await this.db
        .update(schema.oneTimeTokens)
        .set({ usedAt: now })
        .where(
          and(
            eq(schema.oneTimeTokens.tokenHash, hash),
            eq(schema.oneTimeTokens.purpose, purpose),
            isNull(schema.oneTimeTokens.usedAt),
            sql`${schema.oneTimeTokens.expiresAt} > ${now}::timestamptz`,
          ),
        )
        .returning();
      return row ? oneTime(row) : null;
    },
    invalidate: async (userId, purpose, now) => {
      await this.db
        .update(schema.oneTimeTokens)
        .set({ usedAt: now })
        .where(
          and(
            eq(schema.oneTimeTokens.userId, userId),
            eq(schema.oneTimeTokens.purpose, purpose),
            isNull(schema.oneTimeTokens.usedAt),
          ),
        );
    },
  };

  identities: AccountRepo["identities"] = {
    find: async (provider, subject) => {
      const [row] = await this.db
        .select()
        .from(schema.accountIdentities)
        .where(
          and(
            eq(schema.accountIdentities.provider, provider),
            eq(schema.accountIdentities.subject, subject),
          ),
        );
      return row ? ({ ...row, createdAt: isoReq(row.createdAt) } as IdentityRow) : null;
    },
    link: async (i) => {
      await this.db
        .delete(schema.accountIdentities)
        .where(
          and(
            eq(schema.accountIdentities.userId, i.userId),
            eq(schema.accountIdentities.provider, i.provider),
          ),
        );
      await this.db.insert(schema.accountIdentities).values(i);
    },
    unlink: async (userId, provider) => {
      const rows = await this.db
        .delete(schema.accountIdentities)
        .where(
          and(
            eq(schema.accountIdentities.userId, userId),
            eq(schema.accountIdentities.provider, provider),
          ),
        )
        .returning({ p: schema.accountIdentities.provider });
      return rows.length > 0;
    },
    listByUser: async (userId) =>
      (
        await this.db
          .select()
          .from(schema.accountIdentities)
          .where(eq(schema.accountIdentities.userId, userId))
      ).map((r) => ({ ...r, createdAt: isoReq(r.createdAt) }) as IdentityRow),
  };

  invitations: AccountRepo["invitations"] = {
    create: async (i) => void (await this.db.insert(schema.accountInvitations).values(i)),
    getByHash: async (hash) => {
      const [row] = await this.db
        .select()
        .from(schema.accountInvitations)
        .where(eq(schema.accountInvitations.tokenHash, hash));
      return row ? invitation(row) : null;
    },
    list: async () =>
      (
        await this.db
          .select()
          .from(schema.accountInvitations)
          .orderBy(desc(schema.accountInvitations.createdAt))
      ).map(invitation),
    markAccepted: async (id, at) => {
      await this.db
        .update(schema.accountInvitations)
        .set({ acceptedAt: at })
        .where(eq(schema.accountInvitations.id, id));
    },
    revoke: async (id, at) => {
      const rows = await this.db
        .update(schema.accountInvitations)
        .set({ revokedAt: at })
        .where(
          and(
            eq(schema.accountInvitations.id, id),
            isNull(schema.accountInvitations.acceptedAt),
            isNull(schema.accountInvitations.revokedAt),
          ),
        )
        .returning({ id: schema.accountInvitations.id });
      return rows.length > 0;
    },
  };

  audit: AccountRepo["audit"] = {
    append: async (e) => void (await this.db.insert(schema.accountAudit).values(e)),
    list: async ({ limit, before }) =>
      (
        await this.db
          .select()
          .from(schema.accountAudit)
          .where(before ? lt(schema.accountAudit.at, before) : undefined)
          .orderBy(desc(schema.accountAudit.at))
          .limit(limit)
      ).map((r): AuditEventRow => ({ ...r, at: isoReq(r.at) })),
  };

  async ping(): Promise<void> {
    await this.db.execute(sql`select 1`);
  }
}
