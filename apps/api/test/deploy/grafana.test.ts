import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  asArr,
  asObj,
  checkPromql,
  definedMetrics,
  readJson,
  readYaml,
  ROOT,
  type Obj,
} from "./helpers.js";

const DASH_DIR = "deploy/grafana/dashboards";
const dashboardFiles = fs.readdirSync(path.join(ROOT, DASH_DIR)).filter((f) => f.endsWith(".json"));
const defined = definedMetrics();

const datasourceUids = (): Set<string> => {
  const ds = asArr(
    asObj(readYaml("deploy/grafana/provisioning/datasources/datasources.yml")).datasources,
  );
  return new Set(ds.map((d) => String(asObj(d).uid)));
};

describe("grafana dashboards", () => {
  it("ships the two required dashboards", () => {
    const titles = dashboardFiles.map((f) => asObj(readJson(`${DASH_DIR}/${f}`)).title);
    expect(titles).toContain("SDAP Overview");
    expect(titles).toContain("SDAP Models");
  });

  for (const file of dashboardFiles) {
    describe(file, () => {
      const dash = asObj(readJson(`${DASH_DIR}/${file}`));
      const panels = asArr(dash.panels).map(asObj);

      it("has unique panel ids, a uid, and only provisioned datasources", () => {
        expect(typeof dash.uid).toBe("string");
        const ids = panels.map((p) => p.id);
        expect(new Set(ids).size).toBe(ids.length);
        const uids = datasourceUids();
        for (const p of panels) {
          expect(uids.has(String(asObj(p.datasource).uid)), String(p.title)).toBe(true);
          for (const t of asArr(p.targets).map(asObj)) {
            expect(uids.has(String(asObj(t.datasource).uid)), String(p.title)).toBe(true);
          }
        }
      });

      it("queries only metrics and labels defined in metrics.ts", () => {
        const exprs: string[] = [];
        for (const p of panels) {
          for (const t of asArr(p.targets).map(asObj)) {
            if (typeof t.expr === "string") exprs.push(t.expr);
          }
        }
        for (const v of asArr(asObj(dash.templating).list).map(asObj)) {
          const q = v.query;
          if (typeof q === "object" && q !== null) exprs.push(String((q as Obj).query));
        }
        expect(exprs.length).toBeGreaterThan(0);
        for (const e of exprs) expect(checkPromql(e, defined), e).toEqual([]);
      });

      it("never puts finding titles or code in a query", () => {
        const text = JSON.stringify(dash);
        expect(text).not.toMatch(/\btitle\s*[=~]/i);
        for (const p of panels) {
          for (const t of asArr(p.targets).map(asObj)) {
            if (typeof t.rawSql === "string") {
              expect(t.rawSql).toMatch(/^\s*SELECT\b/i);
              expect(t.rawSql).not.toMatch(/\b(title|description|evidence|trace)\b/i);
            }
          }
        }
      });
    });
  }

  it("Overview covers severity/status, runs, failures, queue, duration, tokens and cost", () => {
    const dash = asObj(readJson(`${DASH_DIR}/sdap-overview.json`));
    const text = asArr(dash.panels)
      .map((p) => JSON.stringify(asObj(p).targets))
      .join("\n");
    for (const needle of [
      "by (severity)",
      "by (status)",
      "sdap_runs_total",
      "sdap_run_failures_total",
      "sdap_queue_depth",
      "sdap_run_duration_seconds_bucket",
      "sdap_tokens_total",
      "sdap_cost_usd_total",
    ]) {
      expect(text, needle).toContain(needle);
    }
  });

  it("Models covers attempts by model, fallback rate and Jev precision", () => {
    const dash = asObj(readJson(`${DASH_DIR}/sdap-models.json`));
    const text = asArr(dash.panels)
      .map((p) => JSON.stringify(asObj(p).targets))
      .join("\n");
    expect(text).toContain("sdap_slice_attempts_total");
    expect(text).toContain('outcome=\\"fallback\\"');
    expect(text).toContain("sdap_jev_precision");
  });
});

describe("grafana alert rules", () => {
  const doc = asObj(readYaml("deploy/grafana/provisioning/alerting/rules.yml"));
  const rules = asArr(
    asArr(doc.groups)
      .map(asObj)
      .flatMap((g) => asArr(g.rules)),
  ).map(asObj);

  it("defines run failure rate, SLA breach and queue backlog alerts", () => {
    const uids = rules.map((r) => r.uid);
    expect(uids).toEqual(["sdap-run-failure-rate", "sdap-sla-breach", "sdap-queue-backlog"]);
  });

  it("each rule has a condition that names one of its queries and valid datasources", () => {
    const allowed = new Set([...datasourceUids(), "__expr__"]);
    for (const r of rules) {
      const data = asArr(r.data).map(asObj);
      expect(
        data.map((d) => d.refId),
        String(r.uid),
      ).toContain(r.condition);
      for (const d of data) expect(allowed.has(String(d.datasourceUid))).toBe(true);
    }
  });

  it("Prometheus alerts only use defined metrics", () => {
    for (const r of rules) {
      for (const d of asArr(r.data).map(asObj)) {
        const expr = asObj(d.model).expr;
        if (typeof expr === "string") expect(checkPromql(expr, defined), expr).toEqual([]);
      }
    }
  });

  it("the SLA alert counts only confirmed, open findings", () => {
    const rule = rules.find((r) => r.uid === "sdap-sla-breach");
    const sql = String(asObj(asObj(asArr(rule?.data)[0]).model).rawSql);
    expect(sql).toContain("verdict = 'confirmed'");
    expect(sql).toContain("sla_due < now()");
    expect(sql).toMatch(/^\s*SELECT\b/i);
  });
});

describe("grafana datasources", () => {
  const ds = asArr(
    asObj(readYaml("deploy/grafana/provisioning/datasources/datasources.yml")).datasources,
  ).map(asObj);

  it("provisions Prometheus, a read-only PostgreSQL and Loki", () => {
    expect(ds.map((d) => d.uid).sort()).toEqual(["loki", "postgres", "prometheus"]);
    const pg = ds.find((d) => d.uid === "postgres");
    expect(pg?.user).toBe("sdap_grafana_ro");
  });

  it("holds no literal passwords", () => {
    const pg = ds.find((d) => d.uid === "postgres");
    const pw = String(asObj(pg?.secureJsonData).password);
    expect(pw).toMatch(/^\$\{[A-Z_]+\}$/);
  });

  it("the dashboard provider path matches the compose mount", () => {
    const provider = asObj(
      asArr(asObj(readYaml("deploy/grafana/provisioning/dashboards/dashboards.yml")).providers)[0],
    );
    expect(asObj(provider.options).path).toBe("/var/lib/grafana/dashboards");
  });
});

describe("checkPromql", () => {
  it("flags unknown metrics and labels", () => {
    expect(checkPromql("sum(sdap_nope_total)", defined)).toEqual([
      "unknown metric sdap_nope_total",
    ]);
    expect(checkPromql('sdap_findings{title="x"}', defined)).toEqual([
      "sdap_findings has no label title",
    ]);
    expect(
      checkPromql('sum by (le) (rate(sdap_run_duration_seconds_bucket{mode="full"}[5m]))', defined),
    ).toEqual([]);
  });
});
