// INTENTIONALLY VULNERABLE TEST FIXTURE - do not deploy
// Safe helper used by the escaped-output look-alike (render-safe.ts).

const ENTITIES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export const escapeHtml = (text: string): string => text.replace(/[&<>"']/g, (c) => ENTITIES[c] ?? c);
