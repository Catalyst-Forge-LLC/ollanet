import path from "node:path";
import { fileURLToPath } from "node:url";

/** Project root (parent of `src/`). */
export const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function projectPath(...parts: string[]): string {
  return path.join(PROJECT_ROOT, ...parts);
}
