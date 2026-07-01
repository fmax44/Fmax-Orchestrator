import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { toolNames } from "../mcp/toolNames.js";
import { safeExec } from "../utils/safeExec.js";
import { ProjectHealthService } from "./projectHealth.js";
import { runDockerComposeProfile, type CheckProfile } from "./dockerComposeProfile.js";
import { ProjectPolicyService } from "./projectPolicy.js";

export type DiagnosticStatus = "pass" | "warn" | "fail";
export type DoctorResultStatus = "READY" | "READY_WITH_WARNINGS" | "NOT_READY";

export interface DiagnosticCheck {
  name: string;
  status: DiagnosticStatus;
  details: string;
}

export interface DiagnosticSection {
  checks: DiagnosticCheck[];
}

export interface DoctorResult {
  result: DoctorResultStatus;
  profile: CheckProfile;
  allowComposeConfigOutput: boolean;
  orchestrator: DiagnosticSection;
  targetProject?: DiagnosticSection & { projectPath: string };
  warnings: string[];
  errors: string[];
}

export interface DoctorRunOptions {
  projectPath?: string;
  profile?: CheckProfile;
  allowComposeConfigOutput?: boolean;
}

interface NormalizedDoctorRunOptions {
  projectPath?: string;
  profile: CheckProfile;
  allowComposeConfigOutput: boolean;
}

const requiredToolNames = [
  "create_task",
  "get_task_status",
  "read_report",
  "inspect_diff",
  "run_tests",
  "approve_task",
  "reject_task",
  "create_next_task",
  "relay_status",
  "codex_next",
  "project_health",
  "list_tasks",
  "archive_task",
  "doctor",
  "smoke_check",
  "read_policy",
  "validate_task_against_policy",
  "validate_diff_against_policy",
  "review_gate",
  "project_status"
];

export class DoctorService {
  constructor(
    private readonly orchestratorPath = process.cwd(),
    private readonly projectHealth = new ProjectHealthService(),
    private readonly policyService = new ProjectPolicyService()
  ) {}

  async run(projectPathOrOptions?: string | DoctorRunOptions): Promise<DoctorResult> {
    const options = normalizeOptions(projectPathOrOptions);
    if (options.projectPath && options.profile === "default") {
      const policy = await this.policyService.readPolicy(options.projectPath).then((result) => result.policy).catch(() => undefined);
      options.profile = policy?.defaultProfile ?? options.profile;
    }
    const orchestrator = await this.checkOrchestrator();
    const targetProject = options.projectPath ? await this.checkTargetProject(options.projectPath, options) : undefined;
    const checks = [...orchestrator.checks, ...(targetProject?.checks ?? [])];
    const warnings = checks.filter((check) => check.status === "warn").map((check) => `${check.name}: ${check.details}`);
    const errors = checks.filter((check) => check.status === "fail").map((check) => `${check.name}: ${check.details}`);

    return {
      result: errors.length > 0 ? "NOT_READY" : warnings.length > 0 ? "READY_WITH_WARNINGS" : "READY",
      profile: options.profile,
      allowComposeConfigOutput: options.allowComposeConfigOutput,
      orchestrator,
      targetProject,
      warnings,
      errors
    };
  }

  async forbiddenTrackedPaths(projectPath: string): Promise<string[]> {
    const result = await safeExec(projectPath, "git ls-files", { maxOutputBytes: 200_000 });
    if (result.exitCode !== 0) {
      return [];
    }

    return result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((filePath) => filePath === ".env" || filePath.startsWith("node_modules/") || filePath.startsWith("dist/") || filePath.startsWith(".codex/"));
  }

  private async checkOrchestrator(): Promise<DiagnosticSection> {
    const root = path.resolve(this.orchestratorPath);
    const packageJsonPath = path.join(root, "package.json");
    const packageJson = await readJson<{ scripts?: Record<string, string> }>(packageJsonPath);
    const forbidden = await this.forbiddenTrackedPaths(root);
    const gitStatus = await safeExec(root, "git status --short", { maxOutputBytes: 50_000 });
    const isGitRepo = await safeExec(root, "git rev-parse --is-inside-work-tree", { maxOutputBytes: 1_000 });
    const npmVersion = await safeExec(root, "npm --version", { maxOutputBytes: 1_000 });
    const missingTools = requiredToolNames.filter((name) => !toolNames.includes(name as (typeof toolNames)[number]));

    return {
      checks: [
        pass("Node.js available", process.version),
        npmVersion.exitCode === 0 ? pass("npm available", npmVersion.stdout.trim()) : fail("npm available", npmVersion.stderr || npmVersion.stdout),
        (await fileExists(packageJsonPath)) ? pass("package.json exists", "") : fail("package.json exists", packageJsonPath),
        (await fileExists(path.join(root, "tsconfig.json"))) ? pass("tsconfig.json exists", "") : fail("tsconfig.json exists", "Missing tsconfig.json"),
        hasScripts(packageJson, ["build", "test", "lint"]) ? pass("npm scripts: build/test/lint", "") : fail("npm scripts: build/test/lint", "One or more scripts are missing."),
        (await fileExists(path.join(root, "src/index.ts"))) ? pass("src/index.ts exists", "") : fail("src/index.ts exists", "Missing src/index.ts"),
        missingTools.length === 0 ? pass("MCP tools registered", requiredToolNames.join(", ")) : fail("MCP tools registered", `Missing tools: ${missingTools.join(", ")}`),
        isGitRepo.exitCode === 0 && isGitRepo.stdout.trim() === "true" ? pass("git repository detected", "") : fail("git repository detected", "Not a Git repository."),
        gitStatus.exitCode === 0 ? pass("git status readable", gitStatus.stdout.trim() || "clean") : fail("git status readable", gitStatus.stderr || gitStatus.stdout),
        forbidden.length === 0 ? pass("forbidden paths are not tracked", "") : fail("forbidden paths are not tracked", forbidden.join(", "))
      ]
    };
  }

  private async checkTargetProject(projectPath: string, options: NormalizedDoctorRunOptions): Promise<DiagnosticSection & { projectPath: string }> {
    const health = await this.projectHealth.check(projectPath);
    const forbidden = health.exists && health.isGitRepo ? await this.forbiddenTrackedPaths(health.projectPath) : [];
    const checks: DiagnosticCheck[] = [
      health.exists ? pass("project exists", health.projectPath) : fail("project exists", health.projectPath),
      health.isGitRepo ? pass("git repository detected", "") : fail("git repository detected", "Project is not a Git repository."),
      health.gitStatusClean ? pass("git status clean", "") : warn("git status clean", "Working tree is not clean."),
      health.codexDirExists ? pass(".codex exists", "") : fail(".codex exists", "Run bootstrap first."),
      health.tasksStateExists ? pass(".codex/state/tasks.json exists", "") : fail(".codex/state/tasks.json exists", "Run bootstrap first."),
      health.gitignoreHasCodex ? pass(".codex ignored by Git", "") : fail(".codex ignored by Git", ".gitignore does not contain .codex/."),
      health.availableChecks.includes("npm run build") ? pass("npm run build is available", "") : warn("npm run build is not available", ""),
      health.availableChecks.includes("npm test") ? pass("npm test is available", "") : warn("npm test is not available", ""),
      health.availableChecks.includes("npm run lint") ? pass("npm run lint is available", "") : warn("npm run lint is not available", ""),
      forbidden.length === 0 ? pass("target forbidden paths are not tracked", "") : fail("target forbidden paths are not tracked", forbidden.join(", "))
    ];

    if (options.profile === "docker-compose" && health.exists) {
      const composeChecks = await runDockerComposeProfile(health.projectPath, {
        allowComposeConfigOutput: options.allowComposeConfigOutput
      });
      checks.push(...composeChecks);
    }

    if (health.exists) {
      const policy = await this.policyService.readPolicy(health.projectPath);
      checks.push(policy.exists ? pass("policy exists", policy.policyPath) : warn("policy exists", policy.warnings.join("; ")));
      if (policy.policy) {
        checks.push(pass("policy version", String(policy.policy.version)));
        checks.push(pass("policy defaultProfile", policy.policy.defaultProfile));
        checks.push(pass("policy defaultSmokeMode", policy.policy.defaultSmokeMode));
      }
      checks.push(...policy.errors.map((error) => fail("policy schema", error)));
      checks.push(...policy.warnings.filter(() => policy.exists).map((warning) => warn("policy warning", warning)));
    }

    return {
      projectPath: health.projectPath,
      checks
    };
  }
}

function normalizeOptions(projectPathOrOptions?: string | DoctorRunOptions): NormalizedDoctorRunOptions {
  if (typeof projectPathOrOptions === "string") {
    return {
      projectPath: projectPathOrOptions,
      profile: "default",
      allowComposeConfigOutput: false
    };
  }

  return {
    projectPath: projectPathOrOptions?.projectPath,
    profile: projectPathOrOptions?.profile ?? "default",
    allowComposeConfigOutput: projectPathOrOptions?.allowComposeConfigOutput ?? false
  };
}

export function formatDoctorText(result: DoctorResult): string {
  const lines = ["MCP Orchestrator Doctor", "", "Orchestrator:"];
  lines.push(...result.orchestrator.checks.map(formatCheck));

  if (result.targetProject) {
    lines.push("", `Target project: ${result.targetProject.projectPath}`);
    lines.push(...result.targetProject.checks.map(formatCheck));
  }

  if (result.warnings.length) {
    lines.push("", "Warnings:");
    lines.push(...result.warnings.map((warning) => `- ${warning}`));
  }

  if (result.errors.length) {
    lines.push("", "Errors:");
    lines.push(...result.errors.map((error) => `- ${error}`));
  }

  lines.push("", `Result: ${result.result}`);
  return lines.join("\n");
}

function formatCheck(check: DiagnosticCheck): string {
  const label = check.status === "pass" ? "PASS" : check.status === "warn" ? "WARN" : "FAIL";
  return `[${label}] ${check.name}${check.details ? ` - ${check.details}` : ""}`;
}

function pass(name: string, details: string): DiagnosticCheck {
  return { name, status: "pass", details };
}

function warn(name: string, details: string): DiagnosticCheck {
  return { name, status: "warn", details };
}

function fail(name: string, details: string): DiagnosticCheck {
  return { name, status: "fail", details };
}

function hasScripts(packageJson: { scripts?: Record<string, string> } | undefined, scripts: string[]): boolean {
  return scripts.every((script) => packageJson?.scripts?.[script]);
}

async function readJson<T>(filePath: string): Promise<T | undefined> {
  return readFile(filePath, "utf8")
    .then((content) => JSON.parse(content) as T)
    .catch(() => undefined);
}

async function fileExists(filePath: string): Promise<boolean> {
  return stat(filePath)
    .then(() => true)
    .catch(() => false);
}
