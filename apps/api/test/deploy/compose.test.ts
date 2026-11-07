import { describe, expect, it } from "vitest";
import { asArr, asObj, exists, readText, readYaml, type Obj } from "./helpers.js";

const compose = asObj(readYaml("docker-compose.yml"));
const services = asObj(compose.services);
const volumes = asObj(compose.volumes);

describe("docker-compose.yml", () => {
  it("defines the required services", () => {
    for (const s of [
      "api",
      "worker",
      "web",
      "postgres",
      "redis",
      "prometheus",
      "grafana",
      "loki",
    ]) {
      expect(Object.keys(services), s).toContain(s);
    }
  });

  it("uses PostgreSQL 17 and Redis 7", () => {
    expect(String(asObj(services.postgres).image)).toMatch(/^postgres:17/);
    expect(String(asObj(services.redis).image)).toMatch(/^redis:7/);
  });

  it("gives every service except the log shipper a healthcheck", () => {
    for (const [name, svc] of Object.entries(services)) {
      if (name === "alloy") continue;
      expect(asObj(svc).healthcheck, name).toBeDefined();
    }
  });

  it("starts dependents only after their dependencies are healthy", () => {
    for (const [name, svc] of Object.entries(services)) {
      const deps = asObj(asObj(svc).depends_on ?? {});
      for (const [dep, cond] of Object.entries(deps)) {
        expect(Object.keys(services), `${name} -> ${dep}`).toContain(dep);
        expect(asObj(cond).condition).toBe("service_healthy");
      }
    }
  });

  it("uses named volumes that are declared, and bind mounts that exist", () => {
    for (const [name, svc] of Object.entries(services)) {
      for (const v of asArr(asObj(svc).volumes ?? []).map(String)) {
        const source = v.split(":")[0] ?? "";
        if (source.startsWith("./")) expect(exists(source.slice(2)), `${name}: ${v}`).toBe(true);
        else if (!source.startsWith("/") && !source.startsWith("$")) {
          expect(Object.keys(volumes), `${name}: ${v}`).toContain(source);
        }
      }
    }
    for (const stateful of [
      "postgres-data",
      "redis-data",
      "grafana-data",
      "prometheus-data",
      "loki-data",
    ]) {
      expect(Object.keys(volumes)).toContain(stateful);
    }
  });

  it("builds the app images from Dockerfiles that exist", () => {
    for (const name of ["api", "worker", "web"]) {
      const build = asObj(asObj(services[name]).build);
      expect(exists(String(build.dockerfile)), name).toBe(true);
    }
  });

  it("publishes only to localhost and never publishes the datastores", () => {
    for (const [name, svc] of Object.entries(services)) {
      for (const p of asArr(asObj(svc).ports ?? []).map(String)) {
        expect(p.startsWith("127.0.0.1:"), `${name}: ${p}`).toBe(true);
      }
    }
    for (const name of ["postgres", "redis", "prometheus", "loki"]) {
      expect(asObj(services[name]).ports, name).toBeUndefined();
    }
  });

  it("disables Grafana analytics and keeps SDAP telemetry off by default", () => {
    const env = asObj(asObj(services.grafana).environment);
    for (const k of [
      "GF_ANALYTICS_REPORTING_ENABLED",
      "GF_ANALYTICS_CHECK_FOR_UPDATES",
      "GF_ANALYTICS_CHECK_FOR_PLUGIN_UPDATES",
      "GF_NEWS_NEWS_FEED_ENABLED",
    ]) {
      expect(env[k], k).toBe("false");
    }
    expect(String(asObj(asObj(services.api).environment).SDAP_TELEMETRY)).toContain(":-off");
    expect(readText("deploy/loki/loki.yaml")).toContain("reporting_enabled: false");
    expect(asArr(asObj(services.alloy).command)).toContain("--disable-reporting");
  });

  it("every interpolated variable is documented in .env.example or env.compose.example", () => {
    const documented = new Set(
      [
        ...readText(".env.example").matchAll(/^([A-Z][A-Z0-9_]*)=/gm),
        ...readText("deploy/compose/env.compose.example").matchAll(/^([A-Z][A-Z0-9_]*)=/gm),
      ].map((m) => m[1]),
    );
    const used = [...readText("docker-compose.yml").matchAll(/(?<!\$)\$\{([A-Z][A-Z0-9_]*)/g)].map(
      (m) => m[1],
    );
    expect(used.length).toBeGreaterThan(10);
    for (const v of new Set(used)) expect(documented.has(v), v).toBe(true);
  });

  it("holds no secrets other than the documented evaluation defaults", () => {
    const text = readText("docker-compose.yml");
    expect(text).not.toMatch(/(api[_-]?key|secret|token)\s*[:=]\s*["']?[A-Za-z0-9+/]{20,}/i);
  });

  it("ships override files that only extend known services", () => {
    for (const f of [
      "deploy/compose/docker-compose.dev.yml",
      "deploy/compose/docker-compose.hardened.yml",
    ]) {
      const o = asObj(readYaml(f));
      for (const name of Object.keys(asObj(o.services)))
        expect(Object.keys(services), f).toContain(name);
    }
    const hardened = asObj(asObj(readYaml("deploy/compose/docker-compose.hardened.yml")).services);
    for (const name of ["api", "worker", "web"]) {
      const svc = asObj(hardened[name]);
      expect(svc.read_only, name).toBe(true);
      expect(svc.cap_drop, name).toEqual(["ALL"]);
    }
  });
});

describe("prometheus and loki configuration", () => {
  const prom = asObj(readYaml("deploy/prometheus/prometheus.yml"));
  const jobs = new Map(
    asArr(prom.scrape_configs).map((j) => [String(asObj(j).job_name), asObj(j)] as const),
  );

  it("scrapes api and worker on the ports the compose stack uses", () => {
    const targets = (job: string): string[] =>
      asArr(asObj(asArr(jobs.get(job)?.static_configs)[0]).targets).map(String);
    expect(targets("sdap-api")).toEqual(["api:8080"]);
    expect(targets("sdap-worker")).toEqual(["worker:9464"]);
    expect(String(asObj(asObj(services.worker).environment).SDAP_METRICS_PORT)).toBe("9464");
    expect(jobs.get("sdap-api")?.metrics_path).toBe("/metrics");
  });

  it("parses Loki config with auth disabled for the internal network only", () => {
    const loki = asObj(readYaml("deploy/loki/loki.yaml"));
    expect(asObj(loki.analytics).reporting_enabled).toBe(false);
  });

  it("labels logs only by service and level", () => {
    const alloy = readText("deploy/loki/config.alloy");
    expect(alloy).toMatch(/stage\.labels\s*\{\s*values = \{ level = "" \}/);
    expect(alloy).toContain('target_label  = "service"');
    expect(alloy.match(/target_label/g)?.length).toBe(1);
  });
});

describe("Dockerfiles", () => {
  const files = ["apps/api/Dockerfile", "apps/worker/Dockerfile", "apps/web/Dockerfile"];

  it("are multi-stage, based on Node 24 slim for build, and run as non-root", () => {
    for (const f of files) {
      const text = readText(f);
      expect(text, f).toContain("FROM node:24-slim AS build");
      expect((text.match(/^FROM /gm) ?? []).length, f).toBeGreaterThanOrEqual(2);
    }
    for (const f of files.slice(0, 2)) {
      const text = readText(f);
      expect(text, f).toContain("FROM node:24-slim AS runtime");
      expect(text, f).toMatch(/^USER node$/m);
      expect(text, f).toMatch(/pnpm --filter \S+ deploy --legacy --prod/);
    }
    expect(readText("apps/web/Dockerfile")).toContain("nginx-unprivileged");
  });

  it("copy only files that exist in the repository", () => {
    for (const f of files) {
      for (const m of readText(f).matchAll(/^COPY (?:--\S+ )*(deploy\/\S+) /gm)) {
        expect(exists(m[1] ?? ""), `${f}: ${m[1]}`).toBe(true);
      }
    }
  });

  it(".dockerignore keeps secrets and VCS state out of the build context", () => {
    const text = readText(".dockerignore");
    for (const entry of [".git", ".env", "**/node_modules"]) expect(text).toContain(entry);
    expect(text).toContain("!.env.example");
  });
});

describe("postgres init script", () => {
  it("creates a SELECT-only, read-only role and takes the password from the environment", () => {
    const text = readText("deploy/postgres/10-init.sh");
    expect(text).toContain("GRANT SELECT ON ALL TABLES");
    expect(text).toContain("default_transaction_read_only = on");
    expect(text).not.toMatch(/GRANT (ALL|INSERT|UPDATE|DELETE)/);
    expect(text).toContain("GRAFANA_PG_PASSWORD");
  });
});

export type { Obj };
