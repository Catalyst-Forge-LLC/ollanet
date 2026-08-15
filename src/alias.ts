/**
 * Manage machine+model aliases in config.
 *
 *   ollanet alias list
 *   ollanet alias add <name> <machine> <model>
 *   ollanet alias rm <name>
 */

import {
  configPath,
  isValidAliasName,
  loadConfig,
  mutateConfigFile,
  type ModelAlias,
} from "./config.ts";
import { failUsage, isHelpFlag, printHelp } from "./argv.ts";

export function helpText(): string {
  return `Usage:
  ollanet alias list
  ollanet alias add <name> <machine> <model>
  ollanet alias rm <name>

Shortcuts for frequent machine + model pairs. After adding:

  ollanet prompt <name> "hello"
  ollanet pull <name>
  ollanet show <name>
  ollanet bench <name>

An explicit model still overrides the alias (e.g. \`ollanet prompt desk other:7b "hi"\`).
Alias names are case-insensitive (stored lowercase). They take priority over a
host with the same short name when used as the first token.

Options:
  --json   Machine-readable output (list only)`;
}

function usage(): never {
  failUsage(helpText());
}

function pad(value: string, width: number): string {
  if (value.length >= width) return `${value.slice(0, width - 1)}…`;
  return value.padEnd(width);
}

function printTable(aliases: Record<string, ModelAlias>): void {
  const names = Object.keys(aliases).sort();
  if (names.length === 0) {
    console.log(`No aliases in ${configPath()}`);
    console.log(`Add one with: ollanet alias add <name> <machine> <model>`);
    return;
  }

  console.log(`${pad("ALIAS", 16)} ${pad("MACHINE", 20)} MODEL`);
  for (const name of names) {
    const a = aliases[name]!;
    console.log(`${pad(name, 16)} ${pad(a.machine, 20)} ${a.model}`);
  }
}

async function cmdList(json: boolean): Promise<void> {
  const config = await loadConfig();
  if (json) {
    console.log(JSON.stringify(config.aliases, null, 2));
    return;
  }
  printTable(config.aliases);
}

async function cmdAdd(name: string, machine: string, model: string): Promise<void> {
  const key = name.trim().toLowerCase();
  if (!isValidAliasName(key)) {
    throw new Error(
      `Invalid alias name "${name}". Use letters, digits, _ or - (must start with a letter).`,
    );
  }
  const machineTrim = machine.trim();
  const modelTrim = model.trim();
  if (!machineTrim || !modelTrim) {
    throw new Error("Machine and model are required.");
  }

  await mutateConfigFile((file) => {
    const prev =
      file.aliases && typeof file.aliases === "object" && !Array.isArray(file.aliases)
        ? { ...(file.aliases as Record<string, unknown>) }
        : {};
    prev[key] = { machine: machineTrim, model: modelTrim };
    file.aliases = prev;
  });

  console.log(`Alias "${key}" → ${machineTrim} / ${modelTrim}`);
  console.log(`Saved ${configPath()}`);
}

async function cmdRm(name: string): Promise<void> {
  const key = name.trim().toLowerCase();
  if (!key) usage();

  let removed = false;
  await mutateConfigFile((file) => {
    if (!file.aliases || typeof file.aliases !== "object" || Array.isArray(file.aliases)) {
      return;
    }
    const map = file.aliases as Record<string, unknown>;
    if (key in map) {
      delete map[key];
      removed = true;
    }
    file.aliases = map;
  });

  if (!removed) {
    throw new Error(`No alias named "${key}" in ${configPath()}`);
  }
  console.log(`Removed alias "${key}"`);
  console.log(`Saved ${configPath()}`);
}

export async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((a) => a !== "--");
  let json = false;
  const positional: string[] = [];

  while (args.length > 0) {
    const arg = args.shift()!;
    if (isHelpFlag(arg)) printHelp(helpText());
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg.startsWith("-")) {
      console.error(`Unknown flag: ${arg}`);
      usage();
    }
    positional.push(arg);
  }

  const sub = (positional[0] ?? "list").toLowerCase();
  const rest = positional.slice(1);

  if (sub === "list" || sub === "ls") {
    if (rest.length > 0) {
      console.error("Unexpected arguments after list.");
      usage();
    }
    await cmdList(json);
    return;
  }

  if (sub === "add" || sub === "set") {
    if (rest.length !== 3) {
      console.error("Usage: ollanet alias add <name> <machine> <model>");
      usage();
    }
    await cmdAdd(rest[0]!, rest[1]!, rest[2]!);
    return;
  }

  if (sub === "rm" || sub === "remove" || sub === "delete") {
    if (rest.length !== 1) {
      console.error("Usage: ollanet alias rm <name>");
      usage();
    }
    await cmdRm(rest[0]!);
    return;
  }

  console.error(`Unknown alias subcommand: ${sub}`);
  usage();
}
