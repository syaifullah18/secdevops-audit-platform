import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { asObj, readText, readYaml, ROOT, type Obj } from "./helpers.js";

const CHART = "deploy/helm/sdap";
const templatesDir = path.join(ROOT, CHART, "templates");
const templates = fs.readdirSync(templatesDir);
const values = asObj(readYaml(`${CHART}/values.yaml`));

const lookup = (root: Obj, dotted: string): boolean => {
  let cur: unknown = root;
  for (const part of dotted.split(".")) {
    if (typeof cur !== "object" || cur === null || !(part in cur)) return false;
    cur = (cur as Obj)[part];
  }
  return true;
};

describe("helm chart sdap", () => {
  it("has a valid Chart.yaml", () => {
    const chart = asObj(readYaml(`${CHART}/Chart.yaml`));
    expect(chart.apiVersion).toBe("v2");
    expect(chart.name).toBe("sdap");
    expect(chart.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("ships deployments for api, worker and web, a ConfigMap and a NetworkPolicy", () => {
    for (const f of [
      "api.yaml",
      "worker.yaml",
      "web.yaml",
      "configmap.yaml",
      "networkpolicy.yaml",
    ]) {
      expect(templates, f).toContain(f);
    }
    for (const [f, kind] of [
      ["api.yaml", "Deployment"],
      ["worker.yaml", "Deployment"],
      ["web.yaml", "Deployment"],
      ["configmap.yaml", "ConfigMap"],
      ["networkpolicy.yaml", "NetworkPolicy"],
    ] as const) {
      expect(readText(`${CHART}/templates/${f}`), f).toContain(`kind: ${kind}`);
    }
  });

  it("uses external Postgres and Redis by default", () => {
    expect(asObj(values.postgres).enabled).toBe(false);
    expect(asObj(values.redis).enabled).toBe(false);
  });

  it("exposes a worker runtimeClassName (gVisor) wired into the pod spec", () => {
    expect(asObj(values.worker)).toHaveProperty("runtimeClassName", "");
    expect(readText(`${CHART}/templates/worker.yaml`)).toContain(
      "runtimeClassName: {{ .Values.worker.runtimeClassName }}",
    );
  });

  it("references Secrets by name only: no Secret object and no secret-looking values", () => {
    for (const f of templates) {
      expect(readText(`${CHART}/templates/${f}`), f).not.toMatch(/^kind:\s*Secret\s*$/m);
    }
    const common = readText(`${CHART}/templates/_helpers.tpl`);
    expect(common).toContain("secretKeyRef");
    expect(JSON.stringify(values)).not.toMatch(/postgres(ql)?:\/\/[^"]*:[^"]*@/);
    expect(asObj(values.secrets).existingSecret).toBe("");
  });

  it("restricts worker egress and blocks private ranges and the metadata endpoint", () => {
    const np = readText(`${CHART}/templates/networkpolicy.yaml`);
    expect(np).toContain("policyTypes: [Ingress, Egress]");
    expect(np).toContain('(dict "ctx" . "component" "worker")');
    for (const cidr of ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "169.254.0.0/16"]) {
      expect(np, cidr).toContain(cidr);
    }
    expect(np).toContain("port: 53");
  });

  it("runs every pod as non-root with a read-only root filesystem and dropped capabilities", () => {
    for (const f of ["api.yaml", "worker.yaml", "web.yaml"]) {
      const text = readText(`${CHART}/templates/${f}`);
      expect(text, f).toContain("runAsNonRoot: true");
      expect(text, f).toContain("readOnlyRootFilesystem: true");
      expect(text, f).toContain("drop: [ALL]");
      expect(text, f).toContain("allowPrivilegeEscalation: false");
    }
  });

  it("only references .Values paths that exist in values.yaml", () => {
    for (const f of templates) {
      const text = readText(`${CHART}/templates/${f}`);
      for (const m of text.matchAll(/\.Values\.([A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*)/g)) {
        expect(lookup(values, m[1] ?? ""), `${f}: .Values.${m[1]}`).toBe(true);
      }
    }
  });

  it("calls only helpers that are defined and has balanced template blocks", () => {
    const all = templates.map((f) => readText(`${CHART}/templates/${f}`)).join("\n");
    const defined = new Set([...all.matchAll(/define "([^"]+)"/g)].map((m) => m[1]));
    for (const m of all.matchAll(/include "([^"]+)"/g))
      expect(defined.has(m[1] ?? ""), m[1]).toBe(true);
    for (const f of templates) {
      const text = readText(`${CHART}/templates/${f}`);
      const opens = (text.match(/\{\{-?\s*(if|range|with|define)\b/g) ?? []).length;
      const ends = (text.match(/\{\{-?\s*end\s*-?\}\}/g) ?? []).length;
      expect(ends, f).toBe(opens);
      expect((text.match(/\{\{/g) ?? []).length, f).toBe((text.match(/\}\}/g) ?? []).length);
    }
  });
});
