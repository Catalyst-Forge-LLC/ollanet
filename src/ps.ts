/**
 * List models currently loaded in VRAM on reachable Ollama hosts.
 *
 *   ollanet ps
 *   ollanet ps studio
 */

import { configFromPartial, loadConfig, type AppConfig } from "./config.ts";
import {
  discoverHosts,
  envInt,
  ollamaBaseUrl,
  shortName,
  type HostTarget,
} from "./hosts.ts";
import { ollamaPs, ollamaPsRequired, type PsModel } from "./ollama-chat.ts";
import { resolveTarget } from "./target.ts";
import { looksTuned } from "./tuned.ts";

function psTimeoutMs(): number {
  return envInt("OLLAMA_PS_TIMEOUT_MS", 10_000);
}

function usage(): never {
  console.error(`Usage:
  ollanet ps [machine]
  ollanet ps --machine <name>

Examples:
  ollanet ps
  ollanet ps studio
  ollanet ps studio --json

scan lists models on disk. ps lists what is loaded in VRAM right now.

Options:
  --machine <name>   One host (default: every discovered host)
  --json             Emit result JSON on stdout`);
  process.exit(1);
}

function takeValue(args: string[], flag: string): string {
  const value = args.shift();
  if (!value) {
    console.error(`${flag} requires a value`);
    usage();
  }
  return value;
}

function parseArgs(argv: string[]): { machine?: string; json: boolean } {
  const args = [...argv];
  let machineFlag: string | undefined;
  let json = false;
  const positional: string[] = [];

  while (args.length > 0) {
    const arg = args.shift()!;
    if (arg === "--") continue;
    if (arg === "--help" || arg === "-h") usage();
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--machine") {
      machineFlag = takeValue(args, "--machine");
      continue;
    }
    if (arg.startsWith("-")) {
      console.error(`Unknown flag: ${arg}`);
      usage();
    }
    positional.push(arg);
  }

  if (positional.length > 1 || (machineFlag && positional.length > 0)) {
    console.error("Too many arguments.");
    usage();
  }
  return { machine: machineFlag ?? positional[0], json };
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

export interface LoadedModel {
  name: string;
  size_vram?: number;
  context_length?: number;
  digest?: string;
  tuned: boolean;
}

export interface LoadedHost {
  machine: string;
  endpoint: string;
  ok: boolean;
  error?: string;
  models: LoadedModel[];
}

export interface PsOptions {
  machine?: string;
  config?: Partial<AppConfig>;
  timeoutMs?: number;
}

export interface PsResult {
  hosts: LoadedHost[];
}

function toLoaded(m: PsModel): LoadedModel {
  const name = (m.name ?? m.model ?? "").trim();
  return {
    name,
    size_vram: m.size_vram,
    context_length: m.context_length,
    digest: m.digest,
    tuned: looksTuned(name),
  };
}

async function psHost(host: HostTarget, timeoutMs: number, required: boolean): Promise<LoadedHost> {
  const endpoint = ollamaBaseUrl(host);
  try {
    const models = required
      ? await ollamaPsRequired(endpoint, timeoutMs)
      : await ollamaPs(endpoint, timeoutMs);
    return {
      machine: shortName(host),
      endpoint,
      ok: true,
      models: models.map(toLoaded).filter((m) => m.name),
    };
  } catch (err) {
    return {
      machine: shortName(host),
      endpoint,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      models: [],
    };
  }
}

export async function listLoaded(opts: PsOptions = {}): Promise<PsResult> {
  const timeoutMs = opts.timeoutMs ?? psTimeoutMs();
  if (opts.machine?.trim()) {
    const host = await resolveTarget(opts.machine, opts.config);
    const row = await psHost(host, timeoutMs, true);
    if (!row.ok) throw new Error(row.error ?? `ps failed on ${row.machine}`);
    return { hosts: [row] };
  }

  const app = opts.config ? configFromPartial(opts.config) : await loadConfig();
  const { hosts } = await discoverHosts({
    hosts: app.hosts,
    discovery: app.discovery,
  });
  const rows = await Promise.all(
    hosts
      .filter((h) => h.online || h.isSelf || h.source !== "tailscale")
      .map((h) => psHost(h, timeoutMs, false)),
  );
  return { hosts: rows.filter((r) => r.ok) };
}

function printPs(result: PsResult): void {
  if (result.hosts.length === 0) {
    process.stdout.write("No hosts reported loaded models.\n");
    return;
  }
  for (const host of result.hosts) {
    process.stdout.write(`${host.machine}  ${host.endpoint}\n`);
    if (host.models.length === 0) {
      process.stdout.write("  (nothing loaded)\n");
    } else {
      for (const m of host.models) {
        const vram = formatBytes(m.size_vram);
        const ctx = m.context_length != null ? `ctx ${m.context_length}` : "";
        const tag = m.tuned ? " [tuned]" : "";
        const meta = [vram ? `VRAM ${vram}` : "", ctx].filter(Boolean).join("  ");
        process.stdout.write(meta ? `  ${m.name}  ${meta}${tag}\n` : `  ${m.name}${tag}\n`);
      }
    }
    process.stdout.write("\n");
  }
}

export async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  const result = await listLoaded({ machine: parsed.machine });
  if (parsed.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  printPs(result);
}
