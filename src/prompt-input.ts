/**
 * Shared prompt assembly: argv, --file (.txt / .md), and piped stdin.
 */
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

const ALLOWED = new Set([".txt", ".md"]);
const MAX_BYTES = 1_000_000;

export function assertPromptFilename(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (!ALLOWED.has(ext)) {
    throw new Error(
      `Prompt file must be .txt or .md (got "${ext || "no extension"}": ${filePath})`,
    );
  }
  return path.resolve(filePath);
}

export async function readPromptFile(filePath: string): Promise<string> {
  const resolved = assertPromptFilename(filePath);
  const info = await stat(resolved);
  if (!info.isFile()) {
    throw new Error(`Prompt path is not a file: ${resolved}`);
  }
  if (info.size > MAX_BYTES) {
    throw new Error(`Prompt file is too large (${info.size} bytes; max ${MAX_BYTES}): ${resolved}`);
  }
  const text = (await readFile(resolved, "utf8")).replace(/^\uFEFF/, "");
  if (!text.trim()) {
    throw new Error(`Prompt file is empty: ${resolved}`);
  }
  return text;
}

export function assemblePrompt(parts: {
  argv?: string;
  file?: string;
  stdin?: string;
}): string {
  return [parts.argv, parts.file, parts.stdin]
    .map((s) => (s ?? "").trim())
    .filter(Boolean)
    .join("\n\n")
    .trim();
}
