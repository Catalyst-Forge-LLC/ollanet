#!/usr/bin/env node
/**
 * Scan the local Tailnet for Ollama servers and list available models.
 *
 * Requires the Tailscale CLI (`tailscale`) on PATH.
 * Usage: ollanet scan
 */

import {
  OLLAMA_PORT,
  collectTargets,
  getTailscaleStatus,
  type HostTarget,
} from "./tailnet.ts";

const TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_MS ?? 2500);
const CONCURRENCY = Number(process.env.OLLAMA_CONCURRENCY ?? 16);

interface OllamaModel {
  name: string;
  size?: number;
  modified_at?: string;
  details?: {
    parameter_size?: string;
    quantization_level?: string;
    family?: string;
  };
}

interface OllamaTagsResponse {
  models?: OllamaModel[];
}

interface ScanResult {
  host: HostTarget;
  ok: boolean;
  models: OllamaModel[];
  error?: string;
  url: string;
}

function formatBytes(bytes: number | undefined): string {
  if (bytes == null || !Number.isFinite(bytes)) return "";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

async function fetchModels(ip: string): Promise<{ models: OllamaModel[]; url: string }> {
  const url = `http://${ip}:${OLLAMA_PORT}/api/tags`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }
    const body = (await res.json()) as OllamaTagsResponse;
    return { models: body.models ?? [], url };
  } finally {
    clearTimeout(timer);
  }
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;

  async function run(): Promise<void> {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index]!);
    }
  }

  const runners = Array.from({ length: Math.min(concurrency, items.length) }, () => run());
  await Promise.all(runners);
  return results;
}

async function scanHost(host: HostTarget): Promise<ScanResult> {
  const url = `http://${host.ip}:${OLLAMA_PORT}/api/tags`;
  if (!host.online && !host.isSelf) {
    return { host, ok: false, models: [], error: "offline", url };
  }
  try {
    const { models } = await fetchModels(host.ip);
    return { host, ok: true, models, url };
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    const message = err instanceof Error ? err.message : String(err);
    const error =
      name === "AbortError" || message.toLowerCase().includes("abort")
        ? `timeout after ${TIMEOUT_MS}ms`
        : message;
    return { host, ok: false, models: [], error, url };
  }
}

function printResults(results: ScanResult[], tailnetName: string): void {
  const found = results.filter((r) => r.ok);
  const offline = results.filter((r) => r.error === "offline").length;
  const probed = results.length - offline;

  console.log(`Tailnet: ${tailnetName}`);
  console.log(`Probing port ${OLLAMA_PORT} on ${results.length} peer(s) (${probed} online/reachable candidates)\n`);

  if (found.length === 0) {
    console.log("No Ollama servers found on the Tailnet.");
    const interesting = results.filter((r) => r.error && r.error !== "offline");
    if (interesting.length > 0) {
      console.log("\nNon-timeout failures (first few):");
      for (const r of interesting.slice(0, 5)) {
        console.log(`  - ${r.host.hostname} (${r.host.ip}): ${r.error}`);
      }
    }
    return;
  }

  for (const result of found) {
    const label = result.host.dnsName || result.host.hostname;
    const selfTag = result.host.isSelf ? " [this device]" : "";
    console.log(`${label}${selfTag}`);
    console.log(`  IP: ${result.host.ip}  OS: ${result.host.os}`);
    console.log(`  Endpoint: http://${result.host.ip}:${OLLAMA_PORT}`);
    if (result.models.length === 0) {
      console.log("  Models: (none)");
    } else {
      console.log(`  Models (${result.models.length}):`);
      for (const model of result.models) {
        const size = formatBytes(model.size);
        const params = model.details?.parameter_size;
        const quant = model.details?.quantization_level;
        const meta = [params, quant, size].filter(Boolean).join(" · ");
        console.log(meta ? `    - ${model.name}  (${meta})` : `    - ${model.name}`);
      }
    }
    console.log("");
  }

  console.log(`Found ${found.length} Ollama server(s) with ${found.reduce((n, r) => n + r.models.length, 0)} model entrie(s).`);
}

export async function main(): Promise<void> {
  const includeOffline = process.argv.includes("--all");
  const jsonOut = process.argv.includes("--json");

  const status = await getTailscaleStatus();
  const tailnetName =
    status.CurrentTailnet?.Name ??
    status.MagicDNSSuffix ??
    status.CurrentTailnet?.MagicDNSSuffix ??
    "unknown";

  let targets = collectTargets(status);
  if (!includeOffline) {
    targets = targets.filter((t) => t.online || t.isSelf);
  }

  if (targets.length === 0) {
    console.error("No Tailscale peers found.");
    process.exitCode = 1;
    return;
  }

  const results = await mapPool(targets, CONCURRENCY, scanHost);

  if (jsonOut) {
    console.log(
      JSON.stringify(
        {
          tailnet: tailnetName,
          port: OLLAMA_PORT,
          scanned: results.length,
          servers: results
            .filter((r) => r.ok)
            .map((r) => ({
              hostname: r.host.hostname,
              dnsName: r.host.dnsName,
              ip: r.host.ip,
              os: r.host.os,
              self: r.host.isSelf,
              endpoint: `http://${r.host.ip}:${OLLAMA_PORT}`,
              models: r.models.map((m) => ({
                name: m.name,
                size: m.size,
                modified_at: m.modified_at,
                parameter_size: m.details?.parameter_size,
                quantization_level: m.details?.quantization_level,
                family: m.details?.family,
              })),
            })),
        },
        null,
        2,
      ),
    );
    return;
  }

  printResults(results, tailnetName);
  if (!results.some((r) => r.ok)) {
    process.exitCode = 2;
  }
}
