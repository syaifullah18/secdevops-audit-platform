// INTENTIONALLY VULNERABLE TEST FIXTURE - do not deploy
// Shared types for the synthetic "notes service". No real data: every value is made up.
import type { IncomingMessage, ServerResponse } from "node:http";

export interface NoteRow {
  id: number;
  ownerId: string;
  title: string;
  body: string;
  attachment: string | null;
}

/** Per-request context built by the server before a handler runs. */
export interface RequestContext {
  url: URL;
  /** Caller id taken from the x-user-id header; null when the caller is anonymous. */
  userId: string | null;
  /** Path parameters captured by the route pattern. */
  params: readonly string[];
}

export type Handler = (
  req: IncomingMessage,
  res: ServerResponse,
  ctx: RequestContext,
) => void | Promise<void>;
