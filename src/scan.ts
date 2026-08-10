#!/usr/bin/env node
/**
 * Scan reachable networks for Ollama servers and list available models.
 *
 * Usage: ollanet scan [--lan] [--json] [--all]
 */

import { loadConfig } from "./config.ts";
import {
  OLLAMA_PORT,
  discoverHosts,
  envInt,
  shortName,
  type HostTarget,
} from "./hosts.ts";

const TIMEOUT_MS = envInt("OLLAMA_TIMEOUT_MS", 2500);
const CONCURRENCY = Math.max(1, envInt("OLLAMA_CONCURRENCY", 16));

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

async function fetchModels(host: HostTarget): Promise<{ models: OllamaModel[]; url: string }> {
  const url = `http://${host.ip.includes(":") ? `[${host.ip}]` : host.ip}:${host.port}/api/tags`;
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
  const url = `http://${host.ip}:${host.port}/api/tags`;
  if (!host.online && !host.isSelf && host.source === "tailscale") {
    return { host, ok: false, models: [], error: "offline", url };
  }
  try {
    const { models } = await fetchModels(host);
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

function printResults(
  results: ScanResult[],
  networkLabel: string,
  sources: string[],
): void {
  const found = results.filter((r) => r.ok);
  const offline = results.filter((r) => r.error === "offline").length;
  const probed = results.length - offline;

  console.log(`Network: ${networkLabel}`);
  console.log(`Discovery: ${sources.join(", ") || "none"}`);
  console.log(
    `Probing Ollama on ${results.length} host(s) (${probed} online/reachable candidates)\n`,
  );

  if (found.length === 0) {
    console.log("No Ollama servers found.");
    console.log(
      "Tip: add hosts to config.json, set OLLANET_HOSTS, pass --lan, or prompt an IP directly.",
    );
    const interesting = results.filter((r) => r.error && r.error !== "offline");
    if (interesting.length > 0) {
      console.log("\nNon-timeout failures (first few):");
      for (const r of interesting.slice(0, 5)) {
        console.log(`  - ${shortName(r.host)} (${r.host.ip}): ${r.error}`);
      }
    }
    return;
  }

  for (const result of found) {
    const label = result.host.dnsName || result.host.hostname;
    const selfTag = result.host.isSelf ? " [this device]" : "";
    console.log(`${label}${selfTag}`);
    console.log(
      `  IP: ${result.host.ip}  source: ${result.host.source}  OS: ${result.host.os}`,
    );
    console.log(`  Endpoint: http://${result.host.ip}:${result.host.port}`);
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

  console.log(
    `Found ${found.length} Ollama server(s) with ${found.reduce((n, r) => n + r.models.length, 0)} model entrie(s).`,
  );
}

export async function main(): Promise<void> {
  const includeOffline = process.argv.includes("--all");
  const jsonOut = process.argv.includes("--json");
  const lanScan = process.argv.includes("--lan");

  const config = await loadConfig();
  const { hosts, sources, networkLabel } = await discoverHosts({
    hosts: config.hosts,
    discovery: config.discovery,
    includeOffline,
    lanScan,
  });

  if (hosts.length === 0) {
    console.error("No hosts to scan. Add config.hosts, set OLLANET_HOSTS, or enable Tailscale/LAN discovery.");
    process.exitCode = 1;
    return;
  }

  const results = await mapPool(hosts, CONCURRENCY, scanHost);

  if (jsonOut) {
    console.log(
      JSON.stringify(
        {
          network: networkLabel,
          sources,
          port: OLLAMA_PORT,
          scanned: results.length,
          servers: results
            .filter((r) => r.ok)
            .map((r) => ({
              hostname: r.host.hostname,
              dnsName: r.host.dnsName,
              ip: r.host.ip,
              port: r.host.port,
              os: r.host.os,
              source: r.host.source,
              self: r.host.isSelf,
              endpoint: `http://${r.host.ip}:${r.host.port}`,
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

  printResults(results, networkLabel, sources);
  if (!results.some((r) => r.ok)) {
    process.exitCode = 2;
  }
}
