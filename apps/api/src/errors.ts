import type { ApiError as ApiErrorType } from "@sdap/core";
import type { ZodError } from "zod";

export class HttpError extends Error {
  readonly statusCode: number;
  readonly error: string;
  readonly details?: unknown;

  constructor(statusCode: number, error: string, message: string, details?: unknown) {
    super(message);
    this.name = "HttpError";
    this.statusCode = statusCode;
    this.error = error;
    this.details = details;
  }

  toApiError(): ApiErrorType {
    const res: ApiErrorType = { error: this.error, message: this.message };
    if (this.details !== undefined) res.details = this.details;
    return res;
  }
}

export class BadRequestError extends HttpError {
  constructor(message = "Bad Request", details?: unknown) {
    super(400, "Bad Request", message, details);
  }
}

export class UnauthorizedError extends HttpError {
  constructor(message = "Unauthorized") {
    super(401, "Unauthorized", message);
  }
}

export class ForbiddenError extends HttpError {
  constructor(message = "Forbidden") {
    super(403, "Forbidden", message);
  }
}

export class NotFoundError extends HttpError {
  constructor(message = "Not Found") {
    super(404, "Not Found", message);
  }
}

export class ConflictError extends HttpError {
  constructor(message = "Conflict") {
    super(409, "Conflict", message);
  }
}

export class ServiceUnavailableError extends HttpError {
  constructor(message = "Service Unavailable") {
    super(503, "Service Unavailable", message);
  }
}

export const formatZodError = (err: ZodError, message = "Validation failed"): ApiErrorType => ({
  error: "Bad Request",
  message:
    err.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ") || message,
  details: err.issues,
});
