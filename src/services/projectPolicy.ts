import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { CreateTaskData } from "../domain/task.js";
import { safeExec } from "../utils/safeExec.js";
import { ensureRelativeInsideProject, getCodexPaths, toProjectRelative } from "../utils/paths.js";
import { TaskStore } from "./taskStore.js";
import type { CheckProfile } from "./dockerComposeProfile.js";

export type PolicyPreset = "basic" | "node" | "docker-compose" | "python" | "custom";
export type DefaultSmokeMode = "legacy" | "ephemeral";

const workflowSchema = z.object({
  strictReviewGate: z.boolean().default(false),
  requireReviewReportBeforeApprove: z.boolean().default(true),
  maxReviewAgeMinutes: z.number().int().positive().default(60),
  requireCleanGitForApprove: z.boolean().default(false)
});

export const projectPolicySchema = z.object({
  version: z.literal(1),
  projectName: z.string().min(1),
  defaultProfile: z.enum(["default", "docker-compose"]).default("default"),
  defaultSmokeMode: z.enum(["legacy", "ephemeral"]).default("ephemeral"),
  allowedPaths: z.array(z.string()).default([]),
  blockedPaths: z.array(z.string()).default([]),
  protectedFiles: z.array(z.string()).default([]),
  allowedCommands: z.array(z.string()).default([]),
  blockedCommands: z.array(z.string()).default([]),
  requiredChecks: z.record(z.array(z.string())).default({}),
  sensitiveOutputCommands: z.array(z.string()).default([]),
  manualApprovalRequiredFor: z.array(z.string()).default([]),
  privateFolders: z.array(z.string()).default([]),
  workflow: workflowSchema.default({})
});

export type ProjectPolicy = z.infer<typeof projectPolicySchema>;

export interface PolicyReadResult {
  exists: boolean;
  policy?: ProjectPolicy;
  warnings: string[];
  errors: string[];
  policyPath: string;
}

export interface PolicyCreateResult {
  policyPath: string;
  preset: PolicyPreset;
  created: boolean;
  overwritten: boolean;
  policy: ProjectPolicy;
}

export interface PolicyValidationResult {
  valid: boolean;
  warnings: string[];
  errors: string[];
  manualApprovalRequired: boolean;
}

export interface TaskPolicyValidationResult extends PolicyValidationResult {
  taskId: string;
}

export interface DiffPolicyValidationResult extends PolicyValidationResult {
  changedFiles: string[];
}

export class ProjectPolicyService {
  constructor(private readonly taskStore = new TaskStore()) {}

  async createPolicy(projectPath: string, preset: PolicyPreset, force = false): Promise<PolicyCreateResult> {
    const root = path.resolve(projectPath);
    const paths = getCodexPaths(root);
    const policyPath = this.policyPath(root);
    const existed = await exists(policyPath);

    if (existed && !force) {
      const current = await this.readPolicy(projectPath);
      if (!current.policy) {
        throw new Error(`Existing policy could not be read: ${current.errors.join("; ")}`);
      }

      return {
        policyPath: toProjectRelative(root, policyPath),
        preset,
        created: false,
        overwritten: false,
        policy: current.policy
      };
    }

    const policy = createPresetPolicy(root, preset);
    await mkdir(paths.codexDir, { recursive: true });
    await writeFile(policyPath, `${JSON.stringify(policy, null, 2)}\n`, "utf8");

    return {
      policyPath: toProjectRelative(root, policyPath),
      preset,
      created: !existed,
      overwritten: existed,
      policy
    };
  }

  async readPolicy(projectPath: string): Promise<PolicyReadResult> {
    const root = path.resolve(projectPath);
    const policyPath = this.policyPath(root);
    const warnings: string[] = [];
    const errors: string[] = [];
    const content = await readFile(policyPath, "utf8").catch((error: unknown) => {
      if (isNodeError(error) && error.code === "ENOENT") {
        warnings.push("Project policy is missing. Run bootstrap with --policy basic, node, or docker-compose.");
        return undefined;
      }

      throw error;
    });

    if (!content) {
      return {
        exists: false,
        warnings,
        errors,
        policyPath: toProjectRelative(root, policyPath)
      };
    }

    try {
      const parsed = JSON.parse(content) as unknown;
      const policy = projectPolicySchema.parse(parsed);
      return {
        exists: true,
        policy,
        warnings,
        errors,
        policyPath: toProjectRelative(root, policyPath)
      };
    } catch (error: unknown) {
      errors.push(error instanceof Error ? error.message : String(error));
      return {
        exists: true,
        warnings,
        errors,
        policyPath: toProjectRelative(root, policyPath)
      };
    }
  }

  async validateCreateTask(projectPath: string, input: Pick<CreateTaskData, "goal" | "context" | "scope" | "outOfScope" | "filesAllowed" | "requiredChecks" | "notes">): Promise<PolicyValidationResult> {
    const readResult = await this.readPolicy(projectPath);
    if (!readResult.policy) {
      return {
        valid: readResult.errors.length === 0,
        warnings: readResult.warnings,
        errors: readResult.errors,
        manualApprovalRequired: false
      };
    }

    return this.validateTaskData(readResult.policy, input);
  }

  async validateTaskAgainstPolicy(projectPath: string, taskId: string): Promise<TaskPolicyValidationResult> {
    const task = await this.taskStore.getTask(projectPath, taskId);
    const root = path.resolve(projectPath);
    const taskPath = ensureRelativeInsideProject(root, task.taskPath);
    const markdown = await readFile(taskPath, "utf8");
    const result = await this.validateCreateTask(projectPath, {
      goal: sectionText(markdown, "Goal"),
      context: sectionText(markdown, "Context"),
      scope: sectionList(markdown, "Scope"),
      outOfScope: sectionList(markdown, "Out of Scope"),
      filesAllowed: sectionList(markdown, "Files Allowed"),
      requiredChecks: sectionList(markdown, "Required Checks"),
      notes: sectionText(markdown, "Notes for Codex")
    });

    return {
      taskId,
      ...result
    };
  }

  async validateDiffAgainstPolicy(projectPath: string): Promise<DiffPolicyValidationResult> {
    const readResult = await this.readPolicy(projectPath);
    const changedFiles = await this.changedFiles(projectPath);
    if (!readResult.policy) {
      return {
        valid: readResult.errors.length === 0,
        changedFiles,
        warnings: readResult.warnings,
        errors: readResult.errors,
        manualApprovalRequired: false
      };
    }

    const warnings: string[] = [];
    const errors: string[] = [];
    let manualApprovalRequired = false;

    for (const filePath of changedFiles) {
      const protectedOrManual = matchesAny(filePath, readResult.policy.protectedFiles) || matchesAny(filePath, readResult.policy.manualApprovalRequiredFor);
      if (matchesAny(filePath, readResult.policy.blockedPaths)) {
        errors.push(`Changed file is blocked by policy: ${filePath}`);
      }

      if (protectedOrManual) {
        manualApprovalRequired = true;
        warnings.push(`Changed file requires manual approval: ${filePath}`);
      }

      if (readResult.policy.allowedPaths.length > 0 && !matchesAny(filePath, readResult.policy.allowedPaths) && !protectedOrManual) {
        errors.push(`Changed file is outside allowedPaths: ${filePath}`);
      }
    }

    return {
      valid: errors.length === 0,
      changedFiles,
      warnings,
      errors,
      manualApprovalRequired
    };
  }

  policyPath(projectPath: string): string {
    return path.join(path.resolve(projectPath), ".codex", "project-policy.json");
  }

  private validateTaskData(policy: ProjectPolicy, input: Pick<CreateTaskData, "goal" | "context" | "scope" | "outOfScope" | "filesAllowed" | "requiredChecks" | "notes">): PolicyValidationResult {
    const warnings: string[] = [];
    const errors: string[] = [];
    let manualApprovalRequired = false;
    const filesAllowed = input.filesAllowed ?? [];
    const requiredChecks = input.requiredChecks ?? [];
    const taskText = [input.goal, input.context, input.scope?.join("\n"), input.outOfScope?.join("\n"), input.notes].filter(Boolean).join("\n");

    for (const filePath of filesAllowed) {
      if (matchesAny(filePath, policy.blockedPaths)) {
        errors.push(`Files Allowed contains blocked path: ${filePath}`);
      }

      if (matchesAny(filePath, policy.protectedFiles) || matchesAny(filePath, policy.manualApprovalRequiredFor)) {
        manualApprovalRequired = true;
        warnings.push(`Files Allowed contains protected path requiring manual approval: ${filePath}`);
      }

      if (policy.allowedPaths.length > 0 && !matchesAny(filePath, policy.allowedPaths)) {
        warnings.push(`Files Allowed is outside allowedPaths: ${filePath}`);
      }
    }

    for (const command of requiredChecks) {
      if (matchesCommand(command, policy.blockedCommands)) {
        errors.push(`Required Checks contains blocked command: ${command}`);
      }

      if (matchesCommand(command, policy.sensitiveOutputCommands)) {
        errors.push(`Required Checks contains sensitive-output command: ${command}`);
      }
    }

    if (mentionsSensitiveAction(taskText)) {
      errors.push("Task appears to require reading or modifying .env, .codex, storage, or backups.");
    }

    return {
      valid: errors.length === 0,
      warnings,
      errors,
      manualApprovalRequired
    };
  }

  private async changedFiles(projectPath: string): Promise<string[]> {
    const diff = await safeExec(projectPath, "git diff --name-only", { maxOutputBytes: 80_000 });
    const staged = await safeExec(projectPath, "git diff --cached --name-only", { maxOutputBytes: 80_000 });
    const names = new Set<string>();

    for (const output of [diff.stdout, staged.stdout]) {
      for (const line of output.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)) {
        names.add(normalizePath(line));
      }
    }

    return [...names].sort();
  }
}

export function createPresetPolicy(projectPath: string, preset: PolicyPreset): ProjectPolicy {
  const projectName = path.basename(path.resolve(projectPath));
  const common = {
    version: 1 as const,
    projectName,
    defaultProfile: "default" as CheckProfile,
    defaultSmokeMode: "ephemeral" as DefaultSmokeMode,
    allowedPaths: ["README.md", "docs/**", "src/**", "tests/**"],
    blockedPaths: [".env", ".env.*", ".codex/**", "node_modules/**", "dist/**"],
    protectedFiles: [],
    allowedCommands: ["git status --short", "git diff --stat", "git diff --name-only"],
    blockedCommands: ["rm -rf", "del /s", "format", "shutdown"],
    requiredChecks: {
      docs: ["git status --short", "git diff --stat", "git diff --name-only"]
    },
    sensitiveOutputCommands: ["env", "set", "printenv"],
    manualApprovalRequiredFor: [".env*", ".codex/**"],
    privateFolders: [],
    workflow: {
      strictReviewGate: false,
      requireReviewReportBeforeApprove: true,
      maxReviewAgeMinutes: 60,
      requireCleanGitForApprove: false
    }
  };

  if (preset === "node") {
    return {
      ...common,
      allowedPaths: ["README.md", "docs/**", "src/**", "tests/**", "package.json", "package-lock.json", "tsconfig.json"],
      allowedCommands: [...common.allowedCommands, "npm run build", "npm test", "npm run lint"],
      requiredChecks: {
        ...common.requiredChecks,
        node: ["npm run build", "npm test", "npm run lint"]
      },
      workflow: {
        strictReviewGate: true,
        requireReviewReportBeforeApprove: true,
        maxReviewAgeMinutes: 60,
        requireCleanGitForApprove: false
      }
    };
  }

  if (preset === "docker-compose") {
    return {
      ...common,
      defaultProfile: "docker-compose",
      allowedPaths: ["README.md", "docs/**", "backend/**", "frontend/**", "scripts/**"],
      blockedPaths: [
        ".env",
        ".env.*",
        "storage/uploads/**",
        "storage/smoke-tests/**",
        "backups/**",
        ".codex/**",
        "node_modules/**",
        "dist/**"
      ],
      protectedFiles: ["docker-compose.yml", "compose.yml", "backend/alembic/**", "backend/migrations/**"],
      allowedCommands: [...common.allowedCommands, "docker compose ps", "docker compose version"],
      blockedCommands: [...common.blockedCommands, "docker compose config", "docker compose down -v", "docker compose rm", "docker volume rm"],
      requiredChecks: {
        docs: common.requiredChecks.docs,
        "docker-compose": ["docker compose ps"],
        backend: [],
        frontend: []
      },
      sensitiveOutputCommands: ["docker compose config", "env", "set", "printenv"],
      manualApprovalRequiredFor: ["docker-compose.yml", ".env*", "backend/alembic/**", "backend/migrations/**", "storage/**", "backups/**"],
      privateFolders: ["storage/uploads", "storage/smoke-tests", "backups"],
      workflow: {
        strictReviewGate: true,
        requireReviewReportBeforeApprove: true,
        maxReviewAgeMinutes: 60,
        requireCleanGitForApprove: false
      }
    };
  }

  return common;
}

function matchesAny(value: string, patterns: string[]): boolean {
  return patterns.some((pattern) => globMatch(value, pattern));
}

function globMatch(value: string, pattern: string): boolean {
  const normalizedValue = normalizePath(value);
  const normalizedPattern = normalizePath(pattern);
  const escaped = normalizedPattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "<<<GLOBSTAR>>>")
    .replace(/\*/g, "[^/]*")
    .replace(/<<<GLOBSTAR>>>/g, ".*");

  return new RegExp(`^${escaped}$`).test(normalizedValue);
}

function matchesCommand(command: string, patterns: string[]): boolean {
  const normalized = normalizeCommand(command);
  return patterns.some((pattern) => normalized === normalizeCommand(pattern) || normalized.startsWith(`${normalizeCommand(pattern)} `));
}

function normalizePath(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\.\//, "").trim();
}

function normalizeCommand(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function mentionsSensitiveAction(text: string): boolean {
  return /\b(read|cat|type|get-content|modify|change|edit|write|update)\b.*(\.env|\.codex|storage\/|storage\\|backups\/|backups\\)/i.test(text);
}

function sectionList(markdown: string, heading: string): string[] {
  return sectionText(markdown, heading)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2).trim())
    .filter((line) => line && line !== "Not specified.");
}

function sectionText(markdown: string, heading: string): string {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `## ${heading}`);
  if (start === -1) {
    return "";
  }

  const body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith("## ")) {
      break;
    }

    body.push(line);
  }

  return body.join("\n").trim();
}

async function exists(filePath: string): Promise<boolean> {
  return stat(filePath)
    .then(() => true)
    .catch(() => false);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
