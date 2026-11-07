import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { createMetrics } from "../../src/metrics.js";

/** Repository root (apps/api/test/deploy -> up four). */
export const ROOT = path.resolve(import.meta.dirname, "../../../..");

export const readText = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), "utf8");
export const exists = (rel: string): boolean => fs.existsSync(path.join(ROOT, rel));
export const readYaml = (rel: string): unknown => parseYaml(readText(rel), { merge: true });
export const readJson = (rel: string): unknown => JSON.parse(readText(rel));

export type Obj = Record<string, unknown>;
export const asObj = (v: unknown): Obj => {
  if (typeof v !== "object" || v === null || Array.isArray(v)) throw new Error("expected object");
  return v as Obj;
};
export const asArr = (v: unknown): unknown[] => {
  if (!Array.isArray(v)) throw new Error("expected array");
  return v;
};

/**
 * Every metric the platform defines, with its allowed label names, taken from the real registry so
 * dashboards and alert rules can never drift from `metrics.ts`. Histograms also expose
 * `_bucket` (with `le`), `_sum` and `_count`. Only `sdap_` metrics are listed.
 */
export const definedMetrics = (): Map<string, Set<string>> => {
  const { registry } = createMetrics();
  const out = new Map<string, Set<string>>();
  for (const name of registry.getMetricsAsArray().map((m) => m.name)) {
    if (!name.startsWith("sdap_")) continue;
    const metric = registry.getSingleMetric(name);
    // prom-client keeps labelNames as a runtime property but does not type it publicly.
    const labels = new Set((metric as unknown as { labelNames: string[] }).labelNames);
    out.set(name, labels);
    if (name.endsWith("_seconds")) {
      out.set(`${name}_bucket`, new Set([...labels, "le"]));
      out.set(`${name}_sum`, labels);
      out.set(`${name}_count`, labels);
    }
  }
  return out;
};

/** Checks one PromQL expression: only defined metrics, only their own labels in selectors. */
export const checkPromql = (expr: string, defined: Map<string, Set<string>>): string[] => {
  const problems: string[] = [];
  for (const m of expr.matchAll(/\bsdap_[a-z0-9_]+/g)) {
    if (!defined.has(m[0])) problems.push(`unknown metric ${m[0]}`);
  }
  for (const sel of expr.matchAll(/\b(sdap_[a-z0-9_]+)\s*\{([^}]*)\}/g)) {
    const labels = defined.get(sel[1] ?? "");
    if (!labels) continue;
    for (const lm of (sel[2] ?? "").matchAll(/([A-Za-z_][A-Za-z0-9_]*)\s*(?:=~|!~|!=|=)/g)) {
      if (!labels.has(lm[1] ?? "")) problems.push(`${sel[1]} has no label ${lm[1]}`);
    }
  }
  return problems;
};
