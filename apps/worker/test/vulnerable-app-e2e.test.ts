import type { AddressInfo } from "node:net";
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { createNotesServer } from "../../../fixtures/vulnerable-app/src/server.js";
import { evaluateGate, type Policy } from "@sdap/core";
import { normalizeRun, type RawFinding, type LedgerUnit } from "@sdap/normalizer";

describe("WS9: Vulnerable Application Fixture & End-to-End Security Validation", () => {
  let server: ReturnType<typeof createNotesServer>;
  let baseUrl: string;

  beforeAll(async () => {
    server = createNotesServer();
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const addr = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  describe("Vulnerability characterization", () => {
    it("demonstrates SQL Injection (CWE-89) in search endpoint", async () => {
      // Normal search for user-a
      const normalRes = await fetch(`${baseUrl}/search?q=groceries`, {
        headers: { "x-user-id": "user-a" },
      });
      expect(normalRes.status).toBe(200);
      const normalData = (await normalRes.json()) as {
        notes: Array<{ id: number; ownerId: string }>;
      };
      expect(normalData.notes.every((n) => n.ownerId === "user-a")).toBe(true);

      // SQL injection via tautology: retrieves all rows including user-b's private note
      const injectionRes = await fetch(`${baseUrl}/search?q=${encodeURIComponent("' OR 1=1 --")}`, {
        headers: { "x-user-id": "user-a" },
      });
      expect(injectionRes.status).toBe(200);
      const injectionData = (await injectionRes.json()) as {
        notes: Array<{ id: number; ownerId: string }>;
      };
      expect(injectionData.notes.some((n) => n.ownerId === "user-b")).toBe(true);
    });

    it("demonstrates Broken Object Level Authorization (BOLA/IDOR, CWE-639)", async () => {
      // user-a requests note 3 belonging to user-b
      const res = await fetch(`${baseUrl}/notes/3`, {
        headers: { "x-user-id": "user-a" },
      });
      expect(res.status).toBe(200);
      const note = (await res.json()) as { id: number; ownerId: string; title: string };
      expect(note.id).toBe(3);
      expect(note.ownerId).toBe("user-b");
      expect(note.title).toBe("private plans");
    });

    it("demonstrates Path Traversal (CWE-22) in attachment endpoint", async () => {
      // Traversal to read source file
      const res = await fetch(`${baseUrl}/attachment?file=../../src/types.ts`);
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain("export interface NoteRow");
    });

    it("demonstrates Cross-Site Scripting (XSS, CWE-79) vs safe escaping", async () => {
      const payload = `<script>alert("xss")</script>`;
      // Vulnerable route returns unescaped payload
      const vulnRes = await fetch(`${baseUrl}/render?title=${encodeURIComponent(payload)}`);
      expect(vulnRes.status).toBe(200);
      const vulnHtml = await vulnRes.text();
      expect(vulnHtml).toContain(payload);

      // Safe route escapes HTML entities
      const safeRes = await fetch(`${baseUrl}/render-safe?title=${encodeURIComponent(payload)}`);
      expect(safeRes.status).toBe(200);
      const safeHtml = await safeRes.text();
      expect(safeHtml).not.toContain(payload);
      expect(safeHtml).toContain("&lt;script&gt;");
    });
  });

  describe("End-to-End Pipeline & Gate Invariant Evaluation", () => {
    it("normalizes detected findings from the vulnerable app and fails strict gate on confirmed critical/high", () => {
      const now = new Date().toISOString();
      const rawFindings = [
        {
          verdict: "confirmed" as const,
          fingerprint: "vuln-app:sqli:notes-search",
          title: "SQL Injection in Notes Search",
          description:
            "Unsanitized string concatenation in search query allows cross-tenant data exfiltration",
          root_cause: "String interpolation in searchHandler",
          trace: [
            {
              kind: "entrypoint" as const,
              file: "fixtures/vulnerable-app/src/routes/search.ts",
              line: 8,
              scope: "searchHandler",
              description: "Query parameter 'q' retrieved from request URL",
            },
            {
              kind: "sink" as const,
              file: "fixtures/vulnerable-app/src/routes/search.ts",
              line: 11,
              scope: "db.all",
              description: "Direct SQL execution with interpolated parameter",
            },
          ],
          evidence: [
            {
              file: "fixtures/vulnerable-app/src/routes/search.ts",
              line: 10,
              description:
                "const sql = `SELECT * FROM notes WHERE owner_id = '${ctx.userId}' AND title LIKE '%${q}%'`;",
            },
          ],
          severity: { overall_severity: "critical" as const },
          confidence: { score: "high" as const },
          remediation: {
            strategy:
              "Use parameterized queries with bound parameters instead of string interpolation.",
            code_changes: [
              {
                file_name: "fixtures/vulnerable-app/src/routes/search.ts",
                fixed_code:
                  "const sql = 'SELECT * FROM notes WHERE owner_id = ? AND title LIKE ?'; const rows = db.all(sql, [ctx.userId, `%${q}%`]);",
              },
            ],
          },
        },
        {
          verdict: "confirmed" as const,
          fingerprint: "vuln-app:authz:notes-get",
          title: "Broken Object Level Authorization in Notes Lookup",
          description:
            "Missing tenant/ownership authorization check allows cross-user note retrieval",
          root_cause: "Direct lookup by id without owner check",
          trace: [
            {
              kind: "sink" as const,
              file: "fixtures/vulnerable-app/src/routes/notes.ts",
              line: 14,
              scope: "getNoteHandler",
              description: "Direct note return without checking ctx.userId == note.ownerId",
            },
          ],
          evidence: [
            {
              file: "fixtures/vulnerable-app/src/routes/notes.ts",
              line: 14,
              description: "sendJson(res, 200, note);",
            },
          ],
          severity: { overall_severity: "high" as const },
          confidence: { score: "high" as const },
          remediation: {
            strategy: "Verify that note.ownerId === ctx.userId before returning the note.",
            code_changes: [
              {
                file_name: "fixtures/vulnerable-app/src/routes/notes.ts",
                fixed_code:
                  "if (note.ownerId !== ctx.userId) { sendJson(res, 403, { error: 'Forbidden' }); return; }",
              },
            ],
          },
        },
      ];

      const ledger = [
        {
          unit_id: "fixtures/vulnerable-app/src/routes/search.ts:searchHandler",
          path: "fixtures/vulnerable-app/src/routes/search.ts",
          name: "searchHandler",
          canonical_refs: { attack_class: "injection" },
          result_fingerprints: ["vuln-app:sqli:notes-search"],
        },
        {
          unit_id: "fixtures/vulnerable-app/src/routes/notes.ts:getNoteHandler",
          path: "fixtures/vulnerable-app/src/routes/notes.ts",
          name: "getNoteHandler",
          canonical_refs: { attack_class: "authz" },
          result_fingerprints: ["vuln-app:authz:notes-get"],
        },
      ];

      const normalized = normalizeRun({
        findings: rawFindings as unknown as RawFinding[],
        ledger: ledger as unknown as LedgerUnit[],
        run: { id: "00000000-0000-4000-8000-000000000001" },
        project: { id: "00000000-0000-4000-8000-000000000010" },
        model: { adapter: "agent-cli:agy", model: "gemini-3.8-flash-high" },
        now,
      });

      expect(normalized).toHaveLength(2);
      expect(normalized[0]!.verdict).toBe("confirmed");
      expect(normalized[0]!.verifiedSeverity).toBe("critical");
      expect(normalized[1]!.verifiedSeverity).toBe("high");

      // Evaluate against production policy: enforce mode with confirmed:high threshold
      const strictPolicy: Policy = {
        id: "00000000-0000-4000-8000-000000000099",
        name: "Strict Production Policy",
        clientId: null,
        mode: "enforce",
        rules: [{ verdict: "confirmed", minSeverity: "high", attackClasses: [] }],
        slaDays: { critical: 7, high: 30, medium: 90, low: 180, informational: null },
        createdAt: now,
        updatedAt: now,
      };

      const gateResult = evaluateGate(strictPolicy, normalized, [], new Date());
      expect(gateResult.pass).toBe(false);
      expect(gateResult.violations).toHaveLength(2);
      expect(gateResult.violations.map((v) => v.severity)).toEqual(
        expect.arrayContaining(["critical", "high"]),
      );
    });
  });
});
