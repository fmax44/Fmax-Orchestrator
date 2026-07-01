import * as fs from "node:fs/promises";
import path from "node:path";

export async function readUtf8File(filePath: string): Promise<string> {
  return stripUtf8Bom(await fs.readFile(filePath, "utf8"));
}

export async function writeUtf8FileAtomic(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`
  );

  await fs.writeFile(tempPath, content, "utf8");

  try {
    await fs.rename(tempPath, filePath);
  } catch (error: unknown) {
    const nodeError = asNodeError(error);
    if (nodeError?.code !== "EEXIST" && nodeError?.code !== "EPERM") {
      await fs.rm(tempPath, { force: true }).catch(() => undefined);
      throw error;
    }

    await retryLockedFileOperation(() => fs.writeFile(filePath, content, "utf8"));
  } finally {
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
  }
}

export function stripUtf8Bom(value: string): string {
  return value.replace(/^\uFEFF/, "");
}

function asNodeError(error: unknown): NodeJS.ErrnoException | undefined {
  return error instanceof Error && "code" in error ? (error as NodeJS.ErrnoException) : undefined;
}

async function retryLockedFileOperation<T>(operation: () => Promise<T>, attempts = 5): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error: unknown) {
      const nodeError = asNodeError(error);
      if (nodeError?.code !== "EPERM" && nodeError?.code !== "EACCES" && nodeError?.code !== "EBUSY") {
        throw error;
      }

      lastError = error;
      await sleep(50 * (attempt + 1));
    }
  }

  throw lastError;
}

async function sleep(durationMs: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, durationMs));
}
