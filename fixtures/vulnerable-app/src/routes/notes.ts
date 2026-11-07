// INTENTIONALLY VULNERABLE TEST FIXTURE - do not deploy
// CWE-639: Broken Object Level Authorization (BOLA/IDOR)
import type { Handler } from "../types.js";
import { db } from "../db.js";
import { sendJson } from "../lib/http.js";

export const getNoteHandler: Handler = (_req, res, ctx) => {
  const id = Number(ctx.params[0]);
  const note = db.get(id);
  if (!note) {
    sendJson(res, 404, { error: "Note not found" });
    return;
  }
  // Vulnerable: does not verify note.ownerId === ctx.userId
  sendJson(res, 200, note);
};
