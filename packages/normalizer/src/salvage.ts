export interface SalvageResult {
  value: unknown;
  /** True when the input was not clean JSON and had to be repaired. */
  salvaged: boolean;
  warnings: string[];
}

export interface SalvageOptions {
  /** Always return an array (a single recovered object is wrapped). */
  asArray?: boolean;
  /** Reject inputs larger than this many characters (default 5 MiB, the skill's limit). */
  maxChars?: number;
  /** Give up after this many unparsable candidate starts (bounds worst-case work). */
  maxFailedStarts?: number;
}

export class SalvageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SalvageError";
  }
}

const tryParse = (text: string): { ok: true; value: unknown } | { ok: false } => {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false };
  }
};

/** Index of the bracket closing the one at `start`, string- and escape-aware; -1 if unbalanced. */
const findBalancedEnd = (text: string, start: number): number => {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === "{" || c === "[") depth++;
    else if (c === "}" || c === "]") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
};

/**
 * Tolerant JSON reader for model output.
 *
 * Handles: clean JSON (not salvaged); several concatenated top-level values
 * (`{..}{..}` or `[..][..]`, merged into one array); and provider filter
 * notices, markdown fences or prose around the JSON (stripped, with a warning).
 * The worker must still run the skill validator on the written file afterwards.
 */
export const salvageJson = (text: string, options: SalvageOptions = {}): SalvageResult => {
  const maxChars = options.maxChars ?? 5 * 1024 * 1024;
  const maxFailedStarts = options.maxFailedStarts ?? 200;
  if (text.length > maxChars) throw new SalvageError(`input exceeds ${maxChars} characters`);

  const clean = text.replace(/^\uFEFF/, "").trim();
  const direct = tryParse(clean);
  if (direct.ok) {
    const value = options.asArray && !Array.isArray(direct.value) ? [direct.value] : direct.value;
    return { value, salvaged: false, warnings: [] };
  }

  const warnings: string[] = [];
  const values: unknown[] = [];
  let skipped = 0;
  let failedStarts = 0;
  let i = 0;
  while (i < clean.length) {
    const c = clean[i];
    if (c !== "{" && c !== "[") {
      if (!/\s/.test(c ?? "")) skipped++;
      i++;
      continue;
    }
    const end = findBalancedEnd(clean, i);
    const parsed = end === -1 ? ({ ok: false } as const) : tryParse(clean.slice(i, end + 1));
    if (parsed.ok) {
      values.push(parsed.value);
      i = end + 1;
      continue;
    }
    failedStarts++;
    skipped++;
    if (failedStarts > maxFailedStarts) {
      warnings.push(`stopped scanning after ${maxFailedStarts} unparsable fragments`);
      break;
    }
    i++;
  }

  if (values.length === 0) throw new SalvageError("no JSON object or array could be recovered");
  if (skipped > 0) warnings.push(`stripped ${skipped} characters of non-JSON text`);
  if (failedStarts > 0) warnings.push(`skipped ${failedStarts} unparsable fragment(s)`);
  if (values.length > 1) warnings.push(`merged ${values.length} concatenated JSON values`);

  const merged = values.flatMap((v) => (Array.isArray(v) ? (v as unknown[]) : [v]));
  const first = values[0];
  const value = values.length === 1 && !Array.isArray(first) && !options.asArray ? first : merged;
  return { value, salvaged: true, warnings };
};

/** Convenience for `findings.json`: always returns an array. */
export const salvageFindingsJson = (text: string, options: SalvageOptions = {}): SalvageResult =>
  salvageJson(text, { ...options, asArray: true });
