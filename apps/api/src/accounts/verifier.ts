import type { AuthUser, AuthVerifier } from "../auth.js";
import { isNativeToken } from "./crypto.js";
import type { AccountService } from "./service.js";

/** Verifies `sdap_s_` sessions and `sdap_pat_` API tokens against the account store. */
export class NativeAuthVerifier implements AuthVerifier {
  constructor(private readonly accounts: AccountService) {}

  async verify(token: string): Promise<AuthUser> {
    const hit = await this.accounts.resolve(token);
    if (!hit) throw new Error("invalid or expired credential");
    return {
      subject: hit.user.email,
      roles: hit.roles,
      clientIds: hit.user.clientIds,
      ...(hit.user.team ? { team: hit.user.team } : {}),
      accountId: hit.user.id,
      tokenId: hit.token.id,
      tokenKind: hit.token.kind,
    };
  }
}

/** Routes by token shape: native credentials to the account store, anything else to OIDC/dev. */
export class CompositeAuthVerifier implements AuthVerifier {
  constructor(
    private readonly native: AuthVerifier,
    private readonly external: AuthVerifier | null,
  ) {}

  verify(token: string): Promise<AuthUser> {
    if (isNativeToken(token)) return this.native.verify(token);
    if (!this.external) return Promise.reject(new Error("unsupported credential"));
    return this.external.verify(token);
  }
}
