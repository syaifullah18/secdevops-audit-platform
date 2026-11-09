import type { Role } from "@sdap/core";
import type { AccountsConfig } from "../config.js";
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
} from "../errors.js";
import {
  API_TOKEN_PREFIX,
  SESSION_PREFIX,
  dummyHash,
  hashPassword,
  newId,
  newSecret,
  sha256,
  verifyPassword,
} from "./crypto.js";
import type { Mailer } from "./mailer.js";
import type {
  AccessTokenRow,
  AccountRepo,
  AuditEventRow,
  ClientScope,
  InvitationRow,
  UserRow,
} from "./types.js";

export interface PublicUser {
  id: string;
  email: string;
  name: string;
  roles: Role[];
  clientIds: ClientScope;
  team: string | null;
  emailVerified: boolean;
  hasPassword: boolean;
  disabled: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface SessionIssue {
  token: string;
  expiresAt: string;
  user: PublicUser;
}

export interface RequestMeta {
  ip?: string | null;
  userAgent?: string | null;
}

export interface ProviderProfile {
  subject: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
}

const DAY = 86_400_000;
const MAX_FAILED = 5;
const LOCK_MS = 15 * 60_000;
const TOUCH_EVERY_MS = 10 * 60_000;

export const toPublic = (u: UserRow): PublicUser => ({
  id: u.id,
  email: u.email,
  name: u.name,
  roles: u.roles,
  clientIds: u.clientIds,
  team: u.team,
  emailVerified: u.emailVerifiedAt !== null,
  hasPassword: u.passwordHash !== null,
  disabled: u.disabledAt !== null,
  createdAt: u.createdAt,
  lastLoginAt: u.lastLoginAt,
});

const normEmail = (raw: string): string => raw.trim().toLowerCase();

export class AccountService {
  constructor(
    readonly repo: AccountRepo,
    private readonly mailer: Mailer,
    readonly cfg: AccountsConfig,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  private now = (): string => this.clock().toISOString();
  private after = (ms: number): string => new Date(this.clock().getTime() + ms).toISOString();

  // ------------------------------------------------------------------ audit

  async audit(
    actor: string,
    action: string,
    target: string | null,
    meta?: RequestMeta,
    details?: Record<string, unknown>,
  ): Promise<void> {
    const row: AuditEventRow = {
      id: newId(),
      at: this.now(),
      actor,
      action,
      target,
      ip: meta?.ip ?? null,
      details: details ?? null,
    };
    await this.repo.audit.append(row);
  }

  // --------------------------------------------------------------- policies

  assertPassword(password: string, email?: string): void {
    if (password.length < 10) throw new BadRequestError("Password must be at least 10 characters");
    if (password.length > 128) throw new BadRequestError("Password must be at most 128 characters");
    if (email && password.toLowerCase() === email.toLowerCase()) {
      throw new BadRequestError("Password must not be your email address");
    }
  }

  private requirePasswordLogin(): void {
    if (!this.cfg.passwordLogin) throw new NotFoundError("Password sign-in is disabled");
  }

  // ----------------------------------------------------------------- tokens

  private async issueSession(user: UserRow, meta?: RequestMeta): Promise<SessionIssue> {
    const secret = newSecret(SESSION_PREFIX);
    const expiresAt = this.after(this.cfg.sessionTtlDays * DAY);
    await this.repo.tokens.create({
      id: newId(),
      userId: user.id,
      kind: "session",
      name: null,
      tokenHash: sha256(secret),
      prefix: secret.slice(0, 12),
      roles: null,
      createdAt: this.now(),
      expiresAt,
      lastUsedAt: this.now(),
      revokedAt: null,
      ip: meta?.ip ?? null,
      userAgent: meta?.userAgent?.slice(0, 300) ?? null,
    });
    const updated = await this.repo.users.update(user.id, {
      lastLoginAt: this.now(),
      failedLogins: 0,
      lockedUntil: null,
    });
    return { token: secret, expiresAt, user: toPublic(updated) };
  }

  /** Resolves a `sdap_s_` or `sdap_pat_` credential. Returns null for anything not valid. */
  async resolve(
    secret: string,
  ): Promise<{ user: UserRow; token: AccessTokenRow; roles: Role[] } | null> {
    const row = await this.repo.tokens.getByHash(sha256(secret));
    if (!row || row.revokedAt) return null;
    const nowIso = this.now();
    if (row.expiresAt && row.expiresAt <= nowIso) return null;
    const user = await this.repo.users.get(row.userId);
    if (!user || user.disabledAt) return null;
    if (this.cfg.requireEmailVerification && !user.emailVerifiedAt) return null;

    const stale =
      !row.lastUsedAt || Date.parse(nowIso) - Date.parse(row.lastUsedAt) > TOUCH_EVERY_MS;
    if (stale) {
      const next = row.kind === "session" ? this.after(this.cfg.sessionTtlDays * DAY) : undefined;
      await this.repo.tokens.touch(row.id, nowIso, next);
    }
    // A token can only narrow its owner. An admin may narrow to any role, because admin implies them all.
    const roles = row.roles
      ? user.roles.includes("admin")
        ? row.roles
        : user.roles.filter((r) => row.roles?.includes(r))
      : user.roles;
    return { user, token: row, roles };
  }

  // ----------------------------------------------------------------- signup

  private async bootstrapRole(email: string): Promise<boolean> {
    if (this.cfg.bootstrapAdminEmail) return email === this.cfg.bootstrapAdminEmail;
    return (await this.repo.users.count()) === 0;
  }

  async signup(
    input: { email: string; name: string; password: string; inviteToken?: string | undefined },
    meta?: RequestMeta,
  ): Promise<{ requiresVerification: boolean; session?: SessionIssue }> {
    this.requirePasswordLogin();
    const email = normEmail(input.email);
    const name = input.name.trim();
    if (!name) throw new BadRequestError("Name is required");
    this.assertPassword(input.password, email);

    let invitation: InvitationRow | null = null;
    if (input.inviteToken) {
      invitation = await this.liveInvitation(input.inviteToken);
      if (invitation.email !== email) {
        throw new BadRequestError("This invitation was sent to a different email address");
      }
    }
    const bootstrap = await this.bootstrapRole(email);
    if (!invitation && !bootstrap && this.cfg.signupMode !== "open") {
      throw new ForbiddenError(
        this.cfg.signupMode === "invite"
          ? "Sign-up is by invitation only"
          : "Sign-up is closed on this instance",
      );
    }

    const existing = await this.repo.users.getByEmail(email);
    if (existing) {
      if (!this.mailer.delivers || !this.cfg.requireEmailVerification) {
        throw new ConflictError("An account with this email already exists");
      }
      // Same answer as a fresh sign-up so the form does not reveal who has an account.
      await this.mailer.send({
        to: email,
        subject: "You already have an account",
        text: `Someone tried to sign up with this address. You already have an account; sign in at ${this.cfg.webBaseUrl}/login or reset your password at ${this.cfg.webBaseUrl}/forgot.`,
      });
      return { requiresVerification: true };
    }

    // An invitation or a bootstrap admin proves nothing about the mailbox unless it was invited by mail.
    const trusted = invitation !== null || (bootstrap && !this.cfg.requireEmailVerification);
    const user = await this.repo.users.create({
      id: newId(),
      email,
      name,
      passwordHash: await hashPassword(input.password),
      emailVerifiedAt: trusted || !this.cfg.requireEmailVerification ? this.now() : null,
      roles: invitation ? invitation.roles : bootstrap ? ["admin"] : [this.cfg.defaultRole],
      clientIds: invitation ? invitation.clientIds : bootstrap ? "*" : [],
      team: invitation?.team ?? null,
      disabledAt: null,
      failedLogins: 0,
      lockedUntil: null,
      createdAt: this.now(),
      lastLoginAt: null,
    });
    if (invitation) await this.repo.invitations.markAccepted(invitation.id, this.now());
    await this.audit(user.email, "account.signup", user.id, meta, {
      via: invitation ? "invitation" : bootstrap ? "bootstrap" : "open",
    });

    if (user.emailVerifiedAt === null) {
      await this.sendVerification(user);
      return { requiresVerification: true };
    }
    return { requiresVerification: false, session: await this.issueSession(user, meta) };
  }

  private async sendVerification(user: UserRow): Promise<void> {
    const secret = newSecret("v_");
    await this.repo.oneTime.invalidate(user.id, "verify_email", this.now());
    await this.repo.oneTime.create({
      id: newId(),
      userId: user.id,
      purpose: "verify_email",
      tokenHash: sha256(secret),
      expiresAt: this.after(DAY),
      usedAt: null,
      createdAt: this.now(),
    });
    await this.mailer.send({
      to: user.email,
      subject: "Confirm your email address",
      text: `Hello ${user.name},\n\nConfirm your email address to finish creating your account:\n${this.cfg.webBaseUrl}/verify/${secret}\n\nThe link works for 24 hours. If you did not sign up, ignore this message.`,
    });
  }

  async verifyEmail(secret: string, meta?: RequestMeta): Promise<void> {
    const row = await this.repo.oneTime.consume(sha256(secret), "verify_email", this.now());
    if (!row) throw new BadRequestError("This link is invalid or has expired");
    await this.repo.users.update(row.userId, { emailVerifiedAt: this.now() });
    await this.audit(row.userId, "account.verify_email", row.userId, meta);
  }

  // ------------------------------------------------------------------ login

  async login(
    input: { email: string; password: string },
    meta?: RequestMeta,
  ): Promise<SessionIssue> {
    this.requirePasswordLogin();
    const email = normEmail(input.email);
    const user = await this.repo.users.getByEmail(email);
    const fail = async (reason: string): Promise<never> => {
      await this.audit(email, "account.login_failed", user?.id ?? null, meta, { reason });
      throw new UnauthorizedError("Incorrect email or password");
    };

    if (!user || !user.passwordHash) {
      await verifyPassword(input.password, await dummyHash());
      return fail("unknown");
    }
    if (user.lockedUntil && user.lockedUntil > this.now()) {
      throw new HttpLocked();
    }
    const ok = await verifyPassword(input.password, user.passwordHash);
    if (!ok) {
      const failed = user.failedLogins + 1;
      await this.repo.users.update(user.id, {
        failedLogins: failed,
        lockedUntil: failed >= MAX_FAILED ? this.after(LOCK_MS) : user.lockedUntil,
      });
      return fail("bad_password");
    }
    if (user.disabledAt) throw new ForbiddenError("This account is disabled");
    if (this.cfg.requireEmailVerification && !user.emailVerifiedAt) {
      throw new ForbiddenError("Confirm your email address first. Check your inbox for the link.");
    }
    const session = await this.issueSession(user, meta);
    await this.audit(user.email, "account.login", user.id, meta);
    return session;
  }

  async logout(userId: string, tokenId: string, meta?: RequestMeta): Promise<void> {
    await this.repo.tokens.revoke(tokenId, userId, this.now());
    await this.audit(userId, "account.logout", userId, meta);
  }

  // ------------------------------------------------------- forgot and reset

  async forgot(emailRaw: string, meta?: RequestMeta): Promise<void> {
    this.requirePasswordLogin();
    const email = normEmail(emailRaw);
    const user = await this.repo.users.getByEmail(email);
    // Same response either way; only a real, enabled account gets a mail.
    if (!user || user.disabledAt) return;
    const secret = newSecret("r_");
    await this.repo.oneTime.invalidate(user.id, "reset_password", this.now());
    await this.repo.oneTime.create({
      id: newId(),
      userId: user.id,
      purpose: "reset_password",
      tokenHash: sha256(secret),
      expiresAt: this.after(60 * 60_000),
      usedAt: null,
      createdAt: this.now(),
    });
    await this.mailer.send({
      to: user.email,
      subject: "Reset your password",
      text: `Hello ${user.name},\n\nChoose a new password here:\n${this.cfg.webBaseUrl}/reset/${secret}\n\nThe link works for one hour and once. If you did not ask for it, ignore this message; your password is unchanged.`,
    });
    await this.audit(user.email, "account.forgot", user.id, meta);
  }

  async reset(secret: string, newPassword: string, meta?: RequestMeta): Promise<void> {
    this.requirePasswordLogin();
    const row = await this.repo.oneTime.consume(sha256(secret), "reset_password", this.now());
    if (!row) throw new BadRequestError("This link is invalid or has expired");
    const user = await this.repo.users.get(row.userId);
    if (!user) throw new BadRequestError("This link is invalid or has expired");
    this.assertPassword(newPassword, user.email);
    await this.repo.users.update(user.id, {
      passwordHash: await hashPassword(newPassword),
      emailVerifiedAt: user.emailVerifiedAt ?? this.now(),
      failedLogins: 0,
      lockedUntil: null,
    });
    await this.repo.tokens.revokeSessions(user.id, this.now());
    await this.audit(user.email, "account.reset_password", user.id, meta);
  }

  // ---------------------------------------------------------------- account

  async getUser(id: string): Promise<UserRow> {
    const u = await this.repo.users.get(id);
    if (!u) throw new NotFoundError("Account not found");
    return u;
  }

  async updateName(userId: string, name: string, meta?: RequestMeta): Promise<PublicUser> {
    const trimmed = name.trim();
    if (!trimmed) throw new BadRequestError("Name is required");
    const u = await this.repo.users.update(userId, { name: trimmed.slice(0, 120) });
    await this.audit(u.email, "account.update_name", u.id, meta);
    return toPublic(u);
  }

  async changePassword(
    userId: string,
    input: { current?: string | undefined; next: string },
    keepSessionId: string | null,
    meta?: RequestMeta,
  ): Promise<void> {
    this.requirePasswordLogin();
    const user = await this.getUser(userId);
    if (user.passwordHash) {
      if (!input.current || !(await verifyPassword(input.current, user.passwordHash))) {
        throw new BadRequestError("Current password is incorrect");
      }
    }
    this.assertPassword(input.next, user.email);
    await this.repo.users.update(userId, { passwordHash: await hashPassword(input.next) });
    await this.repo.tokens.revokeSessions(userId, this.now(), keepSessionId ?? undefined);
    await this.audit(user.email, "account.change_password", userId, meta);
  }

  listSessions = (userId: string) => this.repo.tokens.listByUser(userId, "session");

  async revokeToken(userId: string, tokenId: string, meta?: RequestMeta): Promise<void> {
    const ok = await this.repo.tokens.revoke(tokenId, userId, this.now());
    if (!ok) throw new NotFoundError("Not found");
    await this.audit(userId, "account.revoke_token", tokenId, meta);
  }

  async revokeOtherSessions(userId: string, keepId: string, meta?: RequestMeta): Promise<number> {
    const n = await this.repo.tokens.revokeSessions(userId, this.now(), keepId);
    await this.audit(userId, "account.revoke_other_sessions", userId, meta, { count: n });
    return n;
  }

  listApiTokens = (userId: string) => this.repo.tokens.listByUser(userId, "api_token");

  async createApiToken(
    user: UserRow,
    input: { name: string; roles?: Role[] | undefined; expiresInDays?: number | undefined },
    meta?: RequestMeta,
  ): Promise<{ token: string; row: AccessTokenRow }> {
    const name = input.name.trim();
    if (!name) throw new BadRequestError("Token name is required");
    // A token can only narrow what its owner can do.
    const roles = input.roles?.length ? input.roles : null;
    if (roles?.some((r) => !user.roles.includes(r) && !user.roles.includes("admin"))) {
      throw new ForbiddenError("A token cannot have a role its owner does not have");
    }
    const secret = newSecret(API_TOKEN_PREFIX);
    const row: AccessTokenRow = {
      id: newId(),
      userId: user.id,
      kind: "api_token",
      name: name.slice(0, 100),
      tokenHash: sha256(secret),
      prefix: secret.slice(0, 13),
      roles,
      createdAt: this.now(),
      expiresAt: input.expiresInDays ? this.after(input.expiresInDays * DAY) : null,
      lastUsedAt: null,
      revokedAt: null,
      ip: meta?.ip ?? null,
      userAgent: null,
    };
    await this.repo.tokens.create(row);
    await this.audit(user.email, "account.create_api_token", row.id, meta, { name: row.name });
    return { token: secret, row };
  }

  async unlinkIdentity(userId: string, provider: string, meta?: RequestMeta): Promise<void> {
    const user = await this.getUser(userId);
    const others = (await this.repo.identities.listByUser(userId)).filter(
      (i) => i.provider !== provider,
    );
    if (others.length === 0 && !(this.cfg.passwordLogin && user.passwordHash)) {
      throw new BadRequestError(
        "This is the only way you can sign in. Set a password or link another account first.",
      );
    }
    if (!(await this.repo.identities.unlink(userId, provider)))
      throw new NotFoundError("Not found");
    await this.audit(user.email, "account.unlink_identity", userId, meta, { provider });
  }

  async exportData(userId: string): Promise<Record<string, unknown>> {
    const user = await this.getUser(userId);
    return {
      exportedAt: this.now(),
      account: toPublic(user),
      sessions: (await this.repo.tokens.listByUser(userId, "session")).map(stripSecret),
      apiTokens: (await this.repo.tokens.listByUser(userId, "api_token")).map(stripSecret),
      identities: await this.repo.identities.listByUser(userId),
    };
  }

  async deleteAccount(
    userId: string,
    input: { email: string; password?: string | undefined },
    meta?: RequestMeta,
  ): Promise<void> {
    const user = await this.getUser(userId);
    if (normEmail(input.email) !== user.email) {
      throw new BadRequestError("Type your email address to confirm");
    }
    if (user.passwordHash) {
      if (!input.password || !(await verifyPassword(input.password, user.passwordHash))) {
        throw new BadRequestError("Password is incorrect");
      }
    }
    await this.assertNotLastAdmin(user, "delete");
    // The audit trail keeps the event but not the address.
    await this.audit("deleted-account", "account.delete", userId, meta);
    await this.repo.users.delete(userId);
  }

  private async assertNotLastAdmin(user: UserRow, verb: string): Promise<void> {
    if (!user.roles.includes("admin") || user.disabledAt) return;
    const admins = (await this.repo.users.list()).filter(
      (u) => u.roles.includes("admin") && !u.disabledAt && u.id !== user.id,
    );
    if (admins.length === 0) {
      throw new ConflictError(
        `You are the only administrator; make someone else admin before you ${verb} this account`,
      );
    }
  }

  // ------------------------------------------------------------------ admin

  async listUsers(): Promise<PublicUser[]> {
    return (await this.repo.users.list()).map(toPublic);
  }

  async adminUpdate(
    actor: string,
    id: string,
    patch: {
      name?: string | undefined;
      roles?: Role[] | undefined;
      clientIds?: ClientScope | undefined;
      team?: string | null | undefined;
      disabled?: boolean | undefined;
    },
    meta?: RequestMeta,
  ): Promise<PublicUser> {
    const user = await this.getUser(id);
    const next: Partial<UserRow> = {};
    if (patch.name !== undefined) next.name = patch.name.trim().slice(0, 120) || user.name;
    if (patch.roles !== undefined) next.roles = [...new Set(patch.roles)];
    if (patch.clientIds !== undefined) next.clientIds = patch.clientIds;
    if (patch.team !== undefined) next.team = patch.team;
    if (patch.disabled !== undefined) next.disabledAt = patch.disabled ? this.now() : null;

    const losesAdmin =
      (next.roles && !next.roles.includes("admin") && user.roles.includes("admin")) ||
      (patch.disabled === true && user.roles.includes("admin"));
    if (losesAdmin) await this.assertNotLastAdmin(user, "change");

    const updated = await this.repo.users.update(id, next);
    if (patch.disabled === true) await this.repo.tokens.revokeSessions(id, this.now());
    await this.audit(actor, "admin.update_user", id, meta, { fields: Object.keys(next) });
    return toPublic(updated);
  }

  async adminDelete(actor: string, id: string, meta?: RequestMeta): Promise<void> {
    const user = await this.getUser(id);
    await this.assertNotLastAdmin(user, "delete");
    await this.repo.users.delete(id);
    await this.audit(actor, "admin.delete_user", id, meta);
  }

  async createInvitation(
    actor: UserRow,
    input: {
      email: string;
      roles: Role[];
      clientIds: ClientScope;
      team?: string | null | undefined;
    },
    meta?: RequestMeta,
  ): Promise<{ invitation: InvitationRow; link: string }> {
    const email = normEmail(input.email);
    if (await this.repo.users.getByEmail(email)) {
      throw new ConflictError("An account with this email already exists");
    }
    const secret = newSecret("i_");
    const row: InvitationRow = {
      id: newId(),
      email,
      roles: [...new Set(input.roles)],
      clientIds: input.clientIds,
      team: input.team ?? null,
      tokenHash: sha256(secret),
      invitedBy: actor.email,
      createdAt: this.now(),
      expiresAt: this.after(7 * DAY),
      acceptedAt: null,
      revokedAt: null,
    };
    await this.repo.invitations.create(row);
    const link = `${this.cfg.webBaseUrl}/signup?invite=${secret}`;
    if (this.mailer.delivers) {
      await this.mailer.send({
        to: email,
        subject: "You are invited to SecDevOps Audit",
        text: `${actor.name} invited you. Create your account here:\n${link}\n\nThe invitation works for 7 days.`,
      });
    }
    await this.audit(actor.email, "admin.invite", row.id, meta, { email, roles: row.roles });
    return { invitation: row, link };
  }

  listInvitations = () => this.repo.invitations.list();

  async revokeInvitation(actor: string, id: string, meta?: RequestMeta): Promise<void> {
    if (!(await this.repo.invitations.revoke(id, this.now()))) throw new NotFoundError("Not found");
    await this.audit(actor, "admin.revoke_invitation", id, meta);
  }

  private async liveInvitation(secret: string): Promise<InvitationRow> {
    const row = await this.repo.invitations.getByHash(sha256(secret));
    if (!row || row.acceptedAt || row.revokedAt || row.expiresAt <= this.now()) {
      throw new BadRequestError("This invitation is invalid or has expired");
    }
    return row;
  }

  async previewInvitation(secret: string): Promise<{ email: string }> {
    return { email: (await this.liveInvitation(secret)).email };
  }

  async listAudit(limit: number, before?: string): Promise<AuditEventRow[]> {
    return this.repo.audit.list({ limit, ...(before ? { before } : {}) });
  }

  // ------------------------------------------------------ provider sign-in

  /** Signs a provider identity in; creates or links the account as the ADR describes. */
  async signInWithProvider(
    provider: string,
    profile: ProviderProfile,
    meta?: RequestMeta,
  ): Promise<string> {
    const identity = await this.repo.identities.find(provider, profile.subject);
    let user: UserRow | null = identity ? await this.repo.users.get(identity.userId) : null;

    if (!user) {
      const email = profile.email ? normEmail(profile.email) : null;
      // Only an address the provider verified may be matched to an existing account.
      if (!email || !profile.emailVerified) {
        throw new ForbiddenError(`${provider} did not give a verified email address`);
      }
      user = await this.repo.users.getByEmail(email);
      if (user) {
        // A password account nobody proved ownership of may have been registered by someone else.
        if (!user.emailVerifiedAt) {
          user = await this.repo.users.update(user.id, {
            passwordHash: null,
            emailVerifiedAt: this.now(),
          });
          await this.repo.tokens.revokeSessions(user.id, this.now());
        }
      } else {
        const bootstrap = await this.bootstrapRole(email);
        if (!bootstrap && this.cfg.signupMode !== "open") {
          throw new ForbiddenError(
            "Sign-up is by invitation only. Ask an administrator to invite you.",
          );
        }
        user = await this.repo.users.create({
          id: newId(),
          email,
          name: (profile.name ?? email.split("@")[0] ?? "User").slice(0, 120),
          passwordHash: null,
          emailVerifiedAt: this.now(),
          roles: bootstrap ? ["admin"] : [this.cfg.defaultRole],
          clientIds: bootstrap ? "*" : [],
          team: null,
          disabledAt: null,
          failedLogins: 0,
          lockedUntil: null,
          createdAt: this.now(),
          lastLoginAt: null,
        });
        await this.audit(user.email, "account.signup", user.id, meta, { via: provider });
      }
      await this.repo.identities.link({
        provider,
        subject: profile.subject,
        userId: user.id,
        email,
        createdAt: this.now(),
      });
    }
    if (user.disabledAt) throw new ForbiddenError("This account is disabled");

    // A short-lived single-use code goes back to the browser, never the session itself.
    const code = newSecret("x_");
    await this.repo.oneTime.create({
      id: newId(),
      userId: user.id,
      purpose: "oauth_exchange",
      tokenHash: sha256(code),
      expiresAt: this.after(2 * 60_000),
      usedAt: null,
      createdAt: this.now(),
    });
    await this.audit(user.email, "account.login_provider", user.id, meta, { provider });
    return code;
  }

  async exchangeCode(code: string, meta?: RequestMeta): Promise<SessionIssue> {
    const row = await this.repo.oneTime.consume(sha256(code), "oauth_exchange", this.now());
    if (!row) throw new BadRequestError("This sign-in link has expired. Try again.");
    const user = await this.getUser(row.userId);
    if (user.disabledAt) throw new ForbiddenError("This account is disabled");
    return this.issueSession(user, meta);
  }
}

const stripSecret = ({ tokenHash: _h, ...rest }: AccessTokenRow) => rest;

class HttpLocked extends ForbiddenError {
  constructor() {
    super("Too many failed attempts. Try again in a few minutes, or reset your password.");
  }
}
