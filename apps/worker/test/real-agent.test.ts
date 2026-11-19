import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AgentCliAdapter, parseClaudeJson } from "../src/agent-adapter.js";
import { checkRepoUrl, prepareTarget, TargetError } from "../src/target.js";
import { FakeSandboxRunner } from "./fakes.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fakeClaude = path.join(here, "fixtures/fake-claude.cjs");

describe("claude CLI adapter", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "sdap-agent-"));
    process.env["ANTHROPIC_API_KEY"] = "sk-test";
  });
  afterEach(async () => {
    delete process.env["ANTHROPIC_API_KEY"];
    await fs.rm(dir, { recursive: true, force: true });
  });

  const adapter = () =>
    new AgentCliAdapter({
      id: "agent-cli:claude",
      command: fakeClaude,
      sandboxRunner: new FakeSandboxRunner(),
    });
  const req = (prompt: string) => ({
    task: "hunt" as const,
    model: "claude-opus-5-5",
    messages: [{ role: "user" as const, content: prompt }],
    maxOutputTokens: 1000,
    metadata: { targetDir: dir, outputDir: dir, skillDir: "/skill-dir" },
  });

  it("runs headless with file tools only, the API key and real usage", async () => {
    const out = await adapter().generate(req("hello"));
    const seen = JSON.parse(out.text) as { args: string[]; key: string | null };
    expect(seen.args).toEqual(expect.arrayContaining(["-p", "hello", "--output-format", "json"]));
    expect(seen.args[seen.args.indexOf("--allowedTools") + 1]).toBe("Read,Grep,Glob,Write,Edit");
    expect(seen.args).toContain("--add-dir");
    expect(seen.key).toBe("sk-test");
    // Tokens and cost come from the CLI's own report, including cached input.
    expect(out.usage).toEqual({ inputTokens: 123, outputTokens: 45, costUsd: 0.5 });
  });

  it("turns an error result into a typed model error", async () => {
    await expect(adapter().generate(req("FAIL"))).rejects.toMatchObject({ code: "quota_exceeded" });
  });

  it("parseClaudeJson ignores non-JSON output", () => {
    expect(parseClaudeJson("plain text")).toBeNull();
  });
});

describe("repository checkout", () => {
  it("accepts network git URLs and refuses local paths and option-like input", () => {
    expect(checkRepoUrl("https://github.com/org/repo.git").host).toBe("github.com");
    expect(checkRepoUrl("git@github.com:org/repo.git").host).toBe("github.com");
    for (const bad of ["/etc", "file:///etc", "../x", "--upload-pack=x", "ext::sh -c id", ""]) {
      expect(() => checkRepoUrl(bad), bad).toThrow(TargetError);
    }
  });

  it("fetches one revision and reports its commit", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "sdap-git-"));
    const src = path.join(root, "src");
    await fs.mkdir(src);
    const g = (...a: string[]) =>
      execFileSync("git", ["-C", src, "-c", "user.name=t", "-c", "user.email=t@t", ...a]);
    g("init", "-q", "-b", "main");
    await fs.writeFile(path.join(src, "app.ts"), "export const x = 1;\n");
    g("add", ".");
    g("commit", "-q", "-m", "init");
    const head = g("rev-parse", "HEAD").toString().trim();

    const dest = path.join(root, "dest");
    const { commitSha } = await prepareTarget({
      repoUrl: src,
      ref: "main",
      dir: dest,
      allowLocal: true,
    });
    expect(commitSha).toBe(head);
    expect(await fs.readFile(path.join(dest, "app.ts"), "utf8")).toContain("x = 1");

    await expect(
      prepareTarget({ repoUrl: src, ref: "nope", dir: path.join(root, "d2"), allowLocal: true }),
    ).rejects.toThrow(TargetError);
    // Without the test switch a local path is refused before git runs.
    await expect(
      prepareTarget({ repoUrl: src, ref: "main", dir: path.join(root, "d3") }),
    ).rejects.toThrow(/local paths/);
    await fs.rm(root, { recursive: true, force: true });
  });
});
