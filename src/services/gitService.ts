import { safeExec } from "../utils/safeExec.js";

export type DiffMode = "summary" | "full" | "stat" | "names";

export interface DiffInspection {
  mode: DiffMode;
  status: string;
  output: string;
  truncated: boolean;
  hint?: string;
}

const maxDiffBytes = 80_000;

export class GitService {
  async inspectDiff(projectPath: string, mode: DiffMode = "summary"): Promise<DiffInspection> {
    const status = await safeExec(projectPath, "git status --short", { maxOutputBytes: maxDiffBytes });

    if (status.exitCode !== 0) {
      return {
        mode,
        status: status.stderr || status.stdout,
        output: "",
        truncated: false,
        hint: "projectPath does not appear to be a git repository."
      };
    }

    const names = await safeExec(projectPath, "git diff --name-only", { maxOutputBytes: maxDiffBytes });

    if (mode === "names") {
      return this.result(mode, status.stdout, names.stdout);
    }

    const stat = await safeExec(projectPath, "git diff --stat", { maxOutputBytes: maxDiffBytes });

    if (mode === "stat") {
      return this.result(mode, status.stdout, stat.stdout);
    }

    if (mode === "summary") {
      return this.result(mode, status.stdout, ["## git status --short", status.stdout, "## git diff --stat", stat.stdout].join("\n\n"));
    }

    if (containsEnvPath(names.stdout)) {
      return {
        mode,
        status: status.stdout,
        output: ["Diff contains .env-like files. Full content is not read by default.", "Use stat or names mode for safe review."].join(
          "\n"
        ),
        truncated: false,
        hint: "Blocked full diff content for .env-like paths."
      };
    }

    const full = await safeExec(projectPath, "git diff", { maxOutputBytes: maxDiffBytes });
    return this.result(mode, status.stdout, full.stdout);
  }

  private result(mode: DiffMode, status: string, output: string): DiffInspection {
    const truncated = output.includes("[output truncated");
    return {
      mode,
      status,
      output,
      truncated,
      hint: truncated ? "Diff output was long. Use summary, stat, or names mode for a smaller review." : undefined
    };
  }
}

function containsEnvPath(output: string): boolean {
  return output
    .split(/\r?\n/)
    .some((line) => /(^|[/\\])\.env(\.|$)|secret|secrets/i.test(line.trim()));
}
