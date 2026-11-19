import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

export interface PrepareTargetOptions {
  repoUrl: string;
  /** Branch, tag or commit to audit. */
  ref: string;
  /** Exact commit to check out when already known (a re-run of the same revision). */
  commitSha?: string | null;
  /** Empty or missing directory the source is fetched into. */
  dir: string;
  /** Access token for private repositories; sent only to `tokenHost`. */
  token?: string;
  tokenHost?: string;
  /** Tests only: allow local paths and file:// URLs. */
  allowLocal?: boolean;
  timeoutMs?: number;
}

export class TargetError extends Error {}

const SCP_LIKE = /^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+:[^\s]+$/;

/** Only network git transports are accepted: a repo URL must never read local files or run helpers. */
export function checkRepoUrl(url: string, allowLocal = false): { host: string | null } {
  const u = url.trim();
  if (!u || u.startsWith("-") || /[\s\0]/.test(u)) throw new TargetError("Invalid repository URL");
  if (/^(https?|ssh|git):\/\//i.test(u)) {
    try {
      return { host: new URL(u).hostname.toLowerCase() };
    } catch {
      throw new TargetError("Invalid repository URL");
    }
  }
  if (SCP_LIKE.test(u)) return { host: u.split("@")[1]!.split(":")[0]!.toLowerCase() };
  if (allowLocal) return { host: null };
  throw new TargetError("Repository URL must use https, ssh or git; local paths are not allowed");
}

/**
 * Fetches exactly one revision of a repository into `dir` and returns the commit that was
 * checked out. Hooks and credential prompts are off, local transports are refused, and a token
 * travels in the environment (never argv or the repo config) and only to its own host.
 */
export async function prepareTarget(opts: PrepareTargetOptions): Promise<{ commitSha: string }> {
  const { host } = checkRepoUrl(opts.repoUrl, opts.allowLocal);
  await fs.mkdir(opts.dir, { recursive: true });

  const env: NodeJS.ProcessEnv = {
    PATH: process.env["PATH"],
    HOME: opts.dir,
    GIT_TERMINAL_PROMPT: "0",
    GIT_ASKPASS: "echo",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    ...(process.env["GIT_SSH_COMMAND"] ? { GIT_SSH_COMMAND: process.env["GIT_SSH_COMMAND"] } : {}),
  };
  const tokenHost = (opts.tokenHost ?? "github.com").toLowerCase();
  if (opts.token && host === tokenHost && /^https:/i.test(opts.repoUrl)) {
    const basic = Buffer.from(`x-access-token:${opts.token}`).toString("base64");
    env["GIT_CONFIG_COUNT"] = "1";
    env["GIT_CONFIG_KEY_0"] = "http.extraHeader";
    env["GIT_CONFIG_VALUE_0"] = `Authorization: Basic ${basic}`;
  }

  const protocols = opts.allowLocal
    ? ["-c", "protocol.file.allow=always"]
    : [
        "-c",
        "protocol.allow=never",
        "-c",
        "protocol.https.allow=always",
        "-c",
        "protocol.ssh.allow=always",
        "-c",
        "protocol.git.allow=always",
      ];
  const base = ["-c", "core.hooksPath=/dev/null", ...protocols];
  const git = async (args: string[]) => {
    try {
      return (
        await run("git", [...base, ...args], {
          cwd: opts.dir,
          env,
          timeout: opts.timeoutMs ?? 10 * 60_000,
          maxBuffer: 4 * 1024 * 1024,
        })
      ).stdout;
    } catch (err) {
      const e = err as { stderr?: string; message: string };
      // Never echo the command line: it could contain a URL with credentials.
      throw new TargetError(
        `git ${args[0]} failed: ${(e.stderr || e.message).split("\n").slice(0, 3).join(" ").slice(0, 300)}`,
      );
    }
  };

  await git(["init", "-q"]);
  await git(["remote", "add", "origin", opts.repoUrl.trim()]);
  const wanted = opts.commitSha || opts.ref;
  if (!wanted || wanted.startsWith("-")) throw new TargetError("Invalid ref");
  await git(["fetch", "-q", "--depth", "1", "--no-tags", "origin", wanted]);
  await git(["checkout", "-q", "--detach", "FETCH_HEAD"]);
  const commitSha = (await git(["rev-parse", "HEAD"])).trim();
  return { commitSha };
}

export const targetDirFor = (baseDir: string, runId: string): string =>
  path.join(baseDir, "targets", runId);
