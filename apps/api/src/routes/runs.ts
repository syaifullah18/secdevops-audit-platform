import type { FastifyPluginAsync } from "fastify";
import { CreateRunRequest, type PlatformEvent, RunPage, type Store } from "@sdap/core";
import { z } from "zod";
import { setAudit } from "../audit.js";
import { BadRequestError, ConflictError, NotFoundError } from "../errors.js";
import { PageQuery, parseId, parseWith, TERMINAL_RUN_STATUSES } from "../http.js";
import type { Queue } from "../queue.js";
import { requireRoles } from "../rbac.js";
import { queueRun } from "../run-service.js";

export interface RunRouteOptions {
  store: Store;
  queue: Queue;
  skillVersion: string;
  /** How often the SSE stream polls the event store. */
  ssePollMs: number;
}

const AfterSeq = z.object({ afterSeq: z.coerce.number().int().min(0).optional() });
const SSE_HEARTBEAT_MS = 15_000;

export const runRoutes: FastifyPluginAsync<RunRouteOptions> = async (app, opts) => {
  const { store, queue } = opts;

  app.post("/runs", { preHandler: [requireRoles("devops")] }, async (req, reply) => {
    const input = parseWith(CreateRunRequest, req.body, "run request");
    if (input.repeat > 1 && input.mode !== "full") {
      throw new BadRequestError('repeat > 1 is only valid for mode "full"');
    }
    const project = await store.projects.get(input.projectId, req.scope);
    if (!project) throw new NotFoundError("Project not found");

    const run = await queueRun(
      { store, queue, skillVersion: opts.skillVersion },
      {
        projectId: project.id,
        mode: input.mode,
        repeat: input.repeat,
        ref: input.ref,
        commitSha: null,
        scope: input.scope,
        trigger: { kind: input.trigger.kind, actor: req.user.subject, ref: input.trigger.ref },
      },
    );
    setAudit(req, { action: "run.create", target: run.id, details: { projectId: project.id } });
    return reply.status(201).send(run);
  });

  app.get("/runs/:id", async (req) => {
    const id = parseId((req.params as { id: string }).id, "Run");
    const run = await store.runs.get(id, req.scope);
    if (!run) throw new NotFoundError("Run not found");
    return run;
  });

  app.get("/projects/:id/runs", async (req) => {
    const id = parseId((req.params as { id: string }).id, "Project");
    if (!(await store.projects.get(id, req.scope))) throw new NotFoundError("Project not found");
    const page = parseWith(PageQuery, req.query ?? {}, "query");
    return RunPage.parse(await store.runs.list(id, req.scope, page));
  });

  app.post("/runs/:id/cancel", { preHandler: [requireRoles("devops")] }, async (req) => {
    const id = parseId((req.params as { id: string }).id, "Run");
    setAudit(req, { action: "run.cancel", target: id });
    const run = await store.runs.get(id, req.scope);
    if (!run) throw new NotFoundError("Run not found");
    if (TERMINAL_RUN_STATUSES.includes(run.status)) {
      throw new ConflictError(`Run already finished with status ${run.status}`);
    }

    // Removes a waiting job; a running worker sees the cancelled status and stops.
    await queue.cancel(id);
    const now = new Date().toISOString();
    const updated = await store.runs.update(id, { status: "cancelled", endedAt: now });

    const existing = await store.events.listByRun(id);
    const event: PlatformEvent = {
      id: crypto.randomUUID(),
      runId: id,
      projectId: run.projectId,
      seq: existing.reduce((max, e) => Math.max(max, e.seq), -1) + 1,
      at: now,
      type: "run.cancelled",
      payload: { by: req.user.subject },
    };
    await store.events.append(event);
    return updated;
  });

  app.get("/runs/:id/events", async (req) => {
    const id = parseId((req.params as { id: string }).id, "Run");
    if (!(await store.runs.get(id, req.scope))) throw new NotFoundError("Run not found");
    const { afterSeq } = parseWith(AfterSeq, req.query ?? {}, "query");
    return store.events.listByRun(id, afterSeq);
  });

  // Server-Sent Events: replays stored events, then follows new ones until the run ends.
  // Reconnecting clients resume with the standard `Last-Event-ID` header (the event seq).
  app.get("/runs/:id/events/stream", async (req, reply) => {
    const id = parseId((req.params as { id: string }).id, "Run");
    if (!(await store.runs.get(id, req.scope))) throw new NotFoundError("Run not found");

    const { afterSeq } = parseWith(AfterSeq, req.query ?? {}, "query");
    const lastEventId = Number(req.headers["last-event-id"]);
    let lastSeq =
      afterSeq ?? (Number.isInteger(lastEventId) && lastEventId >= 0 ? lastEventId : -1);

    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });

    let closed = false;
    let timer: NodeJS.Timeout | undefined;
    let lastWrite = Date.now();
    const finish = (): void => {
      if (closed) return;
      closed = true;
      if (timer) clearTimeout(timer);
      res.end();
    };
    req.raw.on("close", () => {
      closed = true;
      if (timer) clearTimeout(timer);
    });

    const tick = async (): Promise<void> => {
      try {
        // Read the run status first so events written right before it ended are still sent.
        const current = await store.runs.get(id, req.scope);
        const events = await store.events.listByRun(id, lastSeq >= 0 ? lastSeq : undefined);
        for (const ev of events) {
          res.write(`id: ${ev.seq}\nevent: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`);
          lastSeq = Math.max(lastSeq, ev.seq);
          lastWrite = Date.now();
        }
        if (!current || TERMINAL_RUN_STATUSES.includes(current.status)) return finish();
        if (Date.now() - lastWrite >= SSE_HEARTBEAT_MS) {
          res.write(": keep-alive\n\n");
          lastWrite = Date.now();
        }
        if (!closed) timer = setTimeout(() => void tick(), opts.ssePollMs);
      } catch (err) {
        req.log.error({ err }, "event stream failed");
        finish();
      }
    };
    await tick();
  });
};
