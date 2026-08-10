import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { defaultBenchmarksDir } from "./paths.ts";

const BENCH_DIR =
  process.env.OLLANET_BENCHMARKS_DIR ?? defaultBenchmarksDir();

export function benchmarksDir(): string {
  return BENCH_DIR;
}

export function newBenchId(): string {
  return randomBytes(6).toString("hex");
}

export async function saveBenchmark(result: unknown): Promise<string> {
  await mkdir(BENCH_DIR, { recursive: true });
  const id =
    result && typeof result === "object" && "id" in result && typeof (result as { id: unknown }).id === "string"
      ? (result as { id: string }).id
      : newBenchId();
  const file = path.join(BENCH_DIR, `${id}.json`);
  await writeFile(file, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  return file;
}
