import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

export class ValidationService {
  private readonly skillPath: string;

  constructor(skillPath: string) {
    this.skillPath = skillPath;
  }

  getFindingsValidatorScript(): string {
    return path.join(this.skillPath, "validate-findings.cjs");
  }

  getCoverageLedgerValidatorScript(): string {
    return path.join(this.skillPath, "validate-coverage-ledger.cjs");
  }

  async validateFindings(filePath: string): Promise<ValidationResult> {
    const scriptPath = this.getFindingsValidatorScript();
    return this.runNodeValidator(scriptPath, filePath);
  }

  async validateCoverageLedger(filePath: string): Promise<ValidationResult> {
    const scriptPath = this.getCoverageLedgerValidatorScript();
    return this.runNodeValidator(scriptPath, filePath);
  }

  async quarantineFile(filePath: string, outputDir: string, sliceId?: string): Promise<string> {
    const quarantineDir = path.join(outputDir, "quarantine");
    await fs.mkdir(quarantineDir, { recursive: true });

    const baseName = path.basename(filePath);
    const destName = `${sliceId ? sliceId + "-" : ""}${Date.now()}-${baseName}`;
    const destPath = path.join(quarantineDir, destName);

    try {
      await fs.copyFile(filePath, destPath);
      // Remove original so corrupted file does not linger in artefact root
      await fs.unlink(filePath).catch(() => {});
    } catch {
      // If copy fails (e.g. file missing), still return the intended dest path
    }

    return destPath;
  }

  private runNodeValidator(scriptPath: string, targetFile: string): Promise<ValidationResult> {
    return new Promise<ValidationResult>((resolve) => {
      const child = spawn(process.execPath, [scriptPath, targetFile], {
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
      });

      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });

      child.on("close", (code) => {
        if (code === 0) {
          resolve({ ok: true, errors: [] });
        } else {
          const raw = `${stderr}\n${stdout}`.trim();
          const lines = raw
            .split("\n")
            .map((l) => l.trim())
            .filter((l) => l.length > 0 && !l.startsWith("node:"));
          resolve({
            ok: false,
            errors: lines.length > 0 ? lines : [`Validator exited with code ${code}`],
          });
        }
      });

      child.on("error", (err) => {
        resolve({
          ok: false,
          errors: [`Failed to spawn validator: ${err.message}`],
        });
      });
    });
  }
}
