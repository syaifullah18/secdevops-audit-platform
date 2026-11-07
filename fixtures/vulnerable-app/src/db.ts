// INTENTIONALLY VULNERABLE TEST FIXTURE - do not deploy
// In-memory stand-in for a SQL database. It understands just enough SQL (WHERE with
// owner_id / title LIKE, literal or bound, plus a classic OR tautology) so that string-built
// queries visibly behave like injectable ones and bound parameters do not.
import type { NoteRow } from "./types.js";

const NOTES: readonly NoteRow[] = [
  { id: 1, ownerId: "user-a", title: "groceries", body: "milk, eggs", attachment: "groceries.txt" },
  { id: 2, ownerId: "user-a", title: "ideas", body: "fixture idea list", attachment: null },
  { id: 3, ownerId: "user-b", title: "private plans", body: "fixture secret plans", attachment: null },
];

type Param = string | number;

export class NotesDb {
  /** Every statement executed, so tests can inspect what reached the database. */
  readonly executed: string[] = [];

  all(sql: string, params: readonly Param[] = []): NoteRow[] {
    this.executed.push(sql);
    const statement = sql.replace(/--.*$/, "");
    const where = /\bWHERE\s+(.+?)(?:\s+ORDER BY\s+.+)?\s*$/i.exec(statement)?.[1];
    if (where === undefined) return [...NOTES];
    if (/\bOR\s+(?:'1'\s*=\s*'1'|1\s*=\s*1)/i.test(where)) return [...NOTES];

    let next = 0;
    const value = (token: string): string => {
      if (token === "?") return String(params[next++] ?? "");
      return token.replace(/^'|'$/g, "");
    };
    const conditions = where.split(/\s+AND\s+/i).map((cond) => {
      const owner = /^owner_id\s*=\s*(\?|'[^']*')$/i.exec(cond.trim());
      if (owner?.[1] !== undefined) return { column: "ownerId" as const, like: false, v: value(owner[1]) };
      const title = /^title\s+LIKE\s+(\?|'[^']*')$/i.exec(cond.trim());
      if (title?.[1] !== undefined) return { column: "title" as const, like: true, v: value(title[1]) };
      return null;
    });
    return NOTES.filter((row) =>
      conditions.every((c) => {
        if (c === null) return false;
        if (!c.like) return row[c.column] === c.v;
        return row[c.column].includes(c.v.replace(/%/g, ""));
      }),
    );
  }

  get(id: number): NoteRow | undefined {
    return NOTES.find((n) => n.id === id);
  }
}

export const db = new NotesDb();
