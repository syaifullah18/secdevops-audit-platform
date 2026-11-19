import type { FastifyPluginAsync } from "fastify";
import { type PlatformEvent, Run, type Store } from "@sdap/core";
import { CoverageLedger, normalizeRun, parseRawFindings, RawFindingsError } from "@sdap/normalizer";
import { z } from "zod";
import { setAudit } from "../audit.js";
import { BadRequestError, NotFoundError } from "../errors.js";
import { parseId, parseWith } from "../http.js";
import { requireRoles } from "../rbac.js";

const MAX_IMPORT_BYTES = 25 * 1024 * 1024;

const ImportBody = z.object({
  /** The skill's findings.json: an array of raw findings. */
  findings: z.unknown(),
  /** The skill's coverage-ledger.json, when available. */
  coverageLedger: z.unknown().optional(),
  /** Git ref and commit the audit covered. */
  ref: z.string().min(1).max(200).default("main"),
  commitSha: z
    .string()
    .regex(/^[0-9a-f]{7,64}$/)
    .nullable()
    .default(null),
  /** Which model produced the records, for attribution. */
  model: z
    .object({ adapter: z.string().min(1).max(100), model: z.string().min(1).max(100) })
    .default({ adapter: "import", model: "security-audit-skill" }),
});

/**
 * Loads the output of an audit that ran elsewhere (the security-audit-skill's findings.json and
 * coverage-ledger.json) into a project. It records one succeeded run so findings have a source,
 * then upserts by fingerprint, so importing the same file twice never duplicates findings and
 * keeps their triage status.
 */
export const importRoutes: FastifyPluginAsync<{ store: Store; skillVersion: string }> = async (
  app,
  opts,
) => {
  const { store } = opts;

  app.post(
    "/projects/:id/import",
    { bodyLimit: MAX_IMPORT_BYTES, preHandler: [requireRoles("devops", "security")] },
    async (req, reply) => {
      const id = parseId((req.params as { id: string }).id, "Project");
      const project = await store.projects.get(id, req.scope);
      if (!project) throw new NotFoundError("Project not found");
      const body = parseWith(ImportBody, req.body, "import");

      let raw;
      try {
        raw = parseRawFindings(body.findings);
      } catch (err) {
        if (err instanceof RawFindingsError) throw new BadRequestError(err.message);
        throw err;
      }
      let ledger: CoverageLedger = [];
      if (body.coverageLedger !== undefined) {
        const parsed = CoverageLedger.safeParse(body.coverageLedger);
        if (!parsed.success) throw new BadRequestError("coverageLedger is not a valid ledger");
        ledger = parsed.data;
      }

      const now = new Date().toISOString();
      const run = Run.parse({
        id: crypto.randomUUID(),
        projectId: project.id,
        mode: "full",
        repeat: 1,
        trigger: { kind: "api", actor: req.user.subject, ref: "import" },
        ref: body.ref,
        commitSha: body.commitSha,
        baseCommitSha: null,
        previousRunId: null,
        scope: {},
        status: "succeeded",
        validators: { findings: "passed", coverageLedger: ledger.length ? "passed" : "pending" },
        skillVersion: opts.skillVersion,
        usage: {},
        artifacts: {
          findingsJson: null,
          coverageLedgerJson: null,
          architectureMd: null,
          reportMd: null,
          findingsDetailMd: null,
          needsValidationMd: null,
        },
        failureReason: null,
        createdAt: now,
        startedAt: now,
        endedAt: now,
      });

      let findings;
      try {
        findings = normalizeRun({
          findings: raw,
          ledger,
          run,
          project,
          model: body.model,
          now,
        });
      } catch (err) {
        throw new BadRequestError(err instanceof Error ? err.message : "Could not import findings");
      }

      const event: PlatformEvent = {
        id: crypto.randomUUID(),
        runId: run.id,
        projectId: project.id,
        seq: 0,
        at: now,
        type: "run.queued",
        payload: {},
      };
      let created = 0;
      let updated = 0;
      await store.tx(async (tx) => {
        await tx.runs.create(run);
        await tx.events.append(event);
        for (const f of findings) {
          const res = await tx.findings.upsert(f);
          if (res.isNew) created += 1;
          else updated += 1;
        }
      });

      setAudit(req, {
        action: "project.import",
        target: project.id,
        details: { runId: run.id, findings: findings.length },
      });
      return reply.status(201).send({ runId: run.id, imported: findings.length, created, updated });
    },
  );
};
