import { describe, expect, it } from "vitest";
import { chmod, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execaCommand } from "execa";
import { DoctorService } from "../src/services/doctor.js";
import { ProjectBootstrap } from "../src/services/projectBootstrap.js";
import { SmokeRunner } from "../src/services/smokeRunner.js";
import { safeExec } from "../src/utils/safeExec.js";

describe("DoctorService", () => {
  it("runs doctor without a target project", async () => {
    const result = await new DoctorService().run();

    expect(result.result).not.toBe("NOT_READY");
    expect(result.orchestrator.checks.some((check) => check.name === "MCP tools registered" && check.status === "pass")).toBe(true);
  });

  it("runs doctor with a ready project", async () => {
    const projectPath = await readyProject();

    const result = await new DoctorService().run(projectPath);

    expect(result.result).toBe("READY_WITH_WARNINGS");
    expect(result.targetProject?.checks.some((check) => check.name === "git repository detected" && check.status === "pass")).toBe(true);
    expect(result.warnings.some((warning) => warning.includes("npm run lint is not available"))).toBe(true);
  });

  it("reports NOT_READY for a target folder without Git", async () => {
    const projectPath = await tempProject();

    const result = await new DoctorService().run(projectPath);

    expect(result.result).toBe("NOT_READY");
    expect(result.errors.some((error) => error.includes("git repository detected"))).toBe(true);
  });

  it("is JSON serializable", async () => {
    const result = await new DoctorService().run();
    const parsed = JSON.parse(JSON.stringify(result)) as typeof result;

    expect(parsed.orchestrator.checks.length).toBeGreaterThan(0);
  });

  it("runs doctor with a docker-compose profile", async () => {
    const projectPath = await readyProject();
    await addComposeFile(projectPath);

    await withDockerStub(async () => {
      const result = await new DoctorService().run({ projectPath, profile: "docker-compose" });

      expect(result.profile).toBe("docker-compose");
      expect(result.targetProject?.checks.some((check) => check.name === "docker compose file exists" && check.status === "pass")).toBe(true);
      expect(result.targetProject?.checks.some((check) => check.name === "docker compose version" && check.status === "pass")).toBe(true);
      expect(result.targetProject?.checks.some((check) => check.name === "docker compose config" && check.status === "warn")).toBe(true);
    });
  });

  it("does not store full docker compose config output", async () => {
    const projectPath = await readyProject();
    await addComposeFile(projectPath);

    await withDockerStub(async () => {
      const result = await new DoctorService().run({
        projectPath,
        profile: "docker-compose",
        allowComposeConfigOutput: true
      });
      const configCheck = result.targetProject?.checks.find((check) => check.name === "docker compose config");

      expect(configCheck?.status).toBe("pass");
      expect(configCheck?.details).toContain("exit code 0");
      expect(configCheck?.details).not.toContain("SUPER_SECRET_VALUE");
    });
  });

  it("detects forbidden tracked paths", async () => {
    const projectPath = await tempProject();
    await initGit(projectPath);
    await writeFile(path.join(projectPath, ".env"), "SECRET=value", "utf8");
    await execaCommand("git add .env", { cwd: projectPath, shell: true });

    const forbidden = await new DoctorService().forbiddenTrackedPaths(projectPath);

    expect(forbidden).toEqual([".env"]);
  });
});

describe("SmokeRunner", () => {
  it("runs smoke on a ready project and keeps tracked files clean", async () => {
    const projectPath = await readyProject();

    const result = await new SmokeRunner().run(projectPath);
    const gitStatus = await safeExec(projectPath, "git status --short");

    expect(result.result).toBe("PASS");
    expect(result.reportPath).toMatch(/^\.codex\/reports\/smoke-report-/);
    expect(gitStatus.stdout.trim()).toBe("");
  });

  it("creates a smoke report", async () => {
    const projectPath = await readyProject();

    const result = await new SmokeRunner().run(projectPath);
    const report = await readFile(path.join(projectPath, result.reportPath ?? ""), "utf8");

    expect(report).toContain("# Smoke Report");
  });

  it("is JSON serializable", async () => {
    const projectPath = await readyProject();
    const result = await new SmokeRunner().run(projectPath);
    const parsed = JSON.parse(JSON.stringify(result)) as typeof result;

    expect(parsed.result).toBe("PASS");
    expect(parsed.checks.some((check) => check.name === "git_status_clean")).toBe(true);
  });

  it("runs ephemeral smoke without changing ordinary tasks.json", async () => {
    const projectPath = await readyProject();
    const tasksStatePath = path.join(projectPath, ".codex", "state", "tasks.json");
    const before = await readFile(tasksStatePath, "utf8");

    const result = await new SmokeRunner().run(projectPath, { ephemeral: true });
    const after = await readFile(tasksStatePath, "utf8");

    expect(result.result).toBe("PASS");
    expect(result.ephemeral).toBe(true);
    expect(after).toBe(before);
    expect(result.checks.some((check) => check.name === "ordinary_tasks_json_unchanged" && check.status === "pass")).toBe(true);
  });

  it("writes ephemeral smoke reports under .codex/smoke/reports", async () => {
    const projectPath = await readyProject();

    const result = await new SmokeRunner().run(projectPath, { ephemeral: true });
    const report = await readFile(path.join(projectPath, result.reportPath ?? ""), "utf8");

    expect(result.reportPath).toMatch(/^\.codex\/smoke\/reports\/smoke-report-/);
    expect(report).toContain("Mode: ephemeral");
  });

  it("does not create ordinary task files in ephemeral mode", async () => {
    const projectPath = await readyProject();
    const tasksDir = path.join(projectPath, ".codex", "tasks");
    const before = await readdir(tasksDir);

    const result = await new SmokeRunner().run(projectPath, { ephemeral: true });
    const after = await readdir(tasksDir);

    expect(result.result).toBe("PASS");
    expect(after.sort()).toEqual(before.sort());
    expect(result.checks.some((check) => check.name === "ordinary_tasks_dir_unchanged" && check.status === "pass")).toBe(true);
  });

  it("runs docker-compose profile in ephemeral smoke", async () => {
    const projectPath = await readyProject();
    await addComposeFile(projectPath);

    await withDockerStub(async () => {
      const result = await new SmokeRunner().run(projectPath, { profile: "docker-compose", ephemeral: true });

      expect(result.result).toBe("PASS");
      expect(result.profile).toBe("docker-compose");
      expect(result.ephemeral).toBe(true);
      expect(result.checks.some((check) => check.name === "docker compose file exists" && check.status === "pass")).toBe(true);
    });
  });

  it("includes ephemeral and profile in JSON output", async () => {
    const projectPath = await readyProject();
    await addComposeFile(projectPath);

    await withDockerStub(async () => {
      const result = await new SmokeRunner().run(projectPath, { profile: "docker-compose", ephemeral: true });
      const parsed = JSON.parse(JSON.stringify(result)) as typeof result;

      expect(parsed.ephemeral).toBe(true);
      expect(parsed.profile).toBe("docker-compose");
    });
  });
});

async function readyProject(): Promise<string> {
  const projectPath = await tempProject();
  await writeFile(
    path.join(projectPath, "package.json"),
    JSON.stringify({ scripts: { build: "tsc -v", test: "node -e \"console.log('test')\"" } }, null, 2),
    "utf8"
  );
  await writeFile(path.join(projectPath, "package-lock.json"), "{}", "utf8");
  await initGit(projectPath);
  await new ProjectBootstrap().bootstrap(projectPath);
  await safeExec(projectPath, "git add .gitignore package.json package-lock.json");
  await safeExec(projectPath, "git commit -m ready");
  return projectPath;
}

async function tempProject(): Promise<string> {
  const root = path.join(os.tmpdir(), `chatgpt-codex-mcp-${crypto.randomUUID()}`);
  await mkdir(root, { recursive: true });
  return root;
}

async function initGit(projectPath: string): Promise<void> {
  await safeExec(projectPath, "git init");
  await safeExec(projectPath, "git config user.email test@example.com");
  await safeExec(projectPath, "git config user.name Test");
}

async function addComposeFile(projectPath: string): Promise<void> {
  await writeFile(path.join(projectPath, "docker-compose.yml"), "services:\n  app:\n    image: busybox\n", "utf8");
  await safeExec(projectPath, "git add docker-compose.yml");
  await safeExec(projectPath, "git commit -m compose");
}

async function withDockerStub(run: () => Promise<void>): Promise<void> {
  const originalPath = process.env.PATH;
  const binDir = path.join(os.tmpdir(), `chatgpt-codex-mcp-docker-${crypto.randomUUID()}`);
  await mkdir(binDir, { recursive: true });
  await writeFile(
    path.join(binDir, "docker.cmd"),
    [
      "@echo off",
      "if \"%1\"==\"compose\" if \"%2\"==\"version\" (echo Docker Compose version v2.99.0 & exit /b 0)",
      "if \"%1\"==\"compose\" if \"%2\"==\"ps\" (echo NAME SERVICE STATUS & exit /b 0)",
      "if \"%1\"==\"compose\" if \"%2\"==\"config\" (echo SUPER_SECRET_VALUE=should_not_be_stored & exit /b 0)",
      "exit /b 1",
      ""
    ].join("\r\n"),
    "utf8"
  );
  const unixDockerPath = path.join(binDir, "docker");
  await writeFile(
    unixDockerPath,
    [
      "#!/bin/sh",
      "if [ \"$1\" = \"compose\" ] && [ \"$2\" = \"version\" ]; then echo 'Docker Compose version v2.99.0'; exit 0; fi",
      "if [ \"$1\" = \"compose\" ] && [ \"$2\" = \"ps\" ]; then echo 'NAME SERVICE STATUS'; exit 0; fi",
      "if [ \"$1\" = \"compose\" ] && [ \"$2\" = \"config\" ]; then echo 'SUPER_SECRET_VALUE=should_not_be_stored'; exit 0; fi",
      "exit 1",
      ""
    ].join("\n"),
    "utf8"
  );
  await chmod(unixDockerPath, 0o755).catch(() => undefined);
  process.env.PATH = `${binDir}${path.delimiter}${originalPath ?? ""}`;

  try {
    await run();
  } finally {
    process.env.PATH = originalPath;
  }
}
