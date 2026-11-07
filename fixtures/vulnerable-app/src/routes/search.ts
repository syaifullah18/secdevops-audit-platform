// INTENTIONALLY VULNERABLE TEST FIXTURE - do not deploy
// CWE-89: SQL Injection via unsanitized search query concatenation
import type { Handler } from "../types.js";
import { db } from "../db.js";
import { sendJson } from "../lib/http.js";

export const searchHandler: Handler = (_req, res, ctx) => {
  const q = ctx.url.searchParams.get("q") ?? "";
  // Vulnerable: string concatenation directly into SQL query
  const sql = `SELECT * FROM notes WHERE owner_id = '${ctx.userId}' AND title LIKE '%${q}%'`;
  const rows = db.all(sql);
  sendJson(res, 200, { notes: rows });
};
