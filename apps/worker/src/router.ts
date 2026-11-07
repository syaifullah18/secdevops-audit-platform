import {
  type AdapterRegistry,
  type GenerateResult,
  ModelAdapterError,
  type ModelRef,
  type ModelRoute,
  type Slice,
  type SliceAttempt,
  type Store,
  modelFamily,
} from "@sdap/core";
import type { EventSequencer } from "./events.js";

export function resolveRouteCandidates(route: ModelRoute, hunterModel?: ModelRef): ModelRef[] {
  const allCandidates = [route.primary, ...route.fallbacks];

  if (route.task === "validate" && hunterModel) {
    const huntFamily = modelFamily(hunterModel);
    const primaryFamily = modelFamily(route.primary);

    if (primaryFamily !== huntFamily) {
      return allCandidates;
    }

    // Primary matches hunter family; look for a fallback with a different family
    const diffIndex = route.fallbacks.findIndex((m) => modelFamily(m) !== huntFamily);

    if (diffIndex !== -1) {
      const diffModel = route.fallbacks[diffIndex]!;
      const remaining = allCandidates.filter(
        (m) => !(m.adapter === diffModel.adapter && m.model === diffModel.model),
      );
      return [diffModel, ...remaining];
    }
  }

  return allCandidates;
}

export interface ExecuteSliceOptions {
  slice: Slice;
  route: ModelRoute;
  hunterModel?: ModelRef;
  adapterRegistry: AdapterRegistry;
  sequencer: EventSequencer;
  store: Store;
  prompt: string;
  metadata?: Record<string, string>;
  maxRetriesPerModel?: number;
  backoffMs?: number;
  signal?: AbortSignal;
}

export interface ExecuteSliceResult {
  success: boolean;
  result?: GenerateResult;
  usedModel?: ModelRef;
  error?: string;
}

export async function executeSliceWithFallback(
  options: ExecuteSliceOptions,
): Promise<ExecuteSliceResult> {
  const {
    slice,
    route,
    hunterModel,
    adapterRegistry,
    sequencer,
    store,
    prompt,
    metadata = {},
    maxRetriesPerModel = 2,
    backoffMs = 50,
    signal,
  } = options;

  const candidates = resolveRouteCandidates(route, hunterModel);
  let lastError: string | undefined;

  for (let candIdx = 0; candIdx < candidates.length; candIdx++) {
    const candidate = candidates[candIdx]!;
    const nextCandidate = candidates[candIdx + 1] ?? null;
    let retries = 0;

    while (true) {
      if (signal?.aborted) {
        return { success: false, error: "Execution aborted" };
      }

      const attemptNumber = slice.attempts.length + 1;

      await sequencer.emitSliceStarted({
        sliceId: slice.id,
        phase: slice.phase,
        label: slice.label,
        attempt: attemptNumber,
        model: candidate,
      });

      const attempt: SliceAttempt = {
        attempt: attemptNumber,
        model: candidate,
        status: "running",
        startedAt: new Date().toISOString(),
        endedAt: null,
        errorCode: null,
        errorMessage: null,
        usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
        logKey: null,
      };

      try {
        const adapter = adapterRegistry.resolve(candidate);
        const result = await adapter.generate(
          {
            task: route.task,
            model: candidate.model,
            messages: [{ role: "user", content: prompt }],
            maxOutputTokens: 4096,
            metadata,
          },
          { signal },
        );

        attempt.status = "succeeded";
        attempt.endedAt = new Date().toISOString();
        attempt.usage = result.usage;
        slice.attempts.push(attempt);
        slice.status = "succeeded";
        slice.endedAt = new Date().toISOString();

        await store.runs.upsertSlice(slice);
        await sequencer.emitSliceDone({
          sliceId: slice.id,
          phase: slice.phase,
          status: "succeeded",
          model: candidate,
          usage: result.usage,
        });

        return {
          success: true,
          result,
          usedModel: candidate,
        };
      } catch (err) {
        attempt.status = "failed";
        attempt.endedAt = new Date().toISOString();

        const errorCode = err instanceof ModelAdapterError ? err.code : "unknown";
        const errorMessage = err instanceof Error ? err.message : String(err);
        attempt.errorCode = errorCode;
        attempt.errorMessage = errorMessage;
        lastError = errorMessage;

        slice.attempts.push(attempt);
        await store.runs.upsertSlice(slice);

        const shouldFallBack = err instanceof ModelAdapterError && err.shouldFallBack;

        if (shouldFallBack) {
          await sequencer.emitSliceAttemptFailed({
            sliceId: slice.id,
            attempt: attemptNumber,
            model: candidate,
            errorCode,
            nextModel: nextCandidate,
          });
          break; // Move to next candidate model
        }

        if (errorCode === "rate_limited" || errorCode === "timeout") {
          if (retries < maxRetriesPerModel) {
            retries++;
            await sequencer.emitSliceAttemptFailed({
              sliceId: slice.id,
              attempt: attemptNumber,
              model: candidate,
              errorCode,
              nextModel: candidate, // Retrying same model
            });

            const retryWait =
              err instanceof ModelAdapterError && err.retryAfterMs
                ? err.retryAfterMs
                : backoffMs * Math.pow(2, retries - 1);

            await new Promise((resolve) => setTimeout(resolve, retryWait));
            continue; // Retry same model
          }
        }

        // Retries exhausted or unknown error
        await sequencer.emitSliceAttemptFailed({
          sliceId: slice.id,
          attempt: attemptNumber,
          model: candidate,
          errorCode,
          nextModel: nextCandidate,
        });
        break; // Move to next candidate model
      }
    }
  }

  // All candidates failed
  slice.status = "failed";
  slice.endedAt = new Date().toISOString();
  await store.runs.upsertSlice(slice);
  await sequencer.emitSliceDone({
    sliceId: slice.id,
    phase: slice.phase,
    status: "failed",
    model: null,
    usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
  });

  return {
    success: false,
    error: lastError ?? "All candidate models failed",
  };
}
