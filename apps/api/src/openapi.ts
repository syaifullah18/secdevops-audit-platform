import {
  ApiError,
  CreateRunRequest,
  Exception,
  Finding,
  FindingPage,
  FindingQuery,
  GateResult,
  PlatformEvent,
  Policy,
  Project,
  Run,
  RunPage,
  TriageEvent,
  TriageRequest,
} from "@sdap/core";
import { z } from "zod";
import { CreateProjectInput, PatchProjectInput } from "./routes/projects.js";
import { PolicyInput } from "./routes/policies.js";

type Io = "input" | "output";

/** JSON Schema for a Zod contract, without the per-schema `$schema` dialect marker. */
const toSchema = (schema: z.ZodType, io: Io): unknown => {
  const { $schema: _dialect, ...rest } = z.toJSONSchema(schema, { io, unrepresentable: "any" });
  return rest;
};

export const getOpenApiSpec = () => {
  const schemas: Record<string, unknown> = {
    ApiError: toSchema(ApiError, "output"),
    Project: toSchema(Project, "output"),
    Run: toSchema(Run, "output"),
    RunPage: toSchema(RunPage, "output"),
    CreateRunRequest: toSchema(CreateRunRequest, "input"),
    Finding: toSchema(Finding, "output"),
    FindingPage: toSchema(FindingPage, "output"),
    FindingQuery: toSchema(FindingQuery, "input"),
    TriageRequest: toSchema(TriageRequest, "input"),
    TriageEvent: toSchema(TriageEvent, "output"),
    Policy: toSchema(Policy, "output"),
    Exception: toSchema(Exception, "output"),
    GateResult: toSchema(GateResult, "output"),
    PlatformEvent: toSchema(PlatformEvent, "output"),
    CreateProjectRequest: toSchema(CreateProjectInput, "input"),
    PatchProjectRequest: toSchema(PatchProjectInput, "input"),
    PolicyRequest: toSchema(PolicyInput, "input"),
  };

  return {
    openapi: "3.1.0",
    info: {
      title: "SecDevOps Audit Platform API",
      version: "0.1.0",
      description:
        "Fastify API for audit orchestration, findings management, policy enforcement, and webhooks.",
    },
    paths: {
      "/healthz": {
        get: {
          summary: "Liveness probe",
          responses: {
            "200": {
              description: "Service is healthy",
              content: {
                "application/json": {
                  schema: { type: "object", properties: { status: { type: "string" } } },
                },
              },
            },
          },
        },
      },
      "/readyz": {
        get: {
          summary: "Readiness probe",
          responses: {
            "200": {
              description: "Service is ready",
              content: {
                "application/json": {
                  schema: { type: "object", properties: { status: { type: "string" } } },
                },
              },
            },
            "503": {
              description: "Service unavailable",
            },
          },
        },
      },
      "/openapi.json": {
        get: {
          summary: "OpenAPI specification document",
          responses: {
            "200": {
              description: "OpenAPI 3.1 specification",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/PatchProjectRequest" },
                },
              },
            },
          },
        },
      },
      "/api/v1/projects": {
        get: {
          summary: "List projects in caller scope",
          security: [{ BearerAuth: [] }],
          responses: {
            "200": {
              description: "List of projects",
              content: {
                "application/json": {
                  schema: { type: "array", items: { $ref: "#/components/schemas/Project" } },
                },
              },
            },
            "401": { $ref: "#/components/responses/Unauthorized" },
          },
        },
        post: {
          summary: "Create a new project",
          security: [{ BearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/CreateProjectRequest" } },
            },
          },
          responses: {
            "201": {
              description: "Project created",
              content: { "application/json": { schema: { $ref: "#/components/schemas/Project" } } },
            },
            "400": { $ref: "#/components/responses/BadRequest" },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "403": { $ref: "#/components/responses/Forbidden" },
          },
        },
      },
      "/api/v1/projects/{id}": {
        get: {
          summary: "Get a project by ID",
          security: [{ BearerAuth: [] }],
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
          ],
          responses: {
            "200": {
              description: "Project details",
              content: { "application/json": { schema: { $ref: "#/components/schemas/Project" } } },
            },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "404": { $ref: "#/components/responses/NotFound" },
          },
        },
        patch: {
          summary: "Update project settings",
          security: [{ BearerAuth: [] }],
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
          ],
          requestBody: {
            required: true,
            content: { "application/json": { schema: { type: "object" } } },
          },
          responses: {
            "200": {
              description: "Project updated",
              content: { "application/json": { schema: { $ref: "#/components/schemas/Project" } } },
            },
            "400": { $ref: "#/components/responses/BadRequest" },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "403": { $ref: "#/components/responses/Forbidden" },
            "404": { $ref: "#/components/responses/NotFound" },
          },
        },
      },
      "/api/v1/projects/{id}/runs": {
        get: {
          summary: "List runs for a project",
          security: [{ BearerAuth: [] }],
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
            { name: "cursor", in: "query", schema: { type: "string" } },
            { name: "limit", in: "query", schema: { type: "integer", default: 50 } },
          ],
          responses: {
            "200": {
              description: "Page of runs",
              content: { "application/json": { schema: { $ref: "#/components/schemas/RunPage" } } },
            },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "404": { $ref: "#/components/responses/NotFound" },
          },
        },
      },
      "/api/v1/projects/{id}/gate": {
        get: {
          summary: "Evaluate release gate for a project",
          security: [{ BearerAuth: [] }],
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
          ],
          responses: {
            "200": {
              description: "Gate evaluation result",
              content: {
                "application/json": { schema: { $ref: "#/components/schemas/GateResult" } },
              },
            },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "404": { $ref: "#/components/responses/NotFound" },
          },
        },
      },
      "/api/v1/runs": {
        post: {
          summary: "Trigger an audit run",
          security: [{ BearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/CreateRunRequest" } },
            },
          },
          responses: {
            "201": {
              description: "Run created and queued",
              content: { "application/json": { schema: { $ref: "#/components/schemas/Run" } } },
            },
            "400": { $ref: "#/components/responses/BadRequest" },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "403": { $ref: "#/components/responses/Forbidden" },
            "404": { $ref: "#/components/responses/NotFound" },
          },
        },
      },
      "/api/v1/runs/{id}": {
        get: {
          summary: "Get run details",
          security: [{ BearerAuth: [] }],
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
          ],
          responses: {
            "200": {
              description: "Run details",
              content: { "application/json": { schema: { $ref: "#/components/schemas/Run" } } },
            },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "404": { $ref: "#/components/responses/NotFound" },
          },
        },
      },
      "/api/v1/runs/{id}/cancel": {
        post: {
          summary: "Cancel an active or queued run",
          security: [{ BearerAuth: [] }],
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
          ],
          responses: {
            "200": {
              description: "Run cancelled",
              content: { "application/json": { schema: { $ref: "#/components/schemas/Run" } } },
            },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "403": { $ref: "#/components/responses/Forbidden" },
            "404": { $ref: "#/components/responses/NotFound" },
            "409": { description: "Run already terminal" },
          },
        },
      },
      "/api/v1/runs/{id}/events": {
        get: {
          summary: "List platform events for a run",
          security: [{ BearerAuth: [] }],
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
            { name: "afterSeq", in: "query", schema: { type: "integer" } },
          ],
          responses: {
            "200": {
              description: "List of platform events",
              content: {
                "application/json": {
                  schema: { type: "array", items: { $ref: "#/components/schemas/PlatformEvent" } },
                },
              },
            },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "404": { $ref: "#/components/responses/NotFound" },
          },
        },
      },
      "/api/v1/runs/{id}/events/stream": {
        get: {
          summary: "SSE real-time stream of run platform events",
          security: [{ BearerAuth: [] }],
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
          ],
          responses: {
            "200": {
              description: "Server-Sent Events stream",
              content: { "text/event-stream": {} },
            },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "404": { $ref: "#/components/responses/NotFound" },
          },
        },
      },
      "/api/v1/findings": {
        get: {
          summary: "Query findings in scope",
          security: [{ BearerAuth: [] }],
          parameters: [
            { name: "projectId", in: "query", schema: { type: "string", format: "uuid" } },
            { name: "verdict", in: "query", schema: { type: "array", items: { type: "string" } } },
            { name: "status", in: "query", schema: { type: "array", items: { type: "string" } } },
            { name: "minSeverity", in: "query", schema: { type: "string" } },
            {
              name: "attackClass",
              in: "query",
              schema: { type: "array", items: { type: "string" } },
            },
            { name: "includeRejected", in: "query", schema: { type: "boolean", default: false } },
            { name: "q", in: "query", schema: { type: "string" } },
            { name: "cursor", in: "query", schema: { type: "string" } },
            { name: "limit", in: "query", schema: { type: "integer", default: 50 } },
          ],
          responses: {
            "200": {
              description: "Page of findings",
              content: {
                "application/json": { schema: { $ref: "#/components/schemas/FindingPage" } },
              },
            },
            "400": { $ref: "#/components/responses/BadRequest" },
            "401": { $ref: "#/components/responses/Unauthorized" },
          },
        },
      },
      "/api/v1/findings/{id}": {
        get: {
          summary: "Get finding details",
          security: [{ BearerAuth: [] }],
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
          ],
          responses: {
            "200": {
              description: "Finding details",
              content: { "application/json": { schema: { $ref: "#/components/schemas/Finding" } } },
            },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "404": { $ref: "#/components/responses/NotFound" },
          },
        },
      },
      "/api/v1/findings/{id}/history": {
        get: {
          summary: "Get triage audit history for finding",
          security: [{ BearerAuth: [] }],
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
          ],
          responses: {
            "200": {
              description: "List of triage events",
              content: {
                "application/json": {
                  schema: { type: "array", items: { $ref: "#/components/schemas/TriageEvent" } },
                },
              },
            },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "404": { $ref: "#/components/responses/NotFound" },
          },
        },
      },
      "/api/v1/findings/{id}/triage": {
        post: {
          summary: "Triage a finding",
          security: [{ BearerAuth: [] }],
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/TriageRequest" } },
            },
          },
          responses: {
            "200": {
              description: "Updated finding",
              content: { "application/json": { schema: { $ref: "#/components/schemas/Finding" } } },
            },
            "400": { $ref: "#/components/responses/BadRequest" },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "403": { $ref: "#/components/responses/Forbidden" },
            "404": { $ref: "#/components/responses/NotFound" },
          },
        },
      },
      "/api/v1/review-queue": {
        get: {
          summary: "Review queue for open needs_validation findings",
          security: [{ BearerAuth: [] }],
          responses: {
            "200": {
              description: "Review queue page of findings",
              content: {
                "application/json": { schema: { $ref: "#/components/schemas/FindingPage" } },
              },
            },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "403": { $ref: "#/components/responses/Forbidden" },
          },
        },
      },
      "/api/v1/policies/{id}": {
        get: {
          summary: "Get policy by ID",
          security: [{ BearerAuth: [] }],
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
          ],
          responses: {
            "200": {
              description: "Policy details",
              content: { "application/json": { schema: { $ref: "#/components/schemas/Policy" } } },
            },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "404": { $ref: "#/components/responses/NotFound" },
          },
        },
        put: {
          summary: "Create or update policy",
          security: [{ BearerAuth: [] }],
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/PolicyRequest" } },
            },
          },
          responses: {
            "200": {
              description: "Policy updated",
              content: { "application/json": { schema: { $ref: "#/components/schemas/Policy" } } },
            },
            "400": { $ref: "#/components/responses/BadRequest" },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "403": { $ref: "#/components/responses/Forbidden" },
          },
        },
      },
      "/api/v1/webhooks/{provider}": {
        post: {
          summary: "Ingest CI webhook event",
          description:
            "Authenticated by signature instead of a bearer token: GitHub `X-Hub-Signature-256` and Bitbucket `X-Hub-Signature` carry `sha256=<HMAC-SHA256 of the body>`; GitLab sends the secret in `X-GitLab-Token`. Push, pull/merge request and tag events start a focused run; other events return 202 with status `ignored`.",
          parameters: [
            {
              name: "provider",
              in: "path",
              required: true,
              schema: { type: "string", enum: ["github", "gitlab", "bitbucket"] },
            },
          ],
          responses: {
            "202": {
              description: "Webhook accepted and run queued",
            },
            "400": { $ref: "#/components/responses/BadRequest" },
            "401": { $ref: "#/components/responses/Unauthorized" },
          },
        },
      },
    },
    components: {
      securitySchemes: {
        BearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
        },
      },
      schemas,
      responses: {
        BadRequest: {
          description: "Bad Request",
          content: { "application/json": { schema: { $ref: "#/components/schemas/ApiError" } } },
        },
        Unauthorized: {
          description: "Unauthorized",
          content: { "application/json": { schema: { $ref: "#/components/schemas/ApiError" } } },
        },
        Forbidden: {
          description: "Forbidden",
          content: { "application/json": { schema: { $ref: "#/components/schemas/ApiError" } } },
        },
        NotFound: {
          description: "Not Found",
          content: { "application/json": { schema: { $ref: "#/components/schemas/ApiError" } } },
        },
      },
    },
  };
};
