/**
 * Scan reachable networks for Ollama servers and list available models.
 *
 * Usage: ollanet scan [--lan] [--json] [--all] [--last]
 */

import { configFromPartial, loadConfig, type AppConfig } from "./config.ts";
import {
  discoverHosts,
  envInt,
  ollamaPort,
  shortName,
  type HostTarget,
} from "./hosts.ts";
import { lastScanPath, loadLastScan, saveLastScan, type StoredScan } from "./scan-store.ts";
import { looksTuned } from "./tuned.ts";

function scanTimeoutMs(): number {
  return envInt("OLLAMA_TIMEOUT_MS", 2500);
}

function scanConcurrency(): number {
  return Math.max(1, envInt("OLLAMA_CONCURRENCY", 16));
}

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
  const timeoutMs = scanTimeoutMs();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
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
        ? `timeout after ${scanTimeoutMs()}ms`
        : message;
    return { host, ok: false, models: [], error, url };
  }
}

function printPayload(payload: ScanPayload, cached?: StoredScan): void {
  if (cached?.scanned_at) {
    const flags = [
      cached.lan ? "lan" : null,
      cached.include_offline ? "all" : null,
    ].filter(Boolean);
    console.log(
      `Cached scan from ${cached.scanned_at}${flags.length ? ` (${flags.join(", ")})` : ""}`,
    );
    console.log(`File: ${lastScanPath()}\n`);
  }

  console.log(`Network: ${payload.network}`);
  console.log(`Discovery: ${payload.sources.join(", ") || "none"}`);
  console.log(`Probing Ollama on ${payload.scanned} host(s)\n`);

  if (payload.servers.length === 0) {
    console.log("No Ollama servers found.");
    console.log(
      "Tip: add hosts to config.json, set OLLANET_HOSTS, pass --lan, or prompt an IP directly.",
    );
    const interesting = (payload.failures ?? []).filter((f) => f.error !== "offline");
    if (interesting.length > 0) {
      console.log("\nNon-timeout failures (first few):");
      for (const f of interesting.slice(0, 5)) {
        console.log(`  - ${f.name} (${f.ip}): ${f.error}`);
      }
    }
    return;
  }

  for (const server of payload.servers) {
    const label = server.dnsName || server.hostname;
    const selfTag = server.self ? " [this device]" : "";
    console.log(`${label}${selfTag}`);
    console.log(`  IP: ${server.ip}  source: ${server.source}  OS: ${server.os}`);
    console.log(`  Endpoint: ${server.endpoint}`);
    if (server.models.length === 0) {
      console.log("  Models: (none)");
    } else {
      console.log(`  Models (${server.models.length}):`);
      for (const model of server.models) {
        const size = formatBytes(model.size);
        const params = model.parameter_size;
        const quant = model.quantization_level;
        const meta = [params, quant, size].filter(Boolean).join(" · ");
        const tag = model.tuned ? " [tuned]" : "";
        console.log(meta ? `    - ${model.name}  (${meta})${tag}` : `    - ${model.name}${tag}`);
      }
    }
    console.log("");
  }

  console.log(
    `Found ${payload.servers.length} Ollama server(s) with ${payload.servers.reduce((n, s) => n + s.models.length, 0)} model entrie(s).`,
  );
}

export interface ScanOptions {
  includeOffline?: boolean;
  /** TCP-scan local /24s for Ollama (port 11434 by default). Off unless set. */
  lanScan?: boolean;
  /**
   * In-memory config. When set, the config file (`~/.ollanet` / `OLLANET_CONFIG`)
   * is not read. Omit to keep CLI/MCP file behavior.
   */
  config?: Partial<AppConfig>;
  /**
   * Persist this result as the last scan. Default true when `config` is omitted
   * (CLI / MCP). Default false when `config` is passed (hermetic apps/tests).
   */
  save?: boolean;
}

export interface ScannedServer {
  hostname: string;
  dnsName: string;
  ip: string;
  port: number;
  os: string;
  source: string;
  self: boolean;
  endpoint: string;
  models: Array<{
    name: string;
    size?: number;
    modified_at?: string;
    parameter_size?: string;
    quantization_level?: string;
    family?: string;
    /** Name looks like a Finetuna-style host-side tune. */
    tuned: boolean;
  }>;
}

export interface ScanFailure {
  name: string;
  ip: string;
  error: string;
}

export interface ScanPayload {
  network: string;
  sources: string[];
  port: number;
  scanned: number;
  servers: ScannedServer[];
  failures?: ScanFailure[];
}

function toPayload(
  results: ScanResult[],
  networkLabel: string,
  sources: string[],
): ScanPayload {
  return {
    network: networkLabel,
    sources,
    port: ollamaPort(),
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
          tuned: looksTuned(m.name),
        })),
      })),
    failures: results
      .filter((r) => !r.ok)
      .map((r) => ({
        name: shortName(r.host),
        ip: r.host.ip,
        error: r.error ?? "unknown",
      })),
  };
}

/** Programmatic scan used by CLI `--json`, MCP, and `import { scanNetwork } from "ollanet"`. */
export async function scanNetwork(options: ScanOptions = {}): Promise<ScanPayload> {
  const config = options.config ? configFromPartial(options.config) : await loadConfig();
  const { hosts, sources, networkLabel } = await discoverHosts({
    hosts: config.hosts,
    discovery: config.discovery,
    includeOffline: options.includeOffline ?? false,
    lanScan: options.lanScan ?? false,
  });

  if (hosts.length === 0) {
    throw new Error(
      "No hosts to scan. Add config.hosts, set OLLANET_HOSTS, or enable Tailscale/LAN discovery.",
    );
  }

  const results = await mapPool(hosts, scanConcurrency(), scanHost);
  const payload = toPayload(results, networkLabel, sources);
  const shouldSave = options.save ?? options.config == null;
  if (shouldSave) {
    await saveLastScan(payload, {
      lan: options.lanScan ?? false,
      includeOffline: options.includeOffline ?? false,
    });
  }
  return payload;
}

export async function main(): Promise<void> {
  const includeOffline = process.argv.includes("--all");
  const jsonOut = process.argv.includes("--json");
  const lanScan = process.argv.includes("--lan");
  const cached = process.argv.includes("--last") || process.argv.includes("--cached");

  if (cached) {
    const stored = await loadLastScan();
    if (!stored) {
      console.error(`No saved scan at ${lastScanPath()}. Run ollanet scan first.`);
      process.exitCode = 1;
      return;
    }
    if (jsonOut) {
      console.log(JSON.stringify(stored, null, 2));
      return;
    }
    printPayload(stored, stored);
    return;
  }

  try {
    const payload = await scanNetwork({ includeOffline, lanScan });
    if (jsonOut) {
      console.log(JSON.stringify(payload, null, 2));
    } else {
      printPayload(payload);
    }
    if (payload.servers.length === 0) {
      process.exitCode = 2;
    }
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  }
}
