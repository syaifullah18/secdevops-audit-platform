import path from "node:path";
import { z } from "zod";

export const WorkerConfig = z.object({
  nodeEnv: z.enum(["development", "production", "test"]).default("development"),
  logLevel: z.enum(["debug", "info", "warn", "error"]).default("info"),
  redisUrl: z.string().default("redis://localhost:6379"),
  workerConcurrency: z.coerce.number().int().positive().default(2),
  maxValidationRetries: z.coerce.number().int().nonnegative().default(2),
  skillPath: z
    .string()
    .default(path.resolve(process.cwd(), "vendor/security-audit-skill/skills/security-audit")),
  defaultMaxRuntimeSec: z.coerce
    .number()
    .int()
    .positive()
    .default(4 * 60 * 60),
  defaultTokenBudget: z.coerce.number().int().positive().nullable().default(null),
  outputBaseDir: z.string().default(path.resolve(process.cwd(), ".sdap/runs")),
});

export type WorkerConfig = z.infer<typeof WorkerConfig>;

export function parseWorkerConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  return WorkerConfig.parse({
    nodeEnv: env.NODE_ENV,
    logLevel: env.LOG_LEVEL,
    redisUrl: env.REDIS_URL,
    workerConcurrency: env.WORKER_CONCURRENCY,
    maxValidationRetries: env.MAX_VALIDATION_RETRIES,
    skillPath: env.SDAP_SKILL_PATH,
    defaultMaxRuntimeSec: env.DEFAULT_MAX_RUNTIME_SEC,
    defaultTokenBudget: env.DEFAULT_TOKEN_BUDGET ? Number(env.DEFAULT_TOKEN_BUDGET) : null,
    outputBaseDir: env.SDAP_OUTPUT_BASE_DIR,
  });
}
