/**
 * Scan reachable networks for Ollama servers and list available models.
 *
 * Usage: ollanet scan [--lan] [--json] [--all] [--last]
 */

import { configFromPartial, loadConfig, type AppConfig } from "./config.ts";
import {
  discoverHosts,
  envInt,
  ollamaBaseUrl,
  ollamaPort,
  shortName,
  type HostTarget,
} from "./hosts.ts";
import { lastScanPath, loadLastScan, saveLastScan, type StoredScan } from "./scan-store.ts";
import { looksTuned } from "./tuned.ts";
import { isHelpFlag, printHelp } from "./argv.ts";

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
  code?: ScanFailureCode;
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
  const url = `${ollamaBaseUrl(host)}/api/tags`;
  const timeoutMs = scanTimeoutMs();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      throw new ProbeError(
        res.status === 404
          ? "HTTP 404, no /api/tags (not Ollama?)"
          : `HTTP ${res.status} ${res.statusText}`.trim(),
        "http",
      );
    }
    let body: OllamaTagsResponse;
    try {
      body = (await res.json()) as OllamaTagsResponse;
    } catch {
      throw new ProbeError("non-JSON reply (not Ollama?)", "not-ollama");
    }
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
  const url = `${ollamaBaseUrl(host)}/api/tags`;
  if (!host.online && !host.isSelf && host.source === "tailscale") {
    return { host, ok: false, models: [], error: "offline", code: "offline", url };
  }
  try {
    const { models } = await fetchModels(host);
    return { host, ok: true, models, url };
  } catch (err) {
    const { error, code } = describeProbeError(err, scanTimeoutMs());
    return { host, ok: false, models: [], error, code, url };
  }
}

/** Probe failure with a short reason code (see {@link ScanFailureCode}). */
class ProbeError extends Error {
  constructor(
    message: string,
    readonly code: ScanFailureCode,
  ) {
    super(message);
  }
}

const SOCKET_CODES: Record<string, { code: ScanFailureCode; label: string }> = {
  ECONNREFUSED: { code: "refused", label: "connection refused" },
  ECONNRESET: { code: "reset", label: "connection reset" },
  UND_ERR_SOCKET: { code: "reset", label: "connection closed" },
  EHOSTUNREACH: { code: "unreachable", label: "host unreachable" },
  ENETUNREACH: { code: "unreachable", label: "network unreachable" },
  EHOSTDOWN: { code: "unreachable", label: "host down" },
  ENOTFOUND: { code: "dns", label: "DNS lookup failed" },
  EAI_AGAIN: { code: "dns", label: "DNS lookup failed" },
  ETIMEDOUT: { code: "timeout", label: "connect timed out" },
  UND_ERR_CONNECT_TIMEOUT: { code: "timeout", label: "connect timed out" },
};

/**
 * Turn a failed /api/tags probe into a short reason. Node's fetch reports
 * socket errors as a bare "fetch failed" with the real code on `cause`.
 */
export function describeProbeError(
  err: unknown,
  timeoutMs: number,
): { error: string; code: ScanFailureCode } {
  if (err instanceof ProbeError) return { error: err.message, code: err.code };
  const name = err instanceof Error ? err.name : "";
  const message = err instanceof Error ? err.message : String(err);
  if (name === "AbortError" || name === "TimeoutError" || message.toLowerCase().includes("abort")) {
    return { error: `timeout after ${timeoutMs}ms`, code: "timeout" };
  }
  const cause = err instanceof Error ? (err as Error & { cause?: unknown }).cause : undefined;
  const sysCode = [cause, err]
    .map((e) => (e && typeof e === "object" && "code" in e ? String((e as { code: unknown }).code) : ""))
    .find(Boolean);
  const known = sysCode ? SOCKET_CODES[sysCode] : undefined;
  if (known && sysCode) return { error: `${known.label} (${sysCode})`, code: known.code };
  const causeMessage = cause instanceof Error ? cause.message : "";
  const detail = causeMessage && causeMessage !== message ? `${message}: ${causeMessage}` : message;
  return { error: sysCode ? `${detail} (${sysCode})` : detail, code: "error" };
}

function failureLabel(f: ScanFailure, port: number): string {
  const ip = f.ip.includes(":") ? `[${f.ip}]` : f.ip;
  const addr = f.port != null && f.port !== port ? `${ip}:${f.port}` : f.ip;
  return f.name && f.name !== f.ip ? `${f.name} (${addr})` : addr;
}

/**
 * Compact "who didn't answer" block. Offline Tailscale peers (only listed with
 * --all, never probed) collapse to a count; the rest show name, address, reason.
 */
function printFailures(payload: ScanPayload): void {
  const failures = payload.failures ?? [];
  const offline = failures.filter((f) => f.error === "offline");
  const probed = failures.filter((f) => f.error !== "offline");
  const limit = 5;
  if (probed.length === 1) {
    const f = probed[0]!;
    console.log(`No answer from 1 host: ${failureLabel(f, payload.port)}, ${f.error}`);
  } else if (probed.length > 1) {
    console.log(`No answer from ${probed.length} hosts:`);
    for (const f of probed.slice(0, limit)) {
      console.log(`  - ${failureLabel(f, payload.port)}: ${f.error}`);
    }
    if (probed.length > limit) {
      console.log(`  … ${probed.length - limit} more (ollanet scan --json lists all)`);
    }
  }
  if (offline.length > 0) {
    console.log(`Offline Tailscale peers (not probed): ${offline.length}`);
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
    if ((payload.failures ?? []).length > 0) {
      console.log("");
      printFailures(payload);
    }
    return;
  }

  for (const server of payload.servers) {
    const label = server.dnsName || server.hostname;
    const selfTag = server.self ? " [this device]" : "";
    const also = server.also?.length ? `  also: ${server.also.join(", ")}` : "";
    console.log(`${label}${selfTag}`);
    console.log(`  IP: ${server.ip}${also}  source: ${server.source}  OS: ${server.os}`);
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
  printFailures(payload);
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
  /** Extra IPs for the same instance (loopback + Tailscale Self, etc.). */
  also?: string[];
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

/**
 * Why a host did not answer as Ollama. `offline` = Tailscale peer marked
 * offline (not probed); `http` / `not-ollama` = something answered, but not
 * an Ollama API; `error` = anything else (see `error` text).
 */
export type ScanFailureCode =
  | "timeout"
  | "refused"
  | "reset"
  | "unreachable"
  | "dns"
  | "http"
  | "not-ollama"
  | "offline"
  | "error";

export interface ScanFailure {
  name: string;
  ip: string;
  /** Human-readable reason, e.g. "timeout after 2500ms", "connection refused (ECONNREFUSED)". */
  error: string;
  /** Port probed (added in 0.6.25; absent in older saved scans). */
  port?: number;
  /** Short machine-readable reason (added in 0.6.25; absent in older saved scans). */
  code?: ScanFailureCode;
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
        ...(r.host.also?.length ? { also: r.host.also } : {}),
        port: r.host.port,
        os: r.host.os,
        source: r.host.source,
        self: r.host.isSelf,
        endpoint: ollamaBaseUrl(r.host),
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
        port: r.host.port,
        code: r.code ?? "error",
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

export function helpText(): string {
  return `Usage:
  ollanet scan [--json] [--all] [--lan] [--last]

Examples:
  ollanet scan
  ollanet scan --lan
  ollanet scan --last
  ollanet scan --json

Discovers Ollama hosts (localhost, config, OLLANET_HOSTS, Tailscale) and lists
models. --lan is an opt-in TCP sweep of local /24s on port 11434.

Options:
  --json     Machine-readable output
  --all      Also probe offline Tailscale peers
  --lan      TCP-scan local LAN CIDRs for open Ollama ports
  --last     Reprint the last saved scan (no network)
  --cached   Same as --last`;
}

export async function main(): Promise<void> {
  if (process.argv.slice(2).some((arg) => isHelpFlag(arg))) {
    printHelp(helpText());
  }

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
