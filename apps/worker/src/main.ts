import { createAdapterRegistry } from "@sdap/adapters";
import { createPgStore } from "@sdap/api";
import { DockerSandboxRunner, NoSandboxRunner } from "@sdap/sandbox";
import { AgentCliAdapter } from "./agent-adapter.js";
import { parseWorkerConfig } from "./config.js";
import { createMetrics, startMetricsServer } from "./metrics.js";
import { createAuditWorker } from "./worker.js";

const start = async () => {
  const config = parseWorkerConfig();

  const databaseUrl = process.env["DATABASE_URL"];
  if (!databaseUrl) {
    throw new Error("DATABASE_URL environment variable is required to start the worker");
  }

  const store = createPgStore(databaseUrl);

  const metrics = createMetrics();
  const metricsPort = Number(process.env["SDAP_METRICS_PORT"] || 9464);
  const metricsHost = process.env["SDAP_METRICS_HOST"] || "0.0.0.0";
  const metricsServer = await startMetricsServer(metrics.registry, {
    port: metricsPort,
    host: metricsHost,
  });
  console.warn(
    `SecDevOps Audit Platform Worker metrics listening on ${metricsHost}:${metricsPort}`,
  );

  const useNoSandbox =
    process.env["SDAP_SANDBOX_RUNNER"] === "none" ||
    (config.nodeEnv !== "production" && !process.env["SDAP_SANDBOX_IMAGE"]);

  const sandboxRunner = useNoSandbox
    ? new NoSandboxRunner()
    : new DockerSandboxRunner({
        dockerPath: process.env["SDAP_DOCKER_PATH"] || "podman",
        image: process.env["SDAP_SANDBOX_IMAGE"] || "sdap-sandbox:latest",
        runtime: process.env["SDAP_OCI_RUNTIME"],
        seccompProfile: process.env["SDAP_SECCOMP_PROFILE"],
        egressProxyImage: process.env["SDAP_EGRESS_PROXY_IMAGE"] || "sdap-egress-proxy:latest",
      });

  const adapterRegistry = createAdapterRegistry();
  const claudeAdapter = new AgentCliAdapter({
    id: "agent-cli:claude",
    command: process.env["SDAP_CLAUDE_PATH"] || "claude",
    sandboxRunner,
  });
  const agyAdapter = new AgentCliAdapter({
    id: "agent-cli:agy",
    command: process.env["SDAP_AGY_PATH"] || "agy",
    sandboxRunner,
  });
  adapterRegistry.register(claudeAdapter);
  adapterRegistry.register(agyAdapter);

  const workerInstance = createAuditWorker({
    config,
    store,
    sandboxRunner,
    adapterRegistry,
    connection: {
      url: config.redisUrl,
    },
  });
  console.warn(
    `SecDevOps Audit Platform Worker started (concurrency: ${config.workerConcurrency})`,
  );

  const shutdown = async (signal: string) => {
    console.warn(`Worker received ${signal}, shutting down gracefully...`);
    try {
      await workerInstance.close();
      await new Promise<void>((resolve) => metricsServer.close(() => resolve()));
      await store.close();
      process.exit(0);
    } catch (err) {
      console.error("Error during worker shutdown:", err);
      process.exit(1);
    }
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
};

if (process.env["NODE_ENV"] !== "test") {
  start().catch((err) => {
    console.error("Failed to start worker service:", err);
    process.exit(1);
  });
}
