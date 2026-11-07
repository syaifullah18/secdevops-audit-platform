// INTENTIONALLY VULNERABLE TEST FIXTURE - do not deploy
// CWE-79: Cross-Site Scripting (XSS) via unescaped rendering
import type { Handler } from "../types.js";
import { sendHtml } from "../lib/http.js";

export const renderHandler: Handler = (_req, res, ctx) => {
  const title = ctx.url.searchParams.get("title") ?? "";
  // Vulnerable: unescaped user string embedded directly into HTML
  const html = `<!doctype html><html><body><h1>Note: ${title}</h1></body></html>`;
  sendHtml(res, 200, html);
};
