import { appendFile, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { ensureCodexStructure } from "../utils/paths.js";

export interface DecisionEntry {
  taskId?: string;
  type: string;
  title: string;
  body: string;
}

export class ArchitectLog {
  async record(projectPath: string, entry: DecisionEntry): Promise<string> {
    const paths = await ensureCodexStructure(projectPath);
    const timestamp = new Date().toISOString();
    const safeType = entry.type.replace(/[^a-z0-9_-]/gi, "-").toLowerCase();
    const safeTimestamp = timestamp.replace(/[:.]/g, "-");
    const fileName = entry.taskId ? `${entry.taskId}-${safeType}.md` : `${safeTimestamp}-${safeType}.md`;
    const decisionPath = path.join(paths.decisionsDir, fileName);
    const markdown = [
      `# ${entry.title}`,
      "",
      `- Type: ${entry.type}`,
      entry.taskId ? `- Task: ${entry.taskId}` : undefined,
      `- Created: ${timestamp}`,
      "",
      "## Decision",
      "",
      entry.body.trim(),
      ""
    ]
      .filter((line): line is string => line !== undefined)
      .join("\n");

    await writeFile(decisionPath, markdown, "utf8");
    await appendFile(path.join(paths.decisionsDir, "architect-log.md"), markdown + "\n---\n", "utf8");

    return decisionPath;
  }

  async read(projectPath: string): Promise<string> {
    const paths = await ensureCodexStructure(projectPath);
    return readFile(path.join(paths.decisionsDir, "architect-log.md"), "utf8").catch((error: unknown) => {
      if (isNodeError(error) && error.code === "ENOENT") {
        return "";
      }

      throw error;
    });
  }

  async recent(projectPath: string, limit = 5): Promise<string[]> {
    const paths = await ensureCodexStructure(projectPath);
    const files = await readdir(paths.decisionsDir).catch(() => []);
    return files
      .filter((file) => file.endsWith(".md") && file !== "architect-log.md")
      .sort()
      .slice(-limit);
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
