import { describe, expect, it } from "vitest";
import { SandboxValidationError } from "../src/errors.js";
import {
  hasControlCharacters,
  validateSafePath,
  validateSandboxExecRequest,
  validateSandboxPolicy,
} from "../src/validation.js";

describe("Input Validation & Hardening", () => {
  describe("validateSafePath", () => {
    it("accepts absolute normalized paths", () => {
      expect(() => validateSafePath("/valid/path/to/dir", "test")).not.toThrow();
    });

    it("rejects relative paths", () => {
      expect(() => validateSafePath("relative/path", "test")).toThrow(SandboxValidationError);
      expect(() => validateSafePath("./relative/path", "test")).toThrow(SandboxValidationError);
    });

    it("rejects path traversal segments ('..')", () => {
      expect(() => validateSafePath("/valid/path/../escape", "test")).toThrow(
        SandboxValidationError,
      );
      expect(() => validateSafePath("/../root", "test")).toThrow(SandboxValidationError);
    });

    it("rejects paths with control characters", () => {
      expect(() => validateSafePath("/valid/path\0/escape", "test")).toThrow(
        SandboxValidationError,
      );
      expect(() => validateSafePath("/valid/path\n/escape", "test")).toThrow(
        SandboxValidationError,
      );
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
    });

    it("rejects relative targetDir or outputDir", () => {
      expect(() => validateSandboxPolicy({ ...validPolicy, targetDir: "relative/target" })).toThrow(
        SandboxValidationError,
      );
      expect(() => validateSandboxPolicy({ ...validPolicy, outputDir: "relative/out" })).toThrow(
        SandboxValidationError,
      );
    });

    it("rejects path traversal in mounts", () => {
      expect(() =>
        validateSandboxPolicy({
          ...validPolicy,
          readOnlyMounts: [{ hostPath: "/safe/path/../escape", containerPath: "/mount" }],
        }),
      ).toThrow(SandboxValidationError);
    });

    it("rejects reserved container paths for mounts", () => {
      expect(() =>
        validateSandboxPolicy({
          ...validPolicy,
          readOnlyMounts: [{ hostPath: "/safe/path", containerPath: "/proc" }],
        }),
      ).toThrow(SandboxValidationError);
      expect(() =>
        validateSandboxPolicy({
          ...validPolicy,
          readOnlyMounts: [{ hostPath: "/safe/path", containerPath: "/" }],
        }),
      ).toThrow(SandboxValidationError);
    });

    it("rejects invalid environment variable names", () => {
      expect(() =>
        validateSandboxPolicy({
          ...validPolicy,
          env: { lower_case: "val" },
        }),
      ).toThrow(SandboxValidationError);
      expect(() =>
        validateSandboxPolicy({
          ...validPolicy,
          env: { "1_STARTS_WITH_NUMBER": "val" },
        }),
      ).toThrow(SandboxValidationError);
      expect(() =>
        validateSandboxPolicy({
          ...validPolicy,
          env: { "KE-Y": "val" },
        }),
      ).toThrow(SandboxValidationError);
      expect(() =>
        validateSandboxPolicy({
          ...validPolicy,
          env: { KEY$SPECIAL: "val" },
        }),
      ).toThrow(SandboxValidationError);
    });

    it("accepts valid environment variable names", () => {
      expect(() =>
        validateSandboxPolicy({
          ...validPolicy,
          env: {
            API_KEY: "val",
            _HIDDEN: "val",
            PORT_8080: "8080",
            CONFIG_A_B_C: "true",
          },
        }),
      ).not.toThrow();
    });

    it("rejects control characters in env values", () => {
      expect(() =>
        validateSandboxPolicy({
          ...validPolicy,
          env: { INJECTION: "hello\x00world" },
        }),
      ).toThrow(SandboxValidationError);
      expect(() =>
        validateSandboxPolicy({
          ...validPolicy,
          env: { INJECTION: "line1\nline2" },
        }),
      ).toThrow(SandboxValidationError);
    });

    it("rejects invalid resources", () => {
      expect(() => validateSandboxPolicy({ ...validPolicy, cpus: 0 })).toThrow(
        SandboxValidationError,
      );
      expect(() => validateSandboxPolicy({ ...validPolicy, memoryMb: -100 })).toThrow(
        SandboxValidationError,
      );
      expect(() => validateSandboxPolicy({ ...validPolicy, timeoutSec: 0 })).toThrow(
        SandboxValidationError,
      );
    });

    it("rejects whitespace or control characters in egress allowlist", () => {
      expect(() =>
        validateSandboxPolicy({
          ...validPolicy,
          egressAllowlist: ["host with space.com"],
        }),
      ).toThrow(SandboxValidationError);
      expect(() =>
        validateSandboxPolicy({
          ...validPolicy,
          egressAllowlist: ["host\0null.com"],
        }),
      ).toThrow(SandboxValidationError);
    });
  });

  describe("validateSandboxExecRequest", () => {
    const validPolicy = {
      targetDir: "/host/target",
      outputDir: "/host/out",
    };

    it("accepts valid request", () => {
      expect(() =>
        validateSandboxExecRequest({
          argv: ["echo", "hello world", "--flag=value"],
          policy: validPolicy,
          cwd: "/target/sub",
        }),
      ).not.toThrow();
    });

    it("rejects empty argv", () => {
      expect(() =>
        validateSandboxExecRequest({
          argv: [],
          policy: validPolicy,
        }),
      ).toThrow(SandboxValidationError);
    });

    it("rejects control characters in argv", () => {
      expect(() =>
        validateSandboxExecRequest({
          argv: ["sh", "-c", "echo hello\x00injection"],
          policy: validPolicy,
        }),
      ).toThrow(SandboxValidationError);
      expect(() =>
        validateSandboxExecRequest({
          argv: ["cat", "file\nname"],
          policy: validPolicy,
        }),
      ).toThrow(SandboxValidationError);
    });

    it("rejects relative or escaping cwd", () => {
      expect(() =>
        validateSandboxExecRequest({
          argv: ["ls"],
          policy: validPolicy,
          cwd: "relative/dir",
        }),
      ).toThrow(SandboxValidationError);
      expect(() =>
        validateSandboxExecRequest({
          argv: ["ls"],
          policy: validPolicy,
          cwd: "/target/../escape",
        }),
      ).toThrow(SandboxValidationError);
    });
  });
});
