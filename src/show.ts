/**
 * Inspect a model on a reachable Ollama host (Modelfile, params, capabilities).
 *
 *   ollanet show studio gemma4-ctx32k
 */

import { envInt, ollamaBaseUrl, shortName } from "./hosts.ts";
import { ollamaShow, type OllamaShowInfo } from "./ollama-chat.ts";
import { failUsage, isHelpFlag, printHelp, takeFlag } from "./argv.ts";
import { resolveTarget } from "./target.ts";
import { looksTuned } from "./tuned.ts";
import { expandMachineModel, loadConfig, type AppConfig } from "./config.ts";

function showTimeoutMs(): number {
  return envInt("OLLAMA_SHOW_TIMEOUT_MS", 30_000);
}

export function helpText(): string {
  return `Usage:
  ollanet show <machine> <model>
  ollanet show <alias>
  ollanet show --machine <name> --model <name>

Examples:
  ollanet show studio gemma4-ctx32k
  ollanet show desk
  ollanet show localhost llama3.2:1b --json

Reads /api/show on that host — Modelfile, parameters, capabilities.
Tuned Finetuna-style names are marked [tuned].
A single alias name expands to that alias's machine + model.

Options:
  --machine <name>   Host (discovered name, MagicDNS, hostname, or IP[:port])
  --model <name>     Model to inspect
  --json             Emit result JSON on stdout`;
}

function usage(): never {
  failUsage(helpText());
}

function parseArgs(argv: string[]): { machine?: string; model?: string; json: boolean } {
  const args = [...argv];
  let machineFlag: string | undefined;
  let modelFlag: string | undefined;
  let json = false;
  const positional: string[] = [];

  while (args.length > 0) {
    const arg = args.shift()!;
    if (arg === "--") continue;
    if (isHelpFlag(arg)) printHelp(helpText());
    if (arg === "--json") {
      json = true;
      continue;
    }
    const machine = takeFlag(arg, "--machine", args, usage);
    if (machine !== undefined) {
      machineFlag = machine;
      continue;
    }
    const model = takeFlag(arg, "--model", args, usage);
    if (model !== undefined) {
      modelFlag = model;
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
  return { machine, model, json };
}

export interface ShowOptions {
  machine: string;
  model: string;
  config?: Partial<AppConfig>;
  timeoutMs?: number;
}

export interface ShowResult {
  machine: string;
  model: string;
  endpoint: string;
  tuned: boolean;
  capabilities?: string[];
  modelfile?: string;
  parameters?: string;
  template?: string;
  system?: string;
  details?: OllamaShowInfo["details"];
  modified_at?: string;
}

export async function showModel(opts: ShowOptions): Promise<ShowResult> {
  const model = (opts.model ?? "").trim();
  if (!model) throw new Error("Model is required.");
  const host = await resolveTarget(opts.machine, opts.config);
  const info = await ollamaShow(ollamaBaseUrl(host), model, opts.timeoutMs ?? showTimeoutMs());
  const tuned = looksTuned(model, { modelfile: info.modelfile, parameters: info.parameters });
  return {
    machine: shortName(host),
    model,
    endpoint: ollamaBaseUrl(host),
    tuned,
    capabilities: info.capabilities,
    modelfile: info.modelfile,
    parameters: info.parameters,
    template: info.template,
    system: info.system,
    details: info.details,
    modified_at: info.modified_at,
  };
}

function printShow(result: ShowResult): void {
  const tag = result.tuned ? "  [tuned]" : "";
  process.stdout.write(`${result.machine}  ${result.model}${tag}\n`);
  process.stdout.write(`Endpoint: ${result.endpoint}\n`);
  const d = result.details;
  const meta = [d?.family, d?.parameter_size, d?.quantization_level].filter(Boolean).join(" · ");
  if (meta) process.stdout.write(`${meta}\n`);
  if (result.capabilities?.length) {
    process.stdout.write(`Capabilities: ${result.capabilities.join(", ")}\n`);
  }
  if (result.parameters?.trim()) {
    process.stdout.write(`\nParameters:\n${result.parameters.trimEnd()}\n`);
  }
  if (result.modelfile?.trim()) {
    process.stdout.write(`\nModelfile:\n${result.modelfile.trimEnd()}\n`);
  }
}

export async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  const config = await loadConfig();
  const expanded = expandMachineModel(config, parsed.machine, parsed.model);
  if (!expanded.machine || !expanded.model) {
    if (!expanded.machine) console.error("Machine is required.");
    else console.error("Model is required.");
    usage();
  }
  const result = await showModel({
    machine: expanded.machine,
    model: expanded.model,
    config,
  });
  if (parsed.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  printShow(result);
}
