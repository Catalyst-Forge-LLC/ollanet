import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { defaultLastScanPath } from "./paths.ts";
import type { ScanPayload } from "./scan.ts";

export interface StoredScan extends ScanPayload {
  scanned_at: string;
  lan: boolean;
  include_offline: boolean;
}

/** Path for the last-scan snapshot. Read at call time so import stays safe. */
export function lastScanPath(): string {
  return process.env.OLLANET_LAST_SCAN ?? defaultLastScanPath();
}

export async function saveLastScan(
  payload: ScanPayload,
  meta: { lan: boolean; includeOffline: boolean },
): Promise<string> {
  const stored: StoredScan = {
    ...payload,
    scanned_at: new Date().toISOString(),
    lan: meta.lan,
    include_offline: meta.includeOffline,
  };
  const file = lastScanPath();
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(stored, null, 2)}\n`, "utf8");
  return file;
}

export async function loadLastScan(): Promise<StoredScan | null> {
  const file = lastScanPath();
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (err) {
    const code = err && typeof err === "object" && "code" in err ? (err as { code: string }).code : "";
    if (code === "ENOENT") return null;
    throw err;
  }
  const parsed = JSON.parse(text) as StoredScan;
  if (!parsed || !Array.isArray(parsed.servers)) {
    throw new Error(`Invalid last-scan file: ${file}`);
  }
  return parsed;
}

/** Last saved scan, or null if none. Does not probe the network. */
export async function lastScan(): Promise<StoredScan | null> {
  return loadLastScan();
}
