// INTENTIONALLY VULNERABLE TEST FIXTURE - do not deploy
import type { ServerResponse } from "node:http";

export const sendJson = (res: ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};

export const sendHtml = (res: ServerResponse, status: number, html: string): void => {
  res.writeHead(status, { "content-type": "text/html; charset=utf-8" });
  res.end(html);
};
