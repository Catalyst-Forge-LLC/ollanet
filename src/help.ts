/**
 * Per-command help: `ollanet help bench` and `ollanet bench help`.
 */

const LOADERS: Record<string, () => Promise<{ helpText: () => string }>> = {
  scan: () => import("./scan.ts"),
  prompt: () => import("./prompt.ts"),
  chats: () => import("./chats.ts"),
  pull: () => import("./pull.ts"),
  show: () => import("./show.ts"),
  rm: () => import("./rm.ts"),
  ps: () => import("./ps.ts"),
  compare: () => import("./compare.ts"),
  bench: () => import("./bench.ts"),
  alias: () => import("./alias.ts"),
  mcp: () => import("./mcp.ts"),
};

const ALIASES: Record<string, string> = {
  "ls-servers": "scan",
  ask: "prompt",
  chat: "prompt",
  ls: "chats",
  history: "chats",
  download: "pull",
  inspect: "show",
  delete: "rm",
  loaded: "ps",
  vs: "compare",
  h2h: "compare",
  benchmark: "bench",
  aliases: "alias",
};

export function canonicalCommand(name: string): string | undefined {
  const key = name.trim().toLowerCase();
  if (LOADERS[key]) return key;
  return ALIASES[key];
}

export function commandNames(): string[] {
  return Object.keys(LOADERS);
}

export async function commandHelp(name: string): Promise<string | undefined> {
  const canon = canonicalCommand(name);
  if (!canon) return undefined;
  const load = LOADERS[canon];
  if (!load) return undefined;
  const mod = await load();
  return mod.helpText();
}

export function isHelpRequest(args: string[]): boolean {
  return args.length === 1 && (args[0] === "help" || args[0] === "--help" || args[0] === "-h");
}
