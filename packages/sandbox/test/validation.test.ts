import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SandboxValidationError } from "../src/errors.js";
import {
  hasControlCharacters,
  resolveHostMounts,
  validateSafePath,
  validateSandboxExecRequest,
  validateSandboxPolicy,
} from "../src/validation.js";

describe("Input Validation & Hardening", () => {
  describe("validateSafePath", () => {
    it("accepts absolute normalized paths", () => {
      expect(() => validateSafePath("/valid/path/to dir", "test")).not.toThrow();
    });

    it("rejects relative paths", () => {
      expect(() => validateSafePath("relative/path", "test")).toThrow(SandboxValidationError);
      expect(() => validateSafePath("./relative/path", "test")).toThrow(SandboxValidationError);
    });

    it("rejects '.' and '..' segments", () => {
      expect(() => validateSafePath("/valid/path/../escape", "test")).toThrow(
        SandboxValidationError,
      );
      expect(() => validateSafePath("/../root", "test")).toThrow(SandboxValidationError);
      expect(() => validateSafePath("/a/./b", "test")).toThrow(SandboxValidationError);
      expect(() => validateSafePath("/a/..", "test")).toThrow(SandboxValidationError);
    });

    it("rejects paths with control characters", () => {
      expect(() => validateSafePath("/valid/path\0/escape", "test")).toThrow(
        SandboxValidationError,
      );
      expect(() => validateSafePath("/valid/path\n/escape", "test")).toThrow(
        SandboxValidationError,
      );
    });

    it("rejects mount-spec metacharacters that could inject mount options", () => {
      // --mount type=bind,source=/x,readonly=false,... or -v /x:/etc:rw
      expect(() => validateSafePath("/tmp/x,readonly=false", "test")).toThrow(/metacharacters/);
      expect(() => validateSafePath("/tmp/x:/etc:rw", "test")).toThrow(/metacharacters/);
      expect(() => validateSafePath('/tmp/"x', "test")).toThrow(/metacharacters/);
    });

    it("rejects empty or non-string paths", () => {
      expect(() => validateSafePath("", "test")).toThrow(SandboxValidationError);
      // @ts-expect-error testing invalid type
      expect(() => validateSafePath(null, "test")).toThrow(SandboxValidationError);
    });
  });

  describe("hasControlCharacters", () => {
    it("detects null bytes and ASCII control characters", () => {
      expect(hasControlCharacters("normal-string_123")).toBe(false);
      expect(hasControlCharacters("string\0null")).toBe(true);
      expect(hasControlCharacters("string\nnewline")).toBe(true);
      expect(hasControlCharacters("string\rcarriage")).toBe(true);
      expect(hasControlCharacters("string\x1funit")).toBe(true);
      expect(hasControlCharacters("string\x7fdel")).toBe(true);
    });
  });

  describe("validateSandboxPolicy", () => {
    const validPolicy = {
      targetDir: "/host/target",
      outputDir: "/host/out",
      env: { SAFE_KEY: "value123", API_URL: "https://example.com" },
      cpus: 2,
      memoryMb: 1024,
      timeoutSec: 60,
      egressAllowlist: ["api.example.com", "localhost:8080"],
      readOnlyMounts: [{ hostPath: "/host/skill", containerPath: "/skill" }],
    };

    it("accepts valid policy and applies defaults", () => {
      const parsed = validateSandboxPolicy(validPolicy);
      expect(parsed.targetDir).toBe("/host/target");
      expect(parsed.outputDir).toBe("/host/out");
      expect(parsed.cpus).toBe(2);
      expect(parsed.memoryMb).toBe(1024);
      expect(parsed.timeoutSec).toBe(60);
      expect(parsed.env.SAFE_KEY).toBe("value123");

      const defaults = validateSandboxPolicy({ targetDir: "/a", outputDir: "/b" });
      expect(defaults.egressAllowlist).toEqual([]);
      expect(defaults.env).toEqual({});
    });

    it("rejects relative targetDir or outputDir", () => {
      expect(() => validateSandboxPolicy({ ...validPolicy, targetDir: "relative/target" })).toThrow(
        SandboxValidationError,
      );
      expect(() => validateSandboxPolicy({ ...validPolicy, outputDir: "relative/out" })).toThrow(
        SandboxValidationError,
      );
    });

    it("rejects path traversal and option injection in mounts", () => {
      expect(() =>
        validateSandboxPolicy({
          ...validPolicy,
          readOnlyMounts: [{ hostPath: "/safe/path/../escape", containerPath: "/mount" }],
        }),
      ).toThrow(SandboxValidationError);
      expect(() =>
        validateSandboxPolicy({
          ...validPolicy,
          readOnlyMounts: [{ hostPath: "/safe", containerPath: "/mount,readonly=false" }],
        }),
      ).toThrow(SandboxValidationError);
      expect(() =>
        validateSandboxPolicy({ ...validPolicy, targetDir: "/repo,target=/out" }),
      ).toThrow(SandboxValidationError);
    });

    it("rejects reserved and runner-owned container paths for mounts", () => {
      for (const containerPath of [
        "/proc",
        "/proc/sys",
        "/sys/fs",
        "/dev",
        "/",
        "/target",
        "/out",
        "/tmp",
        "/target/",
      ]) {
        expect(
          () =>
            validateSandboxPolicy({
              ...validPolicy,
              readOnlyMounts: [{ hostPath: "/safe/path", containerPath }],
            }),
          containerPath,
        ).toThrow(SandboxValidationError);
      }
    });

    it("rejects duplicate container mount paths", () => {
      expect(() =>
        validateSandboxPolicy({
          ...validPolicy,
          readOnlyMounts: [
            { hostPath: "/a", containerPath: "/skill" },
            { hostPath: "/b", containerPath: "/skill/" },
          ],
        }),
      ).toThrow(/duplicates/);
    });

    it("rejects invalid environment variable names", () => {
      for (const key of [
        "lower_case",
        "1_STARTS_WITH_NUMBER",
        "HAS-DASH",
        "HAS SPACE",
        "A=B",
        "",
        "LD_PRELOAD\0",
      ]) {
        expect(() => validateSandboxPolicy({ ...validPolicy, env: { [key]: "val" } }), key).toThrow(
          SandboxValidationError,
        );
      }
    });

    it("rejects env keys reserved for the egress proxy", () => {
      for (const key of ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY"]) {
        expect(() => validateSandboxPolicy({ ...validPolicy, env: { [key]: "x" } })).toThrow(
          /reserved/,
        );
      }
    });

    it("accepts valid environment variable names", () => {
      expect(() =>
        validateSandboxPolicy({
          ...validPolicy,
          env: { _PRIVATE: "1", ENV_VAR_123: "2", A: "3" },
        }),
      ).not.toThrow();
    });

    it("rejects control characters in env values", () => {
      expect(() =>
        validateSandboxPolicy({ ...validPolicy, env: { VALID_KEY: "line1\nline2" } }),
      ).toThrow(SandboxValidationError);
      expect(() => validateSandboxPolicy({ ...validPolicy, env: { VALID_KEY: "a\0b" } })).toThrow(
        SandboxValidationError,
      );
    });

    it("rejects invalid resources", () => {
      expect(() => validateSandboxPolicy({ ...validPolicy, cpus: -1 })).toThrow();
      expect(() => validateSandboxPolicy({ ...validPolicy, cpus: Infinity })).toThrow();
      expect(() => validateSandboxPolicy({ ...validPolicy, memoryMb: 0 })).toThrow();
      expect(() => validateSandboxPolicy({ ...validPolicy, memoryMb: 4 })).toThrow(/>= 6/);
      expect(() => validateSandboxPolicy({ ...validPolicy, timeoutSec: -10 })).toThrow();
      expect(() => validateSandboxPolicy({ ...validPolicy, timeoutSec: 1.5 })).toThrow();
    });

    it("rejects timeouts that would overflow setTimeout (fire immediately)", () => {
      expect(() => validateSandboxPolicy({ ...validPolicy, timeoutSec: 2_147_484 })).toThrow(
        /timeoutSec/,
      );
      expect(() => validateSandboxPolicy({ ...validPolicy, timeoutSec: 2_147_483 })).not.toThrow();
    });

    it("rejects malformed or over-broad egress allowlist entries", () => {
      for (const entry of [
        "evil.com allowed.com",
        "domain\0.com",
        "*",
        "*.com",
        "http://api.example.com",
        "api.example.com/path",
        "user@api.example.com",
        "api.*.com",
        "::1",
        "api.example.com:0",
        "api.example.com:99999",
        "2130706433",
        " api.example.com",
      ]) {
        expect(
          () => validateSandboxPolicy({ ...validPolicy, egressAllowlist: [entry] }),
          entry,
        ).toThrow(SandboxValidationError);
      }
    });

    it("accepts well-formed egress allowlist entries", () => {
      expect(() =>
        validateSandboxPolicy({
          ...validPolicy,
          egressAllowlist: [
            "api.anthropic.com",
            "API.OpenAI.com:443",
            "*.example.org",
            "10.0.0.5:8080",
            "[::1]:8080",
            "host.docker.internal:11434",
          ],
        }),
      ).not.toThrow();
    });
  });

  describe("validateSandboxExecRequest", () => {
    const policy = { targetDir: "/target", outputDir: "/out" };

    it("accepts valid request", () => {
      expect(() =>
        validateSandboxExecRequest({ argv: ["ls", "-la"], cwd: "/target", policy }),
      ).not.toThrow();
    });

    it("rejects empty argv or empty command", () => {
      expect(() => validateSandboxExecRequest({ argv: [], policy })).toThrow(
        SandboxValidationError,
      );
      expect(() => validateSandboxExecRequest({ argv: [""], policy })).toThrow(
        SandboxValidationError,
      );
    });

    it("rejects control characters and non-strings in argv", () => {
      expect(() => validateSandboxExecRequest({ argv: ["ls", "dir\0name"], policy })).toThrow(
        SandboxValidationError,
      );
      expect(() =>
        // @ts-expect-error testing invalid type
        validateSandboxExecRequest({ argv: ["ls", 42], policy }),
      ).toThrow(SandboxValidationError);
    });

    it("rejects relative or escaping cwd", () => {
      expect(() =>
        validateSandboxExecRequest({ argv: ["ls"], cwd: "relative/path", policy }),
      ).toThrow(SandboxValidationError);
      expect(() =>
        validateSandboxExecRequest({ argv: ["ls"], cwd: "/target/../etc", policy }),
      ).toThrow(SandboxValidationError);
    });
  });

  describe("resolveHostMounts (filesystem checks)", () => {
    const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "sdap-val-")));
    const target = path.join(base, "target");
    const env = {}; // no DOCKER_HOST

    beforeAll(() => {
      fs.mkdirSync(target);
      fs.mkdirSync(path.join(base, "skill"));
    });
    afterAll(() => fs.rmSync(base, { recursive: true, force: true }));

    const parse = (p: Parameters<typeof validateSandboxPolicy>[0]) => validateSandboxPolicy(p);

    it("resolves real paths, creates outputDir and reports it", () => {
      const out = path.join(base, "out-new");
      const m = resolveHostMounts(
        parse({
          targetDir: target,
          outputDir: out,
          readOnlyMounts: [{ hostPath: path.join(base, "skill"), containerPath: "/skill" }],
        }),
        env,
      );
      expect(m.target).toEqual({ hostPath: target, containerPath: "/target", readOnly: true });
      expect(m.output).toEqual({ hostPath: out, containerPath: "/out", readOnly: false });
      expect(m.extra[0]).toMatchObject({ containerPath: "/skill", readOnly: true });
      expect(m.outputCreated).toBe(true);
      expect(fs.statSync(out).isDirectory()).toBe(true);
    });

    it("rejects a missing targetDir", () => {
      expect(() =>
        resolveHostMounts(
          parse({ targetDir: path.join(base, "nope"), outputDir: path.join(base, "o1") }),
          env,
        ),
      ).toThrow(/does not exist/);
    });

    it("rejects outputDir equal to, inside, or containing targetDir", () => {
      for (const outputDir of [target, path.join(target, "out"), base]) {
        expect(() => resolveHostMounts(parse({ targetDir: target, outputDir }), env)).toThrow(
          /overlap/,
        );
      }
    });

    it("follows symlinks before checking (symlink to a sensitive path is refused)", () => {
      const link = path.join(base, "link-to-etc");
      fs.symlinkSync("/etc", link);
      expect(() =>
        resolveHostMounts(parse({ targetDir: link, outputDir: path.join(base, "o2") }), env),
      ).toThrow(/sensitive host path/);
      // A symlink pointing into the target makes outputDir overlap it.
      const outLink = path.join(base, "out-link");
      fs.symlinkSync(target, outLink);
      expect(() =>
        resolveHostMounts(parse({ targetDir: target, outputDir: outLink }), env),
      ).toThrow(/overlap/);
    });

    it("refuses the host root and sensitive host paths for any mount", () => {
      expect(() =>
        resolveHostMounts(parse({ targetDir: "/", outputDir: path.join(base, "o3") }), env),
      ).toThrow(/host root/);
      expect(() =>
        resolveHostMounts(
          parse({
            targetDir: target,
            outputDir: path.join(base, "o4"),
            readOnlyMounts: [{ hostPath: "/etc", containerPath: "/hostetc" }],
          }),
          env,
        ),
      ).toThrow(/sensitive/);
    });

    it("refuses mounting the container-engine socket or any parent of it", async () => {
      const sockDir = path.join(base, "engine");
      fs.mkdirSync(sockDir);
      const sockPath = path.join(sockDir, "engine.sock");
      const srv = net.createServer();
      await new Promise<void>((r) => srv.listen(sockPath, r));
      try {
        const dockerEnv = { DOCKER_HOST: `unix://${sockPath}` };
        for (const hostPath of [sockPath, sockDir]) {
          expect(() =>
            resolveHostMounts(
              parse({
                targetDir: target,
                outputDir: path.join(base, "o5"),
                readOnlyMounts: [{ hostPath, containerPath: "/x" }],
              }),
              dockerEnv,
            ),
          ).toThrow(/sensitive host path/);
        }
        // Even without DOCKER_HOST, a unix socket is never mountable.
        expect(() =>
          resolveHostMounts(
            parse({
              targetDir: target,
              outputDir: path.join(base, "o6"),
              readOnlyMounts: [{ hostPath: sockPath, containerPath: "/x" }],
            }),
            env,
          ),
        ).toThrow(/sockets/);
      } finally {
        await new Promise<void>((r) => srv.close(() => r()));
      }
    });
  });
});
