/**
 * Shared CLI flag helpers. Commands keep their own usage() and unique flags.
 */
import type { GenerateSettings } from "./config.ts";

export type UsageFn = () => never;

export function isHelpFlag(arg: string): boolean {
  return arg === "--help" || arg === "-h";
}

/** Intentional help: stdout, exit 0. */
export function printHelp(text: string): never {
  process.stdout.write(text.endsWith("\n") ? text : `${text}\n`);
  process.exit(0);
}

/** Usage error: stderr, exit 1. */
export function failUsage(text: string): never {
  console.error(text);
  process.exit(1);
}

export function takeValue(args: string[], flag: string, usage: UsageFn): string {
  const value = args.shift();
  if (!value) {
    console.error(`${flag} requires a value`);
    usage();
  }
  return value;
}

/** `--name value` or `--name=value`. Returns undefined if `arg` is not this flag. */
export function takeFlag(
  arg: string,
  name: string,
  args: string[],
  usage: UsageFn,
): string | undefined {
  if (arg === name) return takeValue(args, name, usage);
  if (arg.startsWith(`${name}=`)) return arg.slice(name.length + 1);
  return undefined;
}

export function parseNumberFlag(raw: string, flag: string, usage: UsageFn): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    console.error(`${flag} must be a number (got "${raw}")`);
    usage();
  }
  return n;
}

export function parseKeepAlive(raw: string): string | number {
  const asNum = Number(raw);
  return raw.trim() !== "" && Number.isFinite(asNum) && String(asNum) === raw ? asNum : raw;
}

export interface SettingsFlagOpts {
  temperature?: boolean;
  numPredict?: boolean;
  system?: boolean;
}

/** Shared generate-settings flags. Returns true when `arg` was consumed. */
export function consumeSettingsFlag(
  arg: string,
  args: string[],
  settings: GenerateSettings,
  usage: UsageFn,
  opts: SettingsFlagOpts = {},
): boolean {
  if (arg === "--think") {
    settings.think = true;
    return true;
  }
  if (arg === "--no-think") {
    settings.think = false;
    return true;
  }

  if (opts.system) {
    const system = takeFlag(arg, "--system", args, usage);
    if (system !== undefined) {
      settings.system = system;
      return true;
    }
  }

  if (opts.temperature) {
    if (arg === "-t" || arg === "--temperature" || arg.startsWith("--temperature=")) {
      const raw =
        arg === "-t" || arg === "--temperature"
          ? takeValue(args, "--temperature", usage)
          : arg.slice("--temperature=".length);
      settings.temperature = parseNumberFlag(raw, "--temperature", usage);
      return true;
    }
  }

  if (opts.numPredict) {
    const raw = takeFlag(arg, "--num-predict", args, usage);
    if (raw !== undefined) {
      settings.num_predict = Math.trunc(parseNumberFlag(raw, "--num-predict", usage));
      return true;
    }
  }

  const numCtx = takeFlag(arg, "--num-ctx", args, usage);
  if (numCtx !== undefined) {
    settings.num_ctx = Math.trunc(parseNumberFlag(numCtx, "--num-ctx", usage));
    return true;
  }

  const keepAlive = takeFlag(arg, "--keep-alive", args, usage);
  if (keepAlive !== undefined) {
    settings.keep_alive = parseKeepAlive(keepAlive);
    return true;
  }

  return false;
}
