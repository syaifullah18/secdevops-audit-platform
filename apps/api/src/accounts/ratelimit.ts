import type { FastifyRequest } from "fastify";
import { HttpError } from "../errors.js";

/** Fixed-window counter per key. In memory, so it is per API instance. */
export class RateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Returns false once `key` has used up its budget in the current window. */
  take(key: string): boolean {
    const t = this.now();
    if (this.hits.size > 10_000) {
      for (const [k, v] of this.hits) if (v.resetAt <= t) this.hits.delete(k);
    }
    const cur = this.hits.get(key);
    if (!cur || cur.resetAt <= t) {
      this.hits.set(key, { count: 1, resetAt: t + this.windowMs });
      return true;
    }
    cur.count += 1;
    return cur.count <= this.max;
  }
}

/** Route guard: at most `max` requests per `windowMs` per client address and bucket name. */
export const rateLimit = (bucket: string, max: number, windowMs: number) => {
  const limiter = new RateLimiter(max, windowMs);
  return async (req: FastifyRequest): Promise<void> => {
    if (!limiter.take(`${bucket}:${req.ip}`)) {
      throw new HttpError(429, "Too Many Requests", "Too many attempts. Try again later.");
    }
  };
};
