import { ModelAdapterError, type CallOptions, type ModelErrorCode } from "@sdap/core";
import type { RetryConfig } from "./types.js";

/**
 * Parses the Retry-After header into milliseconds.
 * Supports integer seconds (e.g. "30") and HTTP-date strings (RFC 7231).
 */
export function parseRetryAfter(header: string | null | undefined): number | null {
  if (!header) return null;
  const trimmed = header.trim();
  if (!trimmed) return null;

  // Integer seconds format
  if (/^\d+$/.test(trimmed)) {
    const seconds = parseInt(trimmed, 10);
    return Math.max(0, seconds * 1000);
  }

  // HTTP-Date format (RFC 7231)
  const parsedDate = Date.parse(trimmed);
  if (!isNaN(parsedDate)) {
    const diff = parsedDate - Date.now();
    return Math.max(0, diff);
  }

  return null;
}

/**
 * Checks whether an error code should be retried inside the adapter.
 * Only rate_limited, timeout, and unavailable are retried.
 * Never retry safety_blocked, auth_failed, permission_denied, quota_exceeded, etc.
 */
export function isRetryableCode(code: ModelErrorCode): boolean {
  return code === "rate_limited" || code === "timeout" || code === "unavailable";
}

/**
 * Determines ModelErrorCode from HTTP status code and response body text.
 */
export function mapHttpStatusToErrorCode(status: number, bodyText: string): ModelErrorCode {
  const lowerBody = bodyText.toLowerCase();

  // Check for safety / content filter in any error body
  if (
    lowerBody.includes("safety") ||
    lowerBody.includes("content_filter") ||
    lowerBody.includes("blocked by safety") ||
    lowerBody.includes("policy_violation") ||
    lowerBody.includes("moderation") ||
    lowerBody.includes("harmful content")
  ) {
    return "safety_blocked";
  }

  if (status === 429) {
    // Discriminate between quota exceeded and temporary rate limiting
    if (
      lowerBody.includes("quota") ||
      lowerBody.includes("insufficient_quota") ||
      lowerBody.includes("resource_exhausted") ||
      lowerBody.includes("exceeded your current quota") ||
      lowerBody.includes("billing") ||
      lowerBody.includes("credit")
    ) {
      return "quota_exceeded";
    }
    return "rate_limited";
  }

  if (status === 401) {
    return "auth_failed";
  }

  if (status === 403) {
    return "permission_denied";
  }

  if (status >= 500 && status <= 599) {
    return "unavailable";
  }

  return "unknown";
}

/**
 * Sleep helper respecting AbortSignal.
 */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error("Aborted"));
      return;
    }

    const timer = setTimeout(() => {
      if (signal) {
        signal.removeEventListener("abort", onAbort);
      }
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(timer);
      if (signal) {
        signal.removeEventListener("abort", onAbort);
      }
      reject(signal?.reason ?? new Error("Aborted"));
    };

    if (signal) {
      signal.addEventListener("abort", onAbort);
    }
  });
}

/**
 * Calculates backoff delay with jitter.
 */
function calculateBackoffDelay(
  attempt: number,
  retryConfig: RetryConfig,
  retryAfterMs: number | null,
): number {
  if (retryAfterMs !== null && retryAfterMs > 0) {
    return Math.min(retryAfterMs, retryConfig.maxDelayMs);
  }

  const base = retryConfig.initialDelayMs * Math.pow(retryConfig.backoffFactor, attempt);
  const jitter = Math.random() * (base * 0.25);
  return Math.min(base + jitter, retryConfig.maxDelayMs);
}

export interface HttpRequestOptions {
  adapterId: string;
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  callOptions?: CallOptions;
  retryConfig: RetryConfig;
  defaultTimeoutMs: number;
}

export interface HttpResponse {
  status: number;
  headers: Headers;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- JSON response can be any valid JSON structure
  json: () => Promise<any>;
  text: () => Promise<string>;
  latencyMs: number;
}

/**
 * Executes an HTTP request with bounded exponential backoff retries, timeout management,
 * and standard error mapping to ModelAdapterError.
 */
export async function executeHttpRequest(opts: HttpRequestOptions): Promise<HttpResponse> {
  const { adapterId, url, method = "GET", headers = {}, body, callOptions, retryConfig } = opts;
  const timeoutMs = callOptions?.timeoutMs ?? opts.defaultTimeoutMs;
  const maxRetries = retryConfig.maxRetries;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const startTime = Date.now();
    const timeoutController = new AbortController();
    const timer = setTimeout(() => {
      timeoutController.abort(new Error(`Request timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    let activeSignal: AbortSignal;
    if (callOptions?.signal) {
      activeSignal = AbortSignal.any([callOptions.signal, timeoutController.signal]);
    } else {
      activeSignal = timeoutController.signal;
    }

    try {
      if (activeSignal.aborted) {
        throw new ModelAdapterError("timeout", adapterId, "Request aborted by signal", {
          cause: activeSignal.reason,
        });
      }

      const response = await fetch(url, {
        method,
        headers,
        body,
        signal: activeSignal,
      });

      clearTimeout(timer);
      const latencyMs = Date.now() - startTime;

      if (!response.ok) {
        const bodyText = await response.text();
        let retryAfterMs: number | null = null;
        const retryAfterHeader = response.headers.get("retry-after");
        if (retryAfterHeader) {
          retryAfterMs = parseRetryAfter(retryAfterHeader);
        } else {
          const retryAfterMsHeader = response.headers.get("retry-after-ms");
          if (retryAfterMsHeader && /^\d+$/.test(retryAfterMsHeader.trim())) {
            retryAfterMs = parseInt(retryAfterMsHeader.trim(), 10);
          }
        }
        const code = mapHttpStatusToErrorCode(response.status, bodyText);

        const error = new ModelAdapterError(
          code,
          adapterId,
          `HTTP ${response.status} from ${adapterId}: ${bodyText || response.statusText}`,
          { retryAfterMs },
        );

        if (attempt < maxRetries && isRetryableCode(code) && !callOptions?.signal?.aborted) {
          lastError = error;
          const delay = calculateBackoffDelay(attempt, retryConfig, retryAfterMs);
          await sleep(delay, callOptions?.signal);
          continue;
        }

        throw error;
      }

      let cachedText: string | null = null;
      return {
        status: response.status,
        headers: response.headers,
        latencyMs,
        text: async () => {
          if (cachedText === null) {
            cachedText = await response.text();
          }
          return cachedText;
        },
        json: async () => {
          if (cachedText === null) {
            cachedText = await response.text();
          }
          return JSON.parse(cachedText);
        },
      };
    } catch (err: unknown) {
      clearTimeout(timer);

      // Check if aborted by caller
      if (callOptions?.signal?.aborted) {
        throw new ModelAdapterError("timeout", adapterId, "Request was aborted by caller", {
          cause: callOptions.signal.reason ?? err,
        });
      }

      // Check if this attempt timed out
      const isAttemptTimeout =
        timeoutController.signal.aborted ||
        activeSignal.aborted ||
        (err instanceof Error && err.name === "AbortError") ||
        (typeof DOMException !== "undefined" &&
          err instanceof DOMException &&
          err.name === "AbortError") ||
        (err instanceof Error && err.message.toLowerCase().includes("timed out"));

      if (isAttemptTimeout) {
        const timeoutError = new ModelAdapterError(
          "timeout",
          adapterId,
          `Request timed out after ${timeoutMs}ms`,
          { cause: err },
        );
        if (attempt < maxRetries && !callOptions?.signal?.aborted) {
          lastError = timeoutError;
          const delay = calculateBackoffDelay(attempt, retryConfig, null);
          await sleep(delay, callOptions?.signal);
          continue;
        }
        throw timeoutError;
      }

      if (err instanceof ModelAdapterError) {
        if (attempt < maxRetries && isRetryableCode(err.code) && !callOptions?.signal?.aborted) {
          lastError = err;
          const delay = calculateBackoffDelay(attempt, retryConfig, err.retryAfterMs);
          await sleep(delay, callOptions?.signal);
          continue;
        }
        throw err;
      }

      const errorMsg =
        err instanceof Error ? err.message : `Unknown error communicating with ${adapterId}`;
      const adapterError = new ModelAdapterError("unavailable", adapterId, errorMsg, {
        cause: err,
      });

      if (attempt < maxRetries && !callOptions?.signal?.aborted) {
        lastError = adapterError;
        const delay = calculateBackoffDelay(attempt, retryConfig, null);
        await sleep(delay, callOptions?.signal);
        continue;
      }

      throw adapterError;
    }
  }

  throw (
    lastError ??
    new ModelAdapterError(
      "unavailable",
      adapterId,
      `Request to ${adapterId} failed after ${maxRetries} retries`,
    )
  );
}
