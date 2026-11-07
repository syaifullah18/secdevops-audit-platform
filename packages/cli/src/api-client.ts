import {
  ApiError,
  CreateRunRequest,
  FindingPage,
  type FindingQuery,
  GateResult,
  isOpenStatus,
  Run,
  severityAtLeast,
  type Severity,
} from "@sdap/core";
import { CliError, EXIT_CODES } from "./types.js";

export interface ApiClientOptions {
  baseUrl?: string;
  token?: string;
}

export class ApiClient {
  readonly baseUrl: string;
  readonly token?: string;

  constructor(options: ApiClientOptions = {}) {
    let url = options.baseUrl ?? "http://localhost:3000";
    url = url.replace(/\/+$/, "");
    this.baseUrl = url;
    this.token = options.token;
  }

  buildUrl(path: string): string {
    const cleanPath = path.startsWith("/") ? path : `/${path}`;
    if (this.baseUrl.endsWith("/api/v1")) {
      const sub = cleanPath.startsWith("/api/v1") ? cleanPath.slice(7) : cleanPath;
      return `${this.baseUrl}${sub}`;
    }
    const full = cleanPath.startsWith("/api/v1") ? cleanPath : `/api/v1${cleanPath}`;
    return `${this.baseUrl}${full}`;
  }

  private async request<T>(
    path: string,
    options: RequestInit = {},
    responseType: "json" | "text" = "json",
  ): Promise<T> {
    const url = this.buildUrl(path);
    const headers = new Headers(options.headers);
    if (this.token && !headers.has("Authorization")) {
      headers.set("Authorization", `Bearer ${this.token}`);
    }
    if (!headers.has("Accept")) {
      headers.set(
        "Accept",
        responseType === "json" ? "application/json" : "text/plain, text/markdown, */*",
      );
    }

    let res: Response;
    try {
      res = await fetch(url, { ...options, headers });
    } catch (err) {
      throw new CliError(
        `Failed to connect to SDAP API at ${url}: ${err instanceof Error ? err.message : String(err)}`,
        EXIT_CODES.RUN_FAILED,
      );
    }

    if (!res.ok) {
      let errorMsg = `API request failed: ${res.status} ${res.statusText}`;
      try {
        const data: unknown = await res.json();
        const parsed = ApiError.safeParse(data);
        if (parsed.success) {
          errorMsg = `API error (${res.status}): ${parsed.data.message || parsed.data.error}`;
        } else if (
          data !== null &&
          typeof data === "object" &&
          "message" in data &&
          typeof (data as Record<string, unknown>)["message"] === "string"
        ) {
          errorMsg = `API error (${res.status}): ${(data as Record<string, unknown>)["message"]}`;
        }
      } catch {
        // Response was not JSON
      }

      if (res.status === 400 || res.status === 401 || res.status === 403) {
        throw new CliError(errorMsg, EXIT_CODES.USAGE_ERROR);
      }
      throw new CliError(errorMsg, EXIT_CODES.RUN_FAILED);
    }

    if (responseType === "text") {
      return (await res.text()) as T;
    }
    return (await res.json()) as T;
  }

  async createRun(request: CreateRunRequest): Promise<Run> {
    const validated = CreateRunRequest.parse(request);
    const data = await this.request<unknown>("/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validated),
    });

    const parsed = Run.safeParse(data);
    if (!parsed.success) {
      throw new CliError(
        `Invalid Run response from API on create: ${parsed.error.message}`,
        EXIT_CODES.RUN_FAILED,
      );
    }
    return parsed.data;
  }

  async getRun(runId: string): Promise<Run> {
    const data = await this.request<unknown>(`/runs/${encodeURIComponent(runId)}`, {
      method: "GET",
    });

    const parsed = Run.safeParse(data);
    if (!parsed.success) {
      throw new CliError(
        `Invalid Run response for run "${runId}": ${parsed.error.message}`,
        EXIT_CODES.RUN_FAILED,
      );
    }
    return parsed.data;
  }

  async getGate(projectId: string): Promise<GateResult> {
    const data = await this.request<unknown>(`/projects/${encodeURIComponent(projectId)}/gate`, {
      method: "GET",
    });

    const parsed = GateResult.safeParse(data);
    if (!parsed.success) {
      throw new CliError(
        `Invalid GateResult response for project "${projectId}": ${parsed.error.message}`,
        EXIT_CODES.RUN_FAILED,
      );
    }
    return parsed.data;
  }

  async getFindings(query: FindingQuery): Promise<FindingPage> {
    const params = new URLSearchParams();
    if (query.projectId) params.set("projectId", query.projectId);
    if (query.verdict) {
      for (const v of query.verdict) params.append("verdict", v);
    }
    if (query.status) {
      for (const s of query.status) params.append("status", s);
    }
    if (query.minSeverity) params.set("minSeverity", query.minSeverity);
    if (query.attackClass) {
      for (const a of query.attackClass) params.append("attackClass", a);
    }
    if (query.includeRejected !== undefined) {
      params.set("includeRejected", String(query.includeRejected));
    }
    if (query.q) params.set("q", query.q);
    if (query.cursor) params.set("cursor", query.cursor);
    if (query.limit !== undefined) params.set("limit", String(query.limit));

    const qs = params.toString();
    const data = await this.request<unknown>(`/findings${qs ? `?${qs}` : ""}`, {
      method: "GET",
    });

    const parsed = FindingPage.safeParse(data);
    if (!parsed.success) {
      throw new CliError(
        `Invalid FindingPage response: ${parsed.error.message}`,
        EXIT_CODES.RUN_FAILED,
      );
    }
    return parsed.data;
  }

  async getReport(runId: string, format: "md" | "json"): Promise<string | Record<string, unknown>> {
    try {
      if (format === "json") {
        return await this.request<Record<string, unknown>>(
          `/runs/${encodeURIComponent(runId)}/report?format=json`,
          { method: "GET" },
          "json",
        );
      }
      return await this.request<string>(
        `/runs/${encodeURIComponent(runId)}/report?format=md`,
        { method: "GET" },
        "text",
      );
    } catch {
      // If server does not have a dedicated report endpoint, fallback to synthesizing from Run
      const run = await this.getRun(runId);
      if (format === "json") {
        return {
          runId: run.id,
          projectId: run.projectId,
          status: run.status,
          mode: run.mode,
          ref: run.ref,
          commitSha: run.commitSha,
          createdAt: run.createdAt,
          startedAt: run.startedAt,
          endedAt: run.endedAt,
          validators: run.validators,
          phases: run.phases,
          artifacts: run.artifacts,
          usage: run.usage,
          failureReason: run.failureReason,
        };
      }

      // Generate Markdown
      return [
        `# SDAP Audit Report - Run ${run.id}`,
        "",
        `| Property | Value |`,
        `| --- | --- |`,
        `| **Project** | \`${run.projectId}\` |`,
        `| **Status** | **${run.status.toUpperCase()}** |`,
        `| **Mode** | \`${run.mode}\` |`,
        `| **Git Ref** | \`${run.ref}\` (${run.commitSha ?? "unresolved"}) |`,
        `| **Created** | ${run.createdAt} |`,
        `| **Started** | ${run.startedAt ?? "N/A"} |`,
        `| **Ended** | ${run.endedAt ?? "N/A"} |`,
        `| **Findings Validator** | \`${run.validators.findings}\` |`,
        `| **Ledger Validator** | \`${run.validators.coverageLedger}\` |`,
        run.failureReason ? `| **Failure Reason** | ${run.failureReason} |` : null,
        "",
        "## Phases",
        "",
        ...run.phases.map(
          (p) => `- **${p.name}**: ${p.status} (${p.slicesDone}/${p.sliceCount} slices completed)`,
        ),
        "",
        "## Artifacts",
        "",
        run.artifacts.reportMd ? `- Report Markdown: \`${run.artifacts.reportMd}\`` : null,
        run.artifacts.findingsJson ? `- Findings JSON: \`${run.artifacts.findingsJson}\`` : null,
        run.artifacts.coverageLedgerJson
          ? `- Coverage Ledger: \`${run.artifacts.coverageLedgerJson}\``
          : null,
      ]
        .filter((line): line is string => line !== null)
        .join("\n");
    }
  }

  async checkConfirmedThreshold(
    projectId: string,
    minSeverity: Severity,
  ): Promise<{
    failed: boolean;
    violations: Array<{ findingId: string; severity: Severity; fingerprint?: string }>;
  }> {
    // 1. First attempt: check gate endpoint
    try {
      const gate = await this.getGate(projectId);
      const violations = gate.violations.filter((v) => severityAtLeast(v.severity, minSeverity));
      if (violations.length > 0) {
        return { failed: true, violations };
      }
      return { failed: false, violations: [] };
    } catch {
      // 2. Fallback: check findings endpoint
      const page = await this.getFindings({
        projectId,
        verdict: ["confirmed"],
      });
      const violations = page.items
        .filter((f) => {
          if (f.verdict !== "confirmed" || f.verifiedSeverity === null) {
            return false;
          }
          return isOpenStatus(f.status) && severityAtLeast(f.verifiedSeverity, minSeverity);
        })
        .map((f) => ({
          findingId: f.id,
          severity: f.verifiedSeverity as Severity,
          fingerprint: f.fingerprint,
        }));
      if (violations.length > 0) {
        return { failed: true, violations };
      }
      return { failed: false, violations: [] };
    }
  }
}
