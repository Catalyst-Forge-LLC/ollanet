import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Package root: parent of `src/` in a checkout, parent of `dist/` when installed. */
export const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function projectPath(...parts: string[]): string {
  return path.join(PROJECT_ROOT, ...parts);
}

/**
 * True when running from an installed copy (npx cache, global install, or as a
 * dependency) rather than a source checkout. Installed copies always live under
 * a `node_modules` directory.
 */
export const IS_INSTALLED = PROJECT_ROOT.split(path.sep).includes("node_modules");

/** Per-user data dir used when installed (config + chat transcripts). */
export const USER_DIR = path.join(os.homedir(), ".ollanet");

/** Default config location: repo-local in a checkout, `~/.ollanet/` when installed. */
export function defaultConfigPath(): string {
  return IS_INSTALLED ? path.join(USER_DIR, "config.json") : projectPath("config.json");
}

/** Default transcript dir: repo-local in a checkout, `~/.ollanet/` when installed. */
export function defaultResponsesDir(): string {
  return IS_INSTALLED ? path.join(USER_DIR, "responses") : projectPath("responses");
}

/** Default benchmark results dir (mirrors responses layout). */
export function defaultBenchmarksDir(): string {
  return IS_INSTALLED ? path.join(USER_DIR, "benchmarks") : projectPath("benchmarks");
}

/** Last successful scan snapshot (single file). */
export function defaultLastScanPath(): string {
  return IS_INSTALLED ? path.join(USER_DIR, "last-scan.json") : projectPath("last-scan.json");
}

/** Head-to-head compare records (markdown + JSON). */
export function defaultComparesDir(): string {
  return IS_INSTALLED ? path.join(USER_DIR, "compares") : projectPath("compares");
}
