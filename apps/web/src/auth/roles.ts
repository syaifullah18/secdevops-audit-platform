import type { Role } from "@sdap/core";

export const ALL_ROLES: Role[] = ["admin", "security", "devops", "developer", "viewer"];

export const ROLE_HELP: Record<Role, string> = {
  admin: "Manage users, invitations and every client.",
  security: "Triage findings, approve exceptions and edit policy.",
  devops: "Trigger and cancel audit runs.",
  developer: "View and triage findings for the own team.",
  viewer: "Read-only access.",
};

export const scopeLabel = (c: string[] | "*"): string =>
  c === "*" ? "All clients" : c.length === 0 ? "No clients" : c.join(", ");

/** Parses "a, b" into client ids; `*` anywhere means every client. */
export const parseScope = (raw: string): string[] | "*" => {
  const ids = raw
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return ids.includes("*") ? "*" : ids;
};
