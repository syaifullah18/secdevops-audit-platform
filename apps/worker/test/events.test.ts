import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { EventSequencer, MemoryEventSink } from "../src/events.js";

describe("EventSequencer & MemoryEventSink", () => {
  it("emits events with strictly monotonically increasing seq", async () => {
    const sink = new MemoryEventSink();
    const runId = crypto.randomUUID();
    const projectId = crypto.randomUUID();

    const sequencer = new EventSequencer({
      runId,
      projectId,
      sink,
    });

    expect(sequencer.currentSeq()).toBe(0);

    await sequencer.emitRunStarted({
      commitSha: "abcdef1234567890",
      skillVersion: "v1.0.0-test",
    });

    await sequencer.emitPhaseStarted({
      phase: "preflight",
      sliceCount: 1,
    });

    await sequencer.emitPhaseDone({
      phase: "preflight",
      status: "succeeded",
      usage: { inputTokens: 10, outputTokens: 5, costUsd: 0 },
    });

    await sequencer.emitRunCompleted({
      usage: { inputTokens: 10, outputTokens: 5, costUsd: 0 },
      counts: { confirmed: 1, needsValidation: 0, rejected: 0 },
    });

    const events = sink.getEvents();
    expect(events).toHaveLength(4);

    expect(events[0]?.seq).toBe(0);
    expect(events[1]?.seq).toBe(1);
    expect(events[2]?.seq).toBe(2);
    expect(events[3]?.seq).toBe(3);

    for (let i = 1; i < events.length; i++) {
      expect(events[i]!.seq).toBe(events[i - 1]!.seq + 1);
      expect(events[i]!.runId).toBe(runId);
      expect(events[i]!.projectId).toBe(projectId);
    }
  });
});
