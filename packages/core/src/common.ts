import { z } from "zod";

/** Platform-generated identifiers are UUIDs. */
export const Id = z.uuid();
export type Id = z.infer<typeof Id>;

/** ISO-8601 timestamp with offset, e.g. 2026-11-07T10:00:00Z. */
export const IsoDateTime = z.iso.datetime({ offset: true });
export type IsoDateTime = z.infer<typeof IsoDateTime>;

/** Repository-relative path using forward slashes. Never absolute, never `..`. */
export const RepoPath = z
  .string()
  .min(1)
  .refine((p) => !p.startsWith("/") && !p.split("/").includes(".."), {
    message: "must be a repository-relative path without '..'",
  });
export type RepoPath = z.infer<typeof RepoPath>;

/** Lowercase slug used for projects, teams and clients. */
export const Slug = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9-]*$/);
export type Slug = z.infer<typeof Slug>;

/** Token and cost accounting, attached to slices, attempts and runs. */
export const Usage = z.object({
  inputTokens: z.number().int().nonnegative().default(0),
  outputTokens: z.number().int().nonnegative().default(0),
  /** Best-effort cost in USD; 0 for self-hosted models without a price table. */
  costUsd: z.number().nonnegative().default(0),
});
export type Usage = z.infer<typeof Usage>;

/** Generic page envelope for list endpoints. */
export const pageOf = <T extends z.ZodType>(item: T) =>
  z.object({
    items: z.array(item),
    total: z.number().int().nonnegative(),
    nextCursor: z.string().nullable(),
  });
