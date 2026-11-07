// INTENTIONALLY VULNERABLE TEST FIXTURE - do not deploy
// Safe counterpart: escapes output using escapeHtml
import type { Handler } from "../types.js";
import { escapeHtml } from "../lib/escape.js";
import { sendHtml } from "../lib/http.js";

export const renderSafeHandler: Handler = (_req, res, ctx) => {
  const title = ctx.url.searchParams.get("title") ?? "";
  const html = `<!doctype html><html><body><h1>Note: ${escapeHtml(title)}</h1></body></html>`;
  sendHtml(res, 200, html);
};
