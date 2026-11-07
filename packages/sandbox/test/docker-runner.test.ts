import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DockerSandboxRunner } from "../src/docker-runner.js";

describe("DockerSandboxRunner", () => {
  const tmpBase = fs.realpathSync(os.tmpdir());
  const testTargetDir = path.join(tmpBase, "sdap-test-target-" + Date.now());
  const testOutputDir = path.join(tmpBase, "sdap-test-out-" + Date.now());

  beforeAll(() => {
    fs.mkdirSync(testTargetDir, { recursive: true });
    fs.mkdirSync(testOutputDir, { recursive: true });
    fs.writeFileSync(path.join(testTargetDir, "code.js"), "console.log('target code');");
  });

  afterAll(() => {
    try {
      fs.rmSync(testTargetDir, { recursive: true, force: true });
      fs.rmSync(testOutputDir, { recursive: true, force: true });
    } catch {
      // Best effort cleanup
    }
  });

  describe("Argv construction (always runs)", () => {
    const runner = new DockerSandboxRunner({
      user: "1000:1000",
      pidsLimit: 128,
    });

    it("constructs hardened argv with network none when allowlist is empty", () => {
      const argv = runner.buildDockerArgv(
        {
          argv: ["echo", "hello"],
          policy: {
            targetDir: testTargetDir,
            outputDir: testOutputDir,
            cpus: 1,
            memoryMb: 512,
            timeoutSec: 30,
            env: { MY_ENV: "val" },
          },
        },
        "test-container",
      );

      expect(argv).toContain("run");
      expect(argv).toContain("--read-only");
      expect(argv).toContain("--cap-drop");
      expect(argv).toContain("ALL");
      expect(argv).toContain("--security-opt");
      expect(argv).toContain("no-new-privileges");
      expect(argv).toContain("--network");
      expect(argv).toContain("none");
      expect(argv).toContain("--tmpfs");
      expect(argv).toContain("/tmp:rw,noexec,nosuid,size=64m");
      expect(argv).toContain("--pids-limit");
      expect(argv).toContain("128");
      expect(argv).toContain("--cpus");
      expect(argv).toContain("1");
      expect(argv).toContain("--memory");
      expect(argv).toContain("512m");
      expect(argv).toContain("--user");
      expect(argv).toContain("1000:1000");
      expect(argv).toContain("-e");
      expect(argv).toContain("MY_ENV=val");
      expect(argv).toContain("echo");
      expect(argv).toContain("hello");
    });

    it("constructs proxy flags and --add-host when egress proxy port is provided", () => {
      const argv = runner.buildDockerArgv(
        {
          argv: ["curl", "https://api.example.com"],
          policy: {
            targetDir: testTargetDir,
            outputDir: testOutputDir,
            egressAllowlist: ["api.example.com"],
          },
        },
        "test-container",
        8888,
      );

      expect(argv).toContain("--add-host");
      expect(argv).toContain("host.docker.internal:host-gateway");
      expect(argv).toContain("-e");
      expect(argv).toContain("HTTP_PROXY=http://host.docker.internal:8888");
      expect(argv).toContain("HTTPS_PROXY=http://host.docker.internal:8888");
      expect(argv).not.toContain("none");
    });

    it("identifies kind correctly based on runtime", () => {
      const defaultRunner = new DockerSandboxRunner();
      expect(defaultRunner.kind).toBe("docker-hardened");
      expect(defaultRunner.enforcing).toBe(true);

      const gvisorRunner = new DockerSandboxRunner({ runtime: "runsc" });
      expect(gvisorRunner.kind).toBe("gvisor");
      expect(gvisorRunner.enforcing).toBe(true);

      const argv = gvisorRunner.buildDockerArgv(
        {
          argv: ["echo", "gvisor"],
          policy: {
            targetDir: testTargetDir,
            outputDir: testOutputDir,
          },
        },
        "gvisor-container",
      );
      expect(argv).toContain("--runtime");
      expect(argv).toContain("runsc");
    });

    it("applies seccomp profile argument when seccomp file exists", () => {
      const seccompPath = path.resolve(__dirname, "../../../deploy/sandbox/seccomp.json");
      const seccompRunner = new DockerSandboxRunner({
        seccompProfile: seccompPath,
      });
      const argv = seccompRunner.buildDockerArgv(
        {
          argv: ["echo", "seccomp"],
          policy: {
            targetDir: testTargetDir,
            outputDir: testOutputDir,
          },
        },
        "seccomp-container",
      );
      expect(argv).toContain("--security-opt");
      expect(argv).toContain(`seccomp=${seccompPath}`);
    });

    it("preflight returns error when docker binary does not exist", async () => {
      const brokenRunner = new DockerSandboxRunner({
        dockerPath: "nonexistent-docker-binary-xyz",
      });
      const result = await brokenRunner.preflight();
      expect(result.ok).toBe(false);
      expect(result.message).toContain("Docker daemon unreachable or docker CLI failed");
    });

    it("preflight validates policy when provided", async () => {
      const runner = new DockerSandboxRunner();
      const invalidResult = await runner.preflight({
        targetDir: "relative/path",
        outputDir: testOutputDir,
      });
      expect(invalidResult.ok).toBe(false);
      expect(invalidResult.message).toContain("targetDir must be an absolute path");
    });
  });

  describe("Docker live integration tests", () => {
    let dockerAvailable = false;
    let runscAvailable = false;
    let localHttpServer: http.Server;
    let localHttpPort: number;

    const liveRunner = new DockerSandboxRunner({
      image: "alpine:3.22",
    });

    beforeAll(async () => {
      // Check docker preflight
      const preflight = await liveRunner.preflight();
      dockerAvailable = preflight.ok;

      if (dockerAvailable) {
        // Check if runsc is available
        const gvisorRunner = new DockerSandboxRunner({ runtime: "runsc" });
        const gvPreflight = await gvisorRunner.preflight();
        runscAvailable = gvPreflight.ok;

        // Start a local test HTTP server on host
        localHttpServer = http.createServer((req, res) => {
          if (req.url === "/allowed") {
            res.writeHead(200, { "Content-Type": "text/plain" });
            res.end("server-allowed-response");
          } else {
            res.writeHead(404);
            res.end("not-found");
          }
        });

        await new Promise<void>((resolve) => {
          localHttpServer.listen(0, "0.0.0.0", () => {
            const addr = localHttpServer.address();
            if (addr && typeof addr === "object") {
              localHttpPort = addr.port;
            }
            resolve();
          });
        });
      }
    });

    afterAll(async () => {
      if (localHttpServer) {
        await new Promise<void>((resolve) => localHttpServer.close(() => resolve()));
      }
    });

    it("preflight succeeds on reachable Docker daemon", async () => {
      if (!dockerAvailable) {
        console.warn("Docker daemon not reachable; skipping live preflight test");
        return;
      }
      const preflight = await liveRunner.preflight();
      expect(preflight.ok).toBe(true);
      expect(preflight.message).toBeNull();
    });

    // Acceptance criterion 1: Egress is blocked
    it("proves egress is blocked when egressAllowlist is empty", async () => {
      if (!dockerAvailable) {
        console.warn("Docker daemon not reachable; skipping test");
        return;
      }

      // Container should have no route to host/internet
      const result = await liveRunner.exec({
        argv: ["wget", "-T", "1", "-qO-", "http://1.1.1.1"],
        policy: {
          targetDir: testTargetDir,
          outputDir: testOutputDir,
          timeoutSec: 10,
        },
      });

      expect(result.exitCode).not.toBe(0);
    });

    it("allows egress to allowlisted host through proxy and blocks non-allowlisted", async () => {
      if (!dockerAvailable) {
        console.warn("Docker daemon not reachable; skipping test");
        return;
      }

      // With host.docker.internal in allowlist:
      const allowedResult = await liveRunner.exec({
        argv: ["wget", "-T", "5", "-qO-", `http://host.docker.internal:${localHttpPort}/allowed`],
        policy: {
          targetDir: testTargetDir,
          outputDir: testOutputDir,
          egressAllowlist: ["host.docker.internal"],
          timeoutSec: 15,
        },
      });

      expect(allowedResult.exitCode).toBe(0);
      expect(allowedResult.stdout).toContain("server-allowed-response");

      // With a different host in allowlist: request to host.docker.internal should be refused by proxy (403)
      const blockedResult = await liveRunner.exec({
        argv: ["wget", "-T", "5", "-qO-", `http://host.docker.internal:${localHttpPort}/allowed`],
        policy: {
          targetDir: testTargetDir,
          outputDir: testOutputDir,
          egressAllowlist: ["different.allowed.domain"],
          timeoutSec: 15,
        },
      });

      expect(blockedResult.exitCode).not.toBe(0);
      expect(blockedResult.stderr).toContain("403");
    });

    // Acceptance criterion 2: Writes outside output dir fail
    it("proves writes outside /out fail and writes to /out succeed", async () => {
      if (!dockerAvailable) {
        console.warn("Docker daemon not reachable; skipping test");
        return;
      }

      // 1. Writing to /target must fail
      const targetWrite = await liveRunner.exec({
        argv: ["touch", "/target/forbidden.txt"],
        policy: {
          targetDir: testTargetDir,
          outputDir: testOutputDir,
        },
      });
      expect(targetWrite.exitCode).not.toBe(0);
      expect(targetWrite.stderr.toLowerCase()).toContain("read-only file system");

      // 2. Writing to / or /etc must fail
      const rootWrite = await liveRunner.exec({
        argv: ["touch", "/etc/forbidden.txt"],
        policy: {
          targetDir: testTargetDir,
          outputDir: testOutputDir,
        },
      });
      expect(rootWrite.exitCode).not.toBe(0);
      expect(rootWrite.stderr.toLowerCase()).toContain("read-only file system");

      // 3. Writing to /out must succeed and appear on host
      const outFilename = `result-${Date.now()}.json`;
      const outWrite = await liveRunner.exec({
        argv: ["sh", "-c", `echo '{"audit":"confirmed"}' > /out/${outFilename}`],
        policy: {
          targetDir: testTargetDir,
          outputDir: testOutputDir,
        },
      });
      expect(outWrite.exitCode).toBe(0);

      const hostFilePath = path.join(testOutputDir, outFilename);
      expect(fs.existsSync(hostFilePath)).toBe(true);
      const content = fs.readFileSync(hostFilePath, "utf8").trim();
      expect(content).toBe('{"audit":"confirmed"}');

      // 4. Writing to /tmp must succeed (tmpfs) and not exist on host
      const tmpWrite = await liveRunner.exec({
        argv: ["sh", "-c", "echo 'temp' > /tmp/temp.txt"],
        policy: {
          targetDir: testTargetDir,
          outputDir: testOutputDir,
        },
      });
      expect(tmpWrite.exitCode).toBe(0);
    });

    // Acceptance criterion 3: Host environment sanitization
    it("proves host env vars are not visible inside container", async () => {
      if (!dockerAvailable) {
        console.warn("Docker daemon not reachable; skipping test");
        return;
      }

      process.env.LEAK_TEST_SECRET = "super_confidential_token";

      const result = await liveRunner.exec({
        argv: ["sh", "-c", "env"],
        policy: {
          targetDir: testTargetDir,
          outputDir: testOutputDir,
          env: {
            SANITIZED_ALLOWED: "ok_val",
          },
        },
      });

      delete process.env.LEAK_TEST_SECRET;

      expect(result.exitCode).toBe(0);
      expect(result.stdout).not.toContain("super_confidential_token");
      expect(result.stdout).not.toContain("LEAK_TEST_SECRET");
      expect(result.stdout).toContain("SANITIZED_ALLOWED=ok_val");
    });

    // Acceptance criterion 4: Timeout kill
    it("terminates container on timeout and sets killedBy=timeout", async () => {
      if (!dockerAvailable) {
        console.warn("Docker daemon not reachable; skipping test");
        return;
      }

      const result = await liveRunner.exec({
        argv: ["sleep", "10"],
        policy: {
          targetDir: testTargetDir,
          outputDir: testOutputDir,
          timeoutSec: 1,
        },
      });

      expect(result.killedBy).toBe("timeout");
    });

    // Acceptance criterion 5: Memory limit (OOM)
    it("kills container and flags OOM when memory limit is exceeded", async () => {
      if (!dockerAvailable) {
        console.warn("Docker daemon not reachable; skipping test");
        return;
      }

      const lowMemRunner = new DockerSandboxRunner({
        image: "alpine:3.22",
      });

      const result = await lowMemRunner.exec({
        argv: ["sh", "-c", 'a="x"; while true; do a="$a$a$a$a$a$a$a$a$a$a"; done'],
        policy: {
          targetDir: testTargetDir,
          outputDir: testOutputDir,
          memoryMb: 16,
          timeoutSec: 10,
        },
      });

      expect(result.exitCode).not.toBe(0);
      // Either OOM killed or killed by container manager
      expect(result.killedBy === "oom" || result.exitCode === 137).toBe(true);
    });

    // gVisor test (skips cleanly if not available)
    it("runs with gVisor when runsc runtime is available, or skips cleanly", async () => {
      if (!dockerAvailable || !runscAvailable) {
        console.warn("gVisor (runsc) is not available; skipping gVisor live test");
        return;
      }

      const gvisorRunner = new DockerSandboxRunner({
        runtime: "runsc",
        image: "alpine:3.22",
      });

      expect(gvisorRunner.kind).toBe("gvisor");

      const result = await gvisorRunner.exec({
        argv: ["echo", "gvisor-active"],
        policy: {
          targetDir: testTargetDir,
          outputDir: testOutputDir,
          timeoutSec: 10,
        },
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("gvisor-active");
    });
  });
});
