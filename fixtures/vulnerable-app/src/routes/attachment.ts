// INTENTIONALLY VULNERABLE TEST FIXTURE - do not deploy
// CWE-22: Path Traversal via unvalidated filename
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Handler } from "../types.js";
import { sendJson } from "../lib/http.js";

const ATTACHMENTS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../data/attachments",
);

export const getAttachmentHandler: Handler = (_req, res, ctx) => {
  const file = ctx.url.searchParams.get("file") ?? "";
  // Vulnerable: directly joining user-controlled filename allows ../../ traversal
  const filePath = path.join(ATTACHMENTS_DIR, file);
  try {
    const data = fs.readFileSync(filePath, "utf-8");
    res.writeHead(200, { "content-type": "text/plain" });
    res.end(data);
  } catch {
    sendJson(res, 404, { error: "Attachment not found" });
  }
};
