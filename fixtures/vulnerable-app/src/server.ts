// INTENTIONALLY VULNERABLE TEST FIXTURE - do not deploy
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { getAttachmentHandler } from "./routes/attachment.js";
import { getNoteHandler } from "./routes/notes.js";
import { renderSafeHandler } from "./routes/render-safe.js";
import { renderHandler } from "./routes/render.js";
import { searchHandler } from "./routes/search.js";
import { sendJson } from "./lib/http.js";

export function createNotesServer() {
  return createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const host = req.headers.host ?? "localhost";
    const url = new URL(req.url ?? "/", `http://${host}`);
    const userId = (req.headers["x-user-id"] as string) ?? null;

    const pathname = url.pathname;
    if (pathname === "/search") {
      return searchHandler(req, res, { url, userId, params: [] });
    }
    const noteMatch = /^\/notes\/(\d+)$/.exec(pathname);
    if (noteMatch) {
      return getNoteHandler(req, res, { url, userId, params: [noteMatch[1]!] });
    }
    if (pathname === "/attachment") {
      return getAttachmentHandler(req, res, { url, userId, params: [] });
    }
    if (pathname === "/render") {
      return renderHandler(req, res, { url, userId, params: [] });
    }
    if (pathname === "/render-safe") {
      return renderSafeHandler(req, res, { url, userId, params: [] });
    }
    sendJson(res, 404, { error: "Not found" });
  });
}
