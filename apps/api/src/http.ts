import { Id } from "@sdap/core";
import { z } from "zod";
import { BadRequestError, formatZodError, NotFoundError } from "./errors.js";

/** Parses `data` with a Zod schema or throws a 400 `ApiError` carrying the issues. */
export const parseWith = <S extends z.ZodType>(
  schema: S,
  data: unknown,
  what: string,
): z.output<S> => {
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    const formatted = formatZodError(parsed.error);
    throw new BadRequestError(`Invalid ${what}: ${formatted.message}`, formatted.details);
  }
  return parsed.data;
};

/** A malformed id cannot exist, so it is reported like any other missing resource. */
export const parseId = (value: unknown, what: string): string => {
  const parsed = Id.safeParse(value);
  if (!parsed.success) throw new NotFoundError(`${what} not found`);
  return parsed.data;
};

export const PageQuery = z.object({
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(50),
});

/** Repeated (`a=1&a=2`) or comma separated (`a=1,2`) query values become an array. */
export const asArray = (value: unknown): unknown => {
  if (typeof value === "string") return value.split(",").filter((v) => v.length > 0);
  return value;
};

/** `z.coerce.boolean()` turns the string "false" into true; read the common spellings explicitly. */
export const asBoolean = (value: unknown): unknown => {
  if (typeof value !== "string") return value;
  const v = value.trim().toLowerCase();
  if (v === "false" || v === "0" || v === "no" || v === "") return false;
  if (v === "true" || v === "1" || v === "yes") return true;
  return value;
};

export const TERMINAL_RUN_STATUSES: readonly string[] = ["succeeded", "failed", "cancelled"];
