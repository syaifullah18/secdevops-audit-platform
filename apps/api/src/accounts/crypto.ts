import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";

const SCRYPT = { N: 32768, r: 8, p: 1, keylen: 64, maxmem: 128 * 1024 * 1024 } as const;

const derive = (password: string, salt: Buffer, N: number, r: number, p: number, keylen: number) =>
  new Promise<Buffer>((resolve, reject) => {
    scrypt(
      password.normalize("NFKC"),
      salt,
      keylen,
      { N, r, p, maxmem: SCRYPT.maxmem },
      (err, key) => (err ? reject(err) : resolve(key)),
    );
  });

/** `scrypt$N$r$p$salt$hash` (base64url); parameters travel with the hash so they can be raised later. */
export const hashPassword = async (password: string): Promise<string> => {
  const salt = randomBytes(16);
  const key = await derive(password, salt, SCRYPT.N, SCRYPT.r, SCRYPT.p, SCRYPT.keylen);
  return [
    "scrypt",
    SCRYPT.N,
    SCRYPT.r,
    SCRYPT.p,
    salt.toString("base64url"),
    key.toString("base64url"),
  ].join("$");
};

export const verifyPassword = async (password: string, stored: string): Promise<boolean> => {
  const [scheme, n, r, p, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !n || !r || !p || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64url");
  try {
    const actual = await derive(
      password,
      Buffer.from(salt, "base64url"),
      Number(n),
      Number(r),
      Number(p),
      expected.length,
    );
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
};

/** Verified against when the account does not exist, so response time does not reveal it. */
let dummy: Promise<string> | undefined;
export const dummyHash = (): Promise<string> => (dummy ??= hashPassword("not-a-real-password"));

export const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");

/** A URL-safe secret with a recognisable prefix (`sdap_s_`, `sdap_pat_`, ...). */
export const newSecret = (prefix: string): string =>
  `${prefix}${randomBytes(32).toString("base64url")}`;

export const newId = (): string => randomUUID();

export const SESSION_PREFIX = "sdap_s_";
export const API_TOKEN_PREFIX = "sdap_pat_";
export const isNativeToken = (t: string): boolean =>
  t.startsWith(SESSION_PREFIX) || t.startsWith(API_TOKEN_PREFIX);

export const safeEqual = (a: string, b: string): boolean => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};
