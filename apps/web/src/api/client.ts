import { z } from "zod";
import {
  Project,
  Run,
  RunPage,
  Slice,
  Finding,
  FindingPage,
  TriageEvent,
  Policy,
  Exception,
  GateResult,
  PlatformEvent,
  type CreateRunRequest,
  type FindingQuery,
  type TriageRequest,
} from "@sdap/core";
import {
  CoverageSummarySchema,
  OrgOverviewMetricsSchema,
  type CoverageSummary,
  type OrgOverviewMetrics,
} from "./types.js";
import { mockStore } from "./mock.js";
import { UNAUTHORIZED_EVENT, getToken } from "../auth/session.js";

const API_BASE = (import.meta.env?.VITE_API_BASE_URL as string) || "/api/v1";

export async function request<T>(
  path: string,
  options?: RequestInit,
  schema?: z.ZodType<T>,
): Promise<T> {
  const url = `${API_BASE}${path}`;
  const headers = new Headers(options?.headers);
  if (!headers.has("Accept")) {
    headers.set("Accept", "application/json");
  }
  if (options?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const token = getToken();
  if (token && !headers.has("Authorization")) headers.set("Authorization", `Bearer ${token}`);

  const res = await fetch(url, { ...options, headers });
  if (res.status === 401 && token) {
    // The API rejected the token (expired or revoked): drop the session and go to sign-in.
    window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
  }
  if (!res.ok) {
    let errMessage = `HTTP ${res.status}: ${res.statusText}`;
    try {
      const errJson = await res.json();
      if (errJson?.message) errMessage = errJson.message;
      else if (errJson?.error) errMessage = errJson.error;
    } catch {
      // ignore json parse error
    }
    throw new Error(errMessage);
  }

  if (res.status === 204) return undefined as T;
  const json = await res.json();
  if (schema) {
    return schema.parse(json);
  }
  return json as T;
}

export const api = {
  async getProjects(): Promise<Project[]> {
    return request("/projects", { method: "GET" }, z.array(Project));
  },

  async getProject(id: string): Promise<Project> {
    return request(`/projects/${id}`, { method: "GET" }, Project);
  },

  async createProject(data: Partial<Project>): Promise<Project> {
    return request(
      "/projects",
      {
        method: "POST",
        body: JSON.stringify(data),
      },
      Project,
    );
  },

  async getRuns(projectId?: string): Promise<RunPage> {
    const path = projectId ? `/projects/${projectId}/runs` : "/runs";
    return request(path, { method: "GET" }, RunPage);
  },

  async getRun(id: string): Promise<Run> {
    return request(`/runs/${id}`, { method: "GET" }, Run);
  },

  async createRun(req: CreateRunRequest): Promise<Run> {
    return request(
      "/runs",
      {
        method: "POST",
        body: JSON.stringify(req),
      },
      Run,
    );
  },

  async cancelRun(id: string): Promise<{ success: boolean }> {
    return request(`/runs/${id}/cancel`, { method: "POST" }, z.object({ success: z.boolean() }));
  },

  async getRunSlices(runId: string): Promise<Slice[]> {
    return request(`/runs/${runId}/slices`, { method: "GET" }, z.array(Slice));
  },

  async getRunEvents(runId: string): Promise<PlatformEvent[]> {
    return request(`/runs/${runId}/events`, { method: "GET" }, z.array(PlatformEvent));
  },

  async getFindings(query?: FindingQuery): Promise<FindingPage> {
    const params = new URLSearchParams();
    if (query?.includeRejected) params.set("includeRejected", "true");
    if (query?.projectId) params.set("projectId", query.projectId);
    if (query?.q) params.set("q", query.q);
    if (query?.limit) params.set("limit", String(query.limit));
    const qs = params.toString() ? `?${params.toString()}` : "";
    return request(`/findings${qs}`, { method: "GET" }, FindingPage);
  },

  async getFinding(id: string): Promise<Finding> {
    return request(`/findings/${id}`, { method: "GET" }, Finding);
  },

  async getFindingHistory(id: string): Promise<TriageEvent[]> {
    return request(`/findings/${id}/history`, { method: "GET" }, z.array(TriageEvent));
  },

  async triageFinding(id: string, req: TriageRequest): Promise<Finding> {
    return request(
      `/findings/${id}/triage`,
      {
        method: "POST",
        body: JSON.stringify(req),
      },
      Finding,
    );
  },

  async getReviewQueue(): Promise<Finding[]> {
    return request("/review-queue", { method: "GET" }, z.array(Finding));
  },

  async getPolicy(id: string): Promise<Policy> {
    return request(`/policies/${id}`, { method: "GET" }, Policy);
  },

  async getExceptions(projectId?: string): Promise<Exception[]> {
    const qs = projectId ? `?projectId=${projectId}` : "";
    return request(`/exceptions${qs}`, { method: "GET" }, z.array(Exception));
  },

  async getGate(projectId: string): Promise<GateResult> {
    return request(`/projects/${projectId}/gate`, { method: "GET" }, GateResult);
  },

  async getCoverage(projectId: string): Promise<CoverageSummary> {
    return request(`/projects/${projectId}/coverage`, { method: "GET" }, CoverageSummarySchema);
  },

  async getOverview(): Promise<OrgOverviewMetrics> {
    return request("/overview", { method: "GET" }, OrgOverviewMetricsSchema);
  },

  /**
   * SSE stream subscription for run events.
   * If running against the mock store in-memory or preview/browser, listens to the mock store
   * or real EventSource.
   */
  subscribeToRunEvents(runId: string, onEvent: (ev: PlatformEvent) => void): () => void {
    // If native EventSource is available and not purely synthetic
    if (typeof window !== "undefined" && window.EventSource && !import.meta.env?.VITE_MOCK_API) {
      try {
        const es = new window.EventSource(`${API_BASE}/runs/${runId}/events/stream`);
        es.onmessage = (e) => {
          try {
            const data = JSON.parse(e.data);
            const parsed = PlatformEvent.parse(data);
            onEvent(parsed);
          } catch {
            // ignore parse failure
          }
        };
        return () => es.close();
      } catch {
        // fallback to store subscription
      }
    }

    return mockStore.subscribeRunEvents(runId, onEvent);
  },
};
