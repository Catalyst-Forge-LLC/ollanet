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

/**
 * Quiet mode (`-q` / `--quiet` on any command, or OLLANET_QUIET=1): results on
 * stdout only. stderr keeps real errors and warnings (and --think reasoning,
 * which you asked for); saved paths, hints, notices, and progress are dropped.
 */
export function isQuiet(): boolean {
  const flag = process.env.OLLANET_QUIET?.trim().toLowerCase();
  return flag === "1" || flag === "true";
}

/**
 * Remove `-q` / `--quiet` from a command's argv and switch quiet mode on.
 * Done once in the CLI entry so every command accepts it in any position.
 */
export function takeQuietFlag(argv: string[]): string[] {
  const rest = argv.filter((arg) => arg !== "-q" && arg !== "--quiet");
  if (rest.length !== argv.length) process.env.OLLANET_QUIET = "1";
  return rest;
}

/**
 * Decorative progress lines (`→ model (1/2)`) are for people watching a
 * terminal. Piped and agent runs skip them so stderr only carries results and
 * real errors (PowerShell 5 wraps every native stderr line in a red
 * NativeCommandError). OLLANET_PROGRESS=1 forces them on, 0 forces them off.
 */
export function showProgress(): boolean {
  if (isQuiet()) return false;
  const flag = process.env.OLLANET_PROGRESS?.trim().toLowerCase();
  if (flag === "1" || flag === "true") return true;
  if (flag === "0" || flag === "false") return false;
  return Boolean(process.stderr.isTTY);
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
