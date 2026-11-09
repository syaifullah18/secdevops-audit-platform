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

const clone = <T>(v: T): T => structuredClone(v);

/** In-memory AccountRepo for tests and local runs. */
export class MemoryAccountRepo implements AccountRepo {
  private usersById = new Map<string, UserRow>();
  private tokenRows: AccessTokenRow[] = [];
  private oneTimeRows: OneTimeTokenRow[] = [];
  private identityRows: IdentityRow[] = [];
  private invitationRows: InvitationRow[] = [];
  private auditRows: AuditEventRow[] = [];

  users: AccountRepo["users"] = {
    create: async (u) => {
      if ([...this.usersById.values()].some((x) => x.email === u.email)) {
        throw new Error("email already registered");
      }
      this.usersById.set(u.id, clone(u));
      return clone(u);
    },
    get: async (id) => clone(this.usersById.get(id) ?? null),
    getByEmail: async (email) =>
      clone([...this.usersById.values()].find((u) => u.email === email) ?? null),
    update: async (id, patch) => {
      const cur = this.usersById.get(id);
      if (!cur) throw new Error("user not found");
      const next = { ...cur, ...clone(patch) };
      this.usersById.set(id, next);
      return clone(next);
    },
    list: async () =>
      clone([...this.usersById.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt))),
    count: async () => this.usersById.size,
    delete: async (id) => {
      this.usersById.delete(id);
      this.tokenRows = this.tokenRows.filter((t) => t.userId !== id);
      this.oneTimeRows = this.oneTimeRows.filter((t) => t.userId !== id);
      this.identityRows = this.identityRows.filter((i) => i.userId !== id);
    },
  };

  tokens: AccountRepo["tokens"] = {
    create: async (t) => void this.tokenRows.push(clone(t)),
    getByHash: async (hash) => clone(this.tokenRows.find((t) => t.tokenHash === hash) ?? null),
    listByUser: async (userId, kind: AccessTokenKind) =>
      clone(
        this.tokenRows
          .filter((t) => t.userId === userId && t.kind === kind && !t.revokedAt)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      ),
    touch: async (id, at, expiresAt) => {
      const t = this.tokenRows.find((x) => x.id === id);
      if (!t) return;
      t.lastUsedAt = at;
      if (expiresAt !== undefined) t.expiresAt = expiresAt;
    },
    revoke: async (id, userId, at) => {
      const t = this.tokenRows.find((x) => x.id === id && x.userId === userId && !x.revokedAt);
      if (!t) return false;
      t.revokedAt = at;
      return true;
    },
    revokeSessions: async (userId, at, exceptId) => {
      let n = 0;
      for (const t of this.tokenRows) {
        if (t.userId === userId && t.kind === "session" && !t.revokedAt && t.id !== exceptId) {
          t.revokedAt = at;
          n += 1;
        }
      }
      return n;
    },
  };

  oneTime: AccountRepo["oneTime"] = {
    create: async (t) => void this.oneTimeRows.push(clone(t)),
    consume: async (hash, purpose: OneTimePurpose, now) => {
      const t = this.oneTimeRows.find(
        (x) => x.tokenHash === hash && x.purpose === purpose && !x.usedAt && x.expiresAt > now,
      );
      if (!t) return null;
      t.usedAt = now;
      return clone(t);
    },
    invalidate: async (userId, purpose, now) => {
      for (const t of this.oneTimeRows) {
        if (t.userId === userId && t.purpose === purpose && !t.usedAt) t.usedAt = now;
      }
    },
  };

  identities: AccountRepo["identities"] = {
    find: async (provider, subject) =>
      clone(
        this.identityRows.find((i) => i.provider === provider && i.subject === subject) ?? null,
      ),
    link: async (i) => {
      this.identityRows = this.identityRows.filter(
        (x) => !(x.userId === i.userId && x.provider === i.provider),
      );
      this.identityRows.push(clone(i));
    },
    unlink: async (userId, provider) => {
      const before = this.identityRows.length;
      this.identityRows = this.identityRows.filter(
        (i) => !(i.userId === userId && i.provider === provider),
      );
      return this.identityRows.length < before;
    },
    listByUser: async (userId) => clone(this.identityRows.filter((i) => i.userId === userId)),
  };

  invitations: AccountRepo["invitations"] = {
    create: async (i) => void this.invitationRows.push(clone(i)),
    getByHash: async (hash) => clone(this.invitationRows.find((i) => i.tokenHash === hash) ?? null),
    list: async () =>
      clone([...this.invitationRows].sort((a, b) => b.createdAt.localeCompare(a.createdAt))),
    markAccepted: async (id, at) => {
      const i = this.invitationRows.find((x) => x.id === id);
      if (i) i.acceptedAt = at;
    },
    revoke: async (id, at) => {
      const i = this.invitationRows.find((x) => x.id === id && !x.acceptedAt && !x.revokedAt);
      if (!i) return false;
      i.revokedAt = at;
      return true;
    },
  };

  audit: AccountRepo["audit"] = {
    append: async (e) => void this.auditRows.push(clone(e)),
    list: async ({ limit, before }) =>
      clone(
        this.auditRows
          .filter((e) => !before || e.at < before)
          .sort((a, b) => b.at.localeCompare(a.at))
          .slice(0, limit),
      ),
  };

  async ping(): Promise<void> {}
}
