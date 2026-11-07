import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import type net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DockerSandboxRunner, type DockerSandboxRunnerOptions } from "../src/docker-runner.js";
import { SandboxValidationError } from "../src/errors.js";
import { resolveHostMounts, validateSandboxExecRequest } from "../src/validation.js";
import type { SandboxExecRequest } from "@sdap/core";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const SECCOMP = path.join(REPO_ROOT, "deploy/sandbox/seccomp.json");
const PROXY_DIR = path.join(REPO_ROOT, "deploy/sandbox/egress-proxy");
const PROXY_IMAGE = "sdap-egress-proxy:latest";

/**
 * Environment for the docker CLI. If DOCKER_HOST is unset but a Podman machine is running,
 * point the CLI at its Docker-compatible socket so the live tests can run locally.
 */
function detectDockerEnv(): NodeJS.ProcessEnv {
  if (process.env.DOCKER_HOST) return process.env;
  try {
    const sock = execFileSync(
      "podman",
      ["machine", "inspect", "--format", "{{.ConnectionInfo.PodmanSocket.Path}}"],
      { encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
    if (sock && fs.existsSync(sock)) return { ...process.env, DOCKER_HOST: `unix://${sock}` };
  } catch {
    // no podman machine
  }
  return process.env;
}

const dockerEnv = detectDockerEnv();
const opts = (o: DockerSandboxRunnerOptions = {}): DockerSandboxRunnerOptions => ({
  dockerEnv,
  egressProxyImage: PROXY_IMAGE,
  ...o,
});

const livePreflight = await new DockerSandboxRunner(opts()).preflight();
const dockerOk = livePreflight.ok;
if (!dockerOk) {
  console.warn(
    `[sandbox tests] Docker/Podman not usable (${livePreflight.message}); ` +
      "SKIPPING live container tests. Set DOCKER_HOST and pull alpine:3.22 to run them.",
  );
}

let proxyImageOk = false;
if (dockerOk) {
  try {
    execFileSync("docker", ["build", "-q", "-t", PROXY_IMAGE, PROXY_DIR], {
      env: dockerEnv,
      timeout: 180_000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    proxyImageOk = true;
  } catch (err) {
    console.warn(
      `[sandbox tests] could not build ${PROXY_IMAGE} (${String(err).slice(0, 200)}); ` +
        "SKIPPING allowlisted-egress live tests.",
    );
  }
}

let podmanCliOk = false;
try {
  execFileSync("podman", ["image", "exists", "alpine:3.22"], { timeout: 10_000, stdio: "ignore" });
  podmanCliOk = true;
} catch {
  // podman CLI not available
}

/** Whether the host itself can reach a public site (for the optional public-egress test). */
async function hostHasInternet(): Promise<boolean> {
  try {
    const res = await fetch("http://example.com/", { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}
const internetOk = dockerOk && proxyImageOk && (await hostHasInternet());

function expectPair(argv: string[], flag: string, value: string): void {
  const found = argv.some((a, i) => a === flag && argv[i + 1] === value);
  expect(found, `${flag} ${value} in ${JSON.stringify(argv)}`).toBe(true);
}

describe("DockerSandboxRunner", () => {
  const tmpBase = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "sdap-docker-")));
  const targetDir = path.join(tmpBase, "target");
  const skillDir = path.join(tmpBase, "skill");
  let outCounter = 0;
  /** A fresh, not-yet-existing output dir (the runner creates it and makes it writable). */
  const freshOut = () => path.join(tmpBase, `out-${++outCounter}`);

  beforeAll(() => {
    fs.mkdirSync(targetDir, { recursive: true });
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(targetDir, "code.js"), "console.log('target code');");
    fs.writeFileSync(path.join(skillDir, "SKILL.md"), "skill-content");
  });

  afterAll(() => {
    fs.rmSync(tmpBase, { recursive: true, force: true });
  });

  describe("argv construction and option validation (always runs)", () => {
    const runner = new DockerSandboxRunner({ user: "1000:1000", pidsLimit: 128 });

    function build(req: SandboxExecRequest, egress?: { network: string; proxyUrl: string }) {
      const policy = validateSandboxExecRequest(req);
      const mounts = resolveHostMounts(policy, {});
      return runner.buildDockerArgv(req, policy, mounts, "test-container", egress);
    }

    it("constructs hardened argv with --network none when the allowlist is empty", () => {
      const argv = build({
        argv: ["echo", "hello"],
        policy: {
          targetDir,
          outputDir: freshOut(),
          cpus: 1,
          memoryMb: 512,
          timeoutSec: 30,
          env: { MY_ENV: "val" },
        },
      });

      expect(argv[0]).toBe("run");
      expect(argv).toContain("--read-only");
      expect(argv).toContain("--init");
      expectPair(argv, "--cap-drop", "ALL");
      expectPair(argv, "--security-opt", "no-new-privileges");
      expectPair(argv, "--network", "none");
      expectPair(argv, "--pull", "never");
      expectPair(argv, "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,size=64m");
      expectPair(argv, "--pids-limit", "128");
      expectPair(argv, "--cpus", "1");
      expectPair(argv, "--memory", "512m");
      expectPair(argv, "--memory-swap", "512m");
      expectPair(argv, "--user", "1000:1000");
      expectPair(argv, "--workdir", "/target");
      expectPair(argv, "--env", "MY_ENV=val");
      expect(argv.slice(-3)).toEqual(["alpine:3.22", "echo", "hello"]);
      expect(argv.some((a) => a.includes("PROXY"))).toBe(false);
    });

    it("mounts target read-only, output read-write and extra mounts read-only via --mount", () => {
      const out = freshOut();
      const argv = build({
        argv: ["true"],
        policy: {
          targetDir,
          outputDir: out,
          readOnlyMounts: [{ hostPath: skillDir, containerPath: "/skill" }],
        },
      });
      expectPair(argv, "--mount", `type=bind,source=${targetDir},target=/target,readonly`);
      expectPair(argv, "--mount", `type=bind,source=${out},target=/out`);
      expectPair(argv, "--mount", `type=bind,source=${skillDir},target=/skill,readonly`);
      expect(argv).not.toContain("-v");
    });

    it("never emits a bare --env KEY (which would copy the docker CLI's own env)", () => {
      const argv = build({
        argv: ["env"],
        policy: { targetDir, outputDir: freshOut(), env: { A: "1", B: "" } },
      });
      const envArgs = argv.filter((_, i) => argv[i - 1] === "--env");
      expect(envArgs).toEqual(["A=1", "B="]);
    });

    it("keeps request argv after the image so it cannot be parsed as docker options", () => {
      const argv = build({
        argv: ["--privileged", "-v", "/:/host"],
        policy: { targetDir, outputDir: freshOut() },
      });
      const imageIdx = argv.lastIndexOf("alpine:3.22");
      expect(argv.indexOf("--privileged")).toBeGreaterThan(imageIdx);
      expect(argv.slice(imageIdx + 1)).toEqual(["--privileged", "-v", "/:/host"]);
    });

    it("attaches only the internal network and sets proxy env when egress is configured", () => {
      const argv = build(
        {
          argv: ["true"],
          policy: { targetDir, outputDir: freshOut(), egressAllowlist: ["api.example.com"] },
        },
        { network: "sdap-net-x", proxyUrl: "http://10.0.0.2:3128" },
      );
      expectPair(argv, "--network", "sdap-net-x");
      expect(argv.filter((a) => a === "--network")).toHaveLength(1);
      expect(argv).not.toContain("--add-host");
      expectPair(argv, "--env", "HTTPS_PROXY=http://10.0.0.2:3128");
      expectPair(argv, "--env", "http_proxy=http://10.0.0.2:3128");
      expectPair(argv, "--env", "NO_PROXY=");
    });

    it("identifies kind honestly based on runtime", () => {
      expect(new DockerSandboxRunner().kind).toBe("docker-hardened");
      expect(new DockerSandboxRunner().enforcing).toBe(true);
      const gv = new DockerSandboxRunner({ runtime: "runsc" });
      expect(gv.kind).toBe("gvisor");
      const policy = validateSandboxExecRequest({
        argv: ["true"],
        policy: { targetDir, outputDir: freshOut() },
      });
      const argv = gv.buildDockerArgv(
        { argv: ["true"], policy },
        policy,
        resolveHostMounts(policy, {}),
        "c",
      );
      expectPair(argv, "--runtime", "runsc");
    });

    it("applies the seccomp profile and fails closed when it is missing", async () => {
      const r = new DockerSandboxRunner({ seccompProfile: SECCOMP });
      const policy = validateSandboxExecRequest({
        argv: ["true"],
        policy: { targetDir, outputDir: freshOut() },
      });
      const argv = r.buildDockerArgv(
        { argv: ["true"], policy },
        policy,
        resolveHostMounts(policy, {}),
        "c",
      );
      expectPair(argv, "--security-opt", `seccomp=${SECCOMP}`);

      const missing = new DockerSandboxRunner({ seccompProfile: "/nonexistent/seccomp.json" });
      const pf = await missing.preflight();
      expect(pf).toEqual({ ok: false, message: expect.stringContaining("seccomp profile") });
      await expect(
        missing.exec({ argv: ["true"], policy: { targetDir, outputDir: freshOut() } }),
      ).rejects.toThrow(/seccomp profile not found/);
    });

    it("rejects unsafe constructor options", () => {
      for (const user of ["0", "0:0", "root", "1000:abc", "-1"]) {
        expect(() => new DockerSandboxRunner({ user }), user).toThrow(SandboxValidationError);
      }
      expect(() => new DockerSandboxRunner({ image: "--privileged" })).toThrow(
        SandboxValidationError,
      );
      expect(() => new DockerSandboxRunner({ image: "alpine latest" })).toThrow(
        SandboxValidationError,
      );
      expect(() => new DockerSandboxRunner({ runtime: "--privileged" })).toThrow(
        SandboxValidationError,
      );
      expect(() => new DockerSandboxRunner({ pidsLimit: 0 })).toThrow(SandboxValidationError);
      expect(() => new DockerSandboxRunner({ seccompProfile: "relative.json" })).toThrow(
        SandboxValidationError,
      );
    });

    it("preflight reports an unreachable docker CLI", async () => {
      const broken = new DockerSandboxRunner({ dockerPath: "nonexistent-docker-binary-xyz" });
      const result = await broken.preflight();
      expect(result.ok).toBe(false);
      expect(result.message).toContain("Docker daemon unreachable or docker CLI failed");
    });

    it("preflight validates policy when provided", async () => {
      const result = await runner.preflight({ targetDir: "relative/path", outputDir: "/x" });
      expect(result.ok).toBe(false);
      expect(result.message).toContain("targetDir must be an absolute path");
    });

    it("exec rejects overlapping target/output before touching docker", async () => {
      const broken = new DockerSandboxRunner({ dockerPath: "nonexistent-docker-binary-xyz" });
      await expect(
        broken.exec({ argv: ["true"], policy: { targetDir, outputDir: targetDir } }),
      ).rejects.toThrow(/overlap/);
    });
  });

  describe.skipIf(!dockerOk)("live container tests (Docker/Podman)", () => {
    const runner = new DockerSandboxRunner(opts());
    const run = (argv: string[], policy: Partial<SandboxExecRequest["policy"]> = {}) =>
      runner.exec({
        argv,
        policy: { targetDir, outputDir: freshOut(), timeoutSec: 30, ...policy },
      });

    let hostServer: http.Server;
    let hostPort: number;

    beforeAll(async () => {
      // Listens on all interfaces so the engine VM / bridge can reach it as
      // host.docker.internal. It stands in for an allowlisted local model gateway.
      hostServer = http.createServer((req, res) => {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end(`server-allowed-response ${req.url}`);
      });
      await new Promise<void>((r) => hostServer.listen(0, "0.0.0.0", r));
      hostPort = (hostServer.address() as net.AddressInfo).port;
    });

    afterAll(async () => {
      await new Promise<void>((r) => hostServer.close(() => r()));
      // Nothing the runner created may outlive a run.
      const leftovers = execFileSync(
        "docker",
        ["ps", "-a", "--filter", "label=io.sdap.sandbox=1", "--format", "{{.Names}}"],
        { env: dockerEnv, encoding: "utf8" },
      ).trim();
      const nets = execFileSync(
        "docker",
        ["network", "ls", "--filter", "label=io.sdap.sandbox=1", "--format", "{{.Name}}"],
        { env: dockerEnv, encoding: "utf8" },
      ).trim();
      expect(leftovers).toBe("");
      expect(nets).toBe("");
    });

    it("preflight succeeds", () => {
      expect(livePreflight).toEqual({ ok: true, message: null });
    });

    // --- Egress -----------------------------------------------------------------------

    it("empty allowlist: no interfaces besides loopback, no egress, no DNS", async () => {
      const r = await run([
        "sh",
        "-c",
        "ls /sys/class/net; wget -T 2 -qO- http://1.1.1.1 >/dev/null 2>&1 && echo EGRESS_OK; " +
          "nslookup example.com >/dev/null 2>&1 && echo DNS_OK; " +
          `wget -T 2 -qO- http://host.docker.internal:${hostPort}/ >/dev/null 2>&1 && echo HOST_OK; ` +
          "echo done",
      ]);
      expect(r.exitCode).toBe(0);
      expect(r.stdout.trim().split(/\s+/)).toEqual(["lo", "done"]);
    });

    describe.skipIf(!proxyImageOk)("allowlisted egress through the proxy sidecar", () => {
      it("reaches an allowlisted local server and nothing else", async () => {
        const script = [
          // 1. allowlisted host via the proxy
          `wget -T 5 -qO- http://host.docker.internal:${hostPort}/allowed && echo; echo "allowed_rc=$?"`,
          // 2. same server, but ignoring the proxy: there must be no route
          `wget -Y off -T 3 -qO- http://host.docker.internal:${hostPort}/direct >/dev/null 2>&1 && echo DIRECT_HOST_OK`,
          `wget -Y off -T 3 -qO- http://1.1.1.1/ >/dev/null 2>&1 && echo DIRECT_IP_OK`,
          // ...nor via the internal network's gateway address (the host on Linux bridges)
          `GW=$(ip -4 route | awk '{print $1}' | head -1 | cut -d/ -f1 | sed 's/[.]0$/.1/')`,
          `wget -Y off -T 3 -qO- "http://$GW:${hostPort}/" >/dev/null 2>&1 && echo DIRECT_GW_OK`,
          // 3. non-allowlisted hosts through the proxy are refused
          `wget -T 5 -qO- http://example.com/ 2>&1 | head -1`,
          `wget -T 5 -qO- http://169.254.169.254/latest/meta-data/ 2>&1 | head -1`,
          // 4. a different port on the allowlisted host is refused
          `wget -T 5 -qO- http://host.docker.internal:1/ 2>&1 | head -1`,
          // 5. no external DNS from the internal network
          `nslookup example.com >/dev/null 2>&1 && echo DNS_OK`,
          "echo end",
        ].join("; ");
        const r = await run(["sh", "-c", script], {
          egressAllowlist: [`host.docker.internal:${hostPort}`],
        });
        expect(r.exitCode).toBe(0);
        expect(r.stdout).toContain("server-allowed-response /allowed");
        expect(r.stdout).toContain("allowed_rc=0");
        expect(r.stdout).not.toContain("DIRECT_HOST_OK");
        expect(r.stdout).not.toContain("DIRECT_IP_OK");
        expect(r.stdout).not.toContain("DIRECT_GW_OK");
        expect(r.stdout).not.toContain("DNS_OK");
        expect(r.stdout.match(/403 Forbidden/g)?.length).toBe(3);
        expect(r.stdout).toContain("end");
      });

      it.skipIf(!internetOk)(
        "resolves and reaches an allowlisted public hostname via the sidecar's DNS",
        async () => {
          const r = await run(
            [
              "sh",
              "-c",
              "wget -T 8 -qO- http://example.com/ | grep -o 'Example Domain' | head -1; " +
                "wget -T 8 -qO- http://www.iana.org/ 2>&1 | head -1",
            ],
            { egressAllowlist: ["example.com"] },
          );
          expect(r.stdout).toContain("Example Domain");
          expect(r.stdout).toContain("403 Forbidden");
        },
      );

      it("refuses the local server when it is not on the allowlist", async () => {
        const r = await run(
          ["wget", "-T", "5", "-qO-", `http://host.docker.internal:${hostPort}/`],
          {
            egressAllowlist: ["different.allowed.example"],
          },
        );
        expect(r.exitCode).not.toBe(0);
        expect(r.stderr).toContain("403");
      });

      it("refuses CONNECT tunnels to non-allowlisted and IP-literal metadata targets", async () => {
        // Raw CONNECT requests to the proxy (busybox wget does not use CONNECT for https).
        const connect = (authority: string) =>
          `printf 'CONNECT ${authority} HTTP/1.1\\r\\nHost: ${authority}\\r\\n\\r\\n' | nc -w 3 "$H" "$PT" | head -1`;
        const script = [
          'P="${HTTP_PROXY#http://}"; H="${P%:*}"; PT="${P##*:}"',
          connect("example.com:443"),
          connect("169.254.169.254:80"),
          connect("[::ffff:169.254.169.254]:80"),
          connect(`host.docker.internal:${hostPort}`),
        ].join("; ");
        const r = await run(["sh", "-c", script], {
          egressAllowlist: [`host.docker.internal:${hostPort}`],
        });
        const lines = r.stdout.trim().split("\n");
        expect(
          lines.slice(0, 3).every((l) => l.includes("403 Forbidden")),
          r.stdout,
        ).toBe(true);
        expect(lines[3]).toContain("200 Connection Established");
      });
    });

    // --- Filesystem ---------------------------------------------------------------------

    it("writes outside /out fail; /out writes land on the host; /tmp is noexec", async () => {
      const out = freshOut();
      const r = await runner.exec({
        argv: [
          "sh",
          "-c",
          [
            "touch /target/forbidden 2>&1",
            "touch /forbidden 2>&1",
            "touch /etc/forbidden 2>&1",
            "touch /usr/bin/forbidden 2>&1",
            'echo \'{"audit":"confirmed"}\' > /out/result.json && echo OUT_OK',
            "printf '#!/bin/sh\\necho EXEC_OK\\n' > /tmp/x.sh && chmod +x /tmp/x.sh && echo TMP_WRITE_OK",
            "/tmp/x.sh 2>&1",
            "true",
          ].join("; "),
        ],
        policy: { targetDir, outputDir: out, timeoutSec: 30 },
      });
      expect(r.exitCode).toBe(0);
      expect(r.stdout.match(/Read-only file system/g)?.length).toBe(4);
      expect(r.stdout).toContain("OUT_OK");
      expect(r.stdout).toContain("TMP_WRITE_OK");
      expect(r.stdout).not.toContain("EXEC_OK");
      expect(r.stdout).toMatch(/Permission denied/);
      expect(fs.readFileSync(path.join(out, "result.json"), "utf8").trim()).toBe(
        '{"audit":"confirmed"}',
      );
      expect(fs.existsSync(path.join(targetDir, "forbidden"))).toBe(false);
    });

    it("extra mounts are readable but read-only", async () => {
      const r = await run(["sh", "-c", "cat /skill/SKILL.md; echo; touch /skill/x 2>&1; true"], {
        readOnlyMounts: [{ hostPath: skillDir, containerPath: "/skill" }],
      });
      expect(r.stdout).toContain("skill-content");
      expect(r.stdout).toContain("Read-only file system");
    });

    // --- Privileges -----------------------------------------------------------------------

    it("runs as non-root with no capabilities and no_new_privs", async () => {
      const r = await run([
        "sh",
        "-c",
        "id -u; grep -E '^(CapEff|CapBnd|CapPrm|NoNewPrivs):' /proc/self/status",
      ]);
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toMatch(/^65534$/m);
      expect(r.stdout).toMatch(/CapEff:\s+0000000000000000/);
      expect(r.stdout).toMatch(/CapBnd:\s+0000000000000000/);
      expect(r.stdout).toMatch(/NoNewPrivs:\s+1/);
    });

    // --- Environment ----------------------------------------------------------------------

    it("host env vars are not visible inside the container", async () => {
      process.env.LEAK_TEST_SECRET = "super_confidential_token";
      const leakRunner = new DockerSandboxRunner(
        opts({ dockerEnv: { ...dockerEnv, LEAK_TEST_SECRET: "super_confidential_token" } }),
      );
      try {
        const r = await leakRunner.exec({
          argv: ["env"],
          policy: {
            targetDir,
            outputDir: freshOut(),
            env: { SANITIZED_ALLOWED: "ok_val" },
          },
        });
        expect(r.exitCode).toBe(0);
        expect(r.stdout).not.toContain("super_confidential_token");
        expect(r.stdout).not.toContain("LEAK_TEST_SECRET");
        expect(r.stdout).not.toContain("DOCKER_HOST");
        expect(r.stdout).toContain("SANITIZED_ALLOWED=ok_val");
      } finally {
        delete process.env.LEAK_TEST_SECRET;
      }
    });

    // --- Limits ---------------------------------------------------------------------------

    it("kills on timeout, sets killedBy=timeout and removes the container", async () => {
      const started = Date.now();
      const r = await run(["sleep", "60"], { timeoutSec: 1 });
      expect(r.killedBy).toBe("timeout");
      expect(Date.now() - started).toBeLessThan(15_000);
    });

    it("kills on abort and sets killedBy=abort", async () => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 1500);
      const r = await runner.exec({
        argv: ["sleep", "60"],
        signal: controller.signal,
        policy: { targetDir, outputDir: freshOut(), timeoutSec: 30 },
      });
      expect(r.killedBy).toBe("abort");
    });

    it("enforces the memory limit and reports killedBy=oom", async () => {
      const r = await run(["sh", "-c", 'a="x"; while true; do a="$a$a$a$a$a$a$a$a$a$a"; done'], {
        memoryMb: 16,
        timeoutSec: 20,
      });
      expect(r.exitCode).toBe(137);
      expect(r.killedBy).toBe("oom");
    });

    it("enforces the pids limit", async () => {
      const small = new DockerSandboxRunner(opts({ pidsLimit: 16 }));
      const r = await small.exec({
        argv: [
          "sh",
          "-c",
          "for i in $(seq 1 40); do sleep 5 & done 2>&1; echo spawned; wait 2>/dev/null; true",
        ],
        policy: { targetDir, outputDir: freshOut(), timeoutSec: 30 },
      });
      expect(r.stdout + r.stderr).toMatch(/can't fork|Resource temporarily unavailable/i);
    });

    it("passes stdin and caps output", async () => {
      const capped = new DockerSandboxRunner(opts({ maxOutputBytes: 2048 }));
      const r = await capped.exec({
        argv: ["sh", "-c", "cat; head -c 100000 /dev/zero | tr '\\0' 'y'"],
        stdin: "from-stdin\n",
        policy: { targetDir, outputDir: freshOut(), timeoutSec: 30 },
      });
      expect(r.stdout.startsWith("from-stdin\n")).toBe(true);
      expect(r.stdout).toContain("output truncated at 2048 bytes");
      expect(r.stdout.length).toBeLessThan(2200);
    });

    it("applies the bundled seccomp profile (blocks unshare)", async (ctx) => {
      const policy = () => ({ targetDir, outputDir: freshOut(), timeoutSec: 30 });
      const argv = [
        "sh",
        "-c",
        "echo seccomp-ok; unshare -U true 2>&1; grep Seccomp: /proc/self/status",
      ];
      let r = await new DockerSandboxRunner(opts({ seccompProfile: SECCOMP })).exec({
        argv,
        policy: policy(),
      });
      if (/file name too long|opening seccomp profile/.test(r.stderr)) {
        // The docker CLI inlines the profile JSON; Podman's compat API expects a path.
        // Retry through the podman CLI, which passes the path.
        if (!podmanCliOk) {
          console.warn("[sandbox tests] seccomp via docker CLI unsupported by engine; SKIPPING.");
          ctx.skip();
        }
        r = await new DockerSandboxRunner({ dockerPath: "podman", seccompProfile: SECCOMP }).exec({
          argv,
          policy: policy(),
        });
      }
      expect(r.stdout).toContain("seccomp-ok");
      expect(r.stdout).toMatch(/unshare.*Operation not permitted/);
      expect(r.stdout).toMatch(/Seccomp:\s+2/);
    });

    // --- gVisor honesty ---------------------------------------------------------------------

    it("never reports gVisor isolation unless a probe proves a non-host kernel", async () => {
      const gv = new DockerSandboxRunner(opts({ runtime: "runsc" }));
      const pf = await gv.preflight();
      if (!pf.ok) {
        console.warn(`[sandbox tests] gVisor not available (${pf.message}); exec must refuse.`);
        await expect(
          gv.exec({ argv: ["true"], policy: { targetDir, outputDir: freshOut() } }),
        ).rejects.toThrow(/runtime "runsc"/);
        return;
      }
      const r = await gv.exec({
        argv: ["uname", "-r"],
        policy: { targetDir, outputDir: freshOut(), timeoutSec: 30 },
      });
      const hostKernel = execFileSync("docker", ["info", "--format", "{{.KernelVersion}}"], {
        env: dockerEnv,
        encoding: "utf8",
      }).trim();
      expect(r.exitCode).toBe(0);
      expect(r.stdout.trim()).not.toBe(hostKernel);
    });
  });
});
