import { stat } from "node:fs/promises";
import path from "node:path";
import { safeExec } from "../utils/safeExec.js";

export type CheckProfile = "default" | "docker-compose";
export type ProfileCheckStatus = "pass" | "warn" | "fail";

export interface ProfileCheck {
  name: string;
  status: ProfileCheckStatus;
  details: string;
}

export interface DockerComposeProfileOptions {
  allowComposeConfigOutput?: boolean;
}

const composeFileNames = ["docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml"];

export async function runDockerComposeProfile(projectPath: string, options: DockerComposeProfileOptions = {}): Promise<ProfileCheck[]> {
  const root = path.resolve(projectPath);
  const composeFile = await findComposeFile(root);
  const checks: ProfileCheck[] = [];

  checks.push(
    composeFile
      ? pass("docker compose file exists", path.basename(composeFile))
      : fail("docker compose file exists", `Missing one of: ${composeFileNames.join(", ")}`)
  );

  const version = await safeExec(root, "docker compose version", { maxOutputBytes: 10_000 });
  checks.push(version.exitCode === 0 ? pass("docker compose version", firstLine(version.stdout) || "available") : fail("docker compose version", version.stderr || version.stdout));

  if (composeFile) {
    const ps = await safeExec(root, "docker compose ps", { maxOutputBytes: 20_000 });
    checks.push(ps.exitCode === 0 ? pass("docker compose ps", "command completed") : fail("docker compose ps", ps.stderr || ps.stdout));
  } else {
    checks.push(fail("docker compose ps", "Skipped because compose file is missing."));
  }

  if (options.allowComposeConfigOutput) {
    const config = await safeExec(root, "docker compose config", { maxOutputBytes: 20_000 });
    const details = `exit code ${config.exitCode}; full output is intentionally not stored because it may contain resolved env values.`;
    checks.push(config.exitCode === 0 ? pass("docker compose config", details) : fail("docker compose config", details));
  } else {
    checks.push(warn("docker compose config", "Not executed by default; use --allow-compose-config-output to run it without storing stdout/stderr."));
  }

  return checks;
}

async function findComposeFile(projectPath: string): Promise<string | undefined> {
  for (const fileName of composeFileNames) {
    const filePath = path.join(projectPath, fileName);
    const info = await stat(filePath).catch(() => undefined);
    if (info?.isFile()) {
      return filePath;
    }
  }

  return undefined;
}

function firstLine(value: string): string {
  return value.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? "";
}

function pass(name: string, details: string): ProfileCheck {
  return { name, status: "pass", details };
}

function warn(name: string, details: string): ProfileCheck {
  return { name, status: "warn", details };
}

function fail(name: string, details: string): ProfileCheck {
  return { name, status: "fail", details };
}
