/**
 * Delete a model from a reachable Ollama host.
 *
 *   ollanet rm studio llama3.2:1b --yes
 */

import { createInterface } from "node:readline";
import { envInt, ollamaBaseUrl, shortName } from "./hosts.ts";
import { ollamaDelete } from "./ollama-chat.ts";
import { resolveTarget } from "./target.ts";
import type { AppConfig } from "./config.ts";

function rmTimeoutMs(): number {
  return envInt("OLLAMA_RM_TIMEOUT_MS", 30_000);
}

function usage(): never {
  console.error(`Usage:
  ollanet rm <machine> <model> --yes
  ollanet rm --machine <name> --model <name> --yes

Examples:
  ollanet rm studio llama3.2:1b --yes
  ollanet rm localhost old-model:7b --yes --json

Deletes the named model from that host's disk (POST /api/delete).
Non-interactive use (pipes, MCP, CI) requires --yes / confirm: true.

Options:
  --machine <name>   Host (discovered name, MagicDNS, hostname, or IP[:port])
  --model <name>     Model to delete
  --yes              Required unless stdin is a TTY and you confirm
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

function parseArgs(argv: string[]): {
  machine?: string;
  model?: string;
  yes: boolean;
  json: boolean;
} {
  const args = [...argv];
  let machineFlag: string | undefined;
  let modelFlag: string | undefined;
  let yes = false;
  let json = false;
  const positional: string[] = [];

  while (args.length > 0) {
    const arg = args.shift()!;
    if (arg === "--") continue;
    if (arg === "--help" || arg === "-h") usage();
    if (arg === "--yes" || arg === "-y") {
      yes = true;
      continue;
    }
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--machine") {
      machineFlag = takeValue(args, "--machine");
      continue;
    }
    if (arg === "--model") {
      modelFlag = takeValue(args, "--model");
      continue;
    }
    if (arg.startsWith("-")) {
      console.error(`Unknown flag: ${arg}`);
      usage();
    }
    positional.push(arg);
  }

  const machine = machineFlag ?? positional[0];
  const model = modelFlag ?? (machineFlag ? positional[0] : positional[1]);
  if (positional.length > 2 || (machineFlag && modelFlag && positional.length > 0)) {
    console.error("Too many arguments.");
    usage();
  }
  return { machine, model, yes, json };
}

async function confirmDelete(machine: string, model: string, yes: boolean): Promise<void> {
  if (yes) return;
  if (!process.stdin.isTTY || !process.stderr.isTTY) {
    throw new Error(`Refusing to delete ${model} on ${machine} without --yes.`);
  }
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  const answer = await new Promise<string>((resolve) => {
    rl.question(`Delete ${model} on ${machine}? [y/N] `, resolve);
  });
  rl.close();
  if (!/^\s*y(es)?\s*$/i.test(answer)) {
    throw new Error("Aborted.");
  }
}

export interface RemoveOptions {
  machine: string;
  model: string;
  /** Must be true unless the caller is an interactive TTY confirm. */
  yes?: boolean;
  config?: Partial<AppConfig>;
  timeoutMs?: number;
}

export interface RemoveResult {
  machine: string;
  model: string;
  endpoint: string;
  deleted: true;
}

export async function removeModel(opts: RemoveOptions): Promise<RemoveResult> {
  const model = (opts.model ?? "").trim();
  const machineQuery = (opts.machine ?? "").trim();
  if (!machineQuery) throw new Error("Machine is required.");
  if (!model) throw new Error("Model is required.");
  await confirmDelete(machineQuery, model, opts.yes === true);
  const host = await resolveTarget(machineQuery, opts.config);
  await ollamaDelete(ollamaBaseUrl(host), model, opts.timeoutMs ?? rmTimeoutMs());
  return {
    machine: shortName(host),
    model,
    endpoint: ollamaBaseUrl(host),
    deleted: true,
  };
}

export async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  if (!parsed.machine || !parsed.model) {
    if (!parsed.machine) console.error("Machine is required.");
    else console.error("Model is required.");
    usage();
  }
  const result = await removeModel({
    machine: parsed.machine,
    model: parsed.model,
    yes: parsed.yes,
  });
  if (parsed.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  process.stdout.write(`deleted ${result.model} on ${result.machine}\n`);
}
