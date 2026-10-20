/**
 * Read-only catalog server for cloud agents.
 *
 *   ollanet serve [--listen 127.0.0.1:11500] [--refresh 10m]
 *   ollanet serve token add <name> [--expires 30d]
 *
 * Serves `GET /v1/catalog` (bearer token) and `GET /healthz`. The catalog lists
 * models grouped by an opaque host label: no hostnames, IPs, ports, OS, or
 * paths. It never proxies prompts, compares, pulls, deletes, or ps.
 */
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import { isIP } from "node:net";
import path from "node:path";

import { failUsage, isHelpFlag, isQuiet, printHelp, takeFlag } from "./argv.ts";
import { loadConfig, type ModelAlias } from "./config.ts";
import { ollamaShow } from "./ollama-chat.ts";
import { FUNNEL_PORTS, FunnelError, startFunnel, type FunnelHandle } from "./funnel.ts";
import { scanNetwork, type ScannedServer } from "./scan.ts";
import { loadLastScan } from "./scan-store.ts";
import {
  addToken,
  isExpired,
  loadServeStore,
  matchToken,
  parseDuration,
  recordLastUsed,
  removeLabel,
  removeToken,
  removeTokens,
  lastActivity,
  serveStorePath,
  type ServeToken,
  setLabel,
} from "./serve-store.ts";

const DEFAULT_LISTEN = "127.0.0.1:11500";
const DEFAULT_REFRESH = "10m";
const MIN_REFRESH_MS = 30_000;
const DEFAULT_RATE = 60;

export function helpText(): string {
  return `Usage:
  ollanet serve [--listen <host:port>] [--refresh <interval|off>] [--rate <n>]
  ollanet serve --funnel [--funnel-port 443|8443|10000] [--keep-funnel]
  ollanet serve status [--json]
  ollanet serve token add <name> [--expires <duration>]
  ollanet serve token list [--json]
  ollanet serve token rm [name]           (no name: pick from a list in a terminal)
  ollanet serve token prune [--expired] [--unused-days <n>] [--yes]
  ollanet serve label set <machine> <label>
  ollanet serve label rm <machine>
  ollanet serve label list

Read-only catalog for agents that are not on your network (for example through
Tailscale Funnel). It lists which models exist, grouped by an opaque host label
(a serve label, else an alias name, else host-1, host-2, …). It never returns
hostnames, IPs, ports, OS, or paths, and never runs prompts, compares, pulls,
deletes, or ps.

Endpoints:
  GET /healthz      "ok" (no auth)
  GET /v1/catalog   Catalog JSON (Authorization: Bearer <token>)

Tokens are printed once; only their SHA-256 hashes are saved in
${serveStorePath()}

Options:
  --listen <host:port>   Bind address (default ${DEFAULT_LISTEN})
  --allow-remote         Allow a non-loopback bind (default: refuse)
  --refresh <interval>   Re-scan every interval, e.g. 10m, 1h, or off
                         (default ${DEFAULT_REFRESH}; starts from the last scan)
  --rate <n>             Requests per minute per token (default ${DEFAULT_RATE})
  --expires <duration>   Token lifetime for token add, e.g. 30d, 12h
  --funnel               Publish through Tailscale Funnel (needs a token, HTTPS
                         certificates, and the funnel node attribute); turned
                         off again when serve exits
  --funnel-port <n>      Public HTTPS port: 443 (default), 8443, or 10000
  --keep-funnel          Leave the Funnel up after serve exits
  -q, --quiet            No startup or access log lines on stderr`;
}

function usage(): never {
  failUsage(helpText());
}

// ---------------------------------------------------------------------------
// Catalog

export interface CatalogModel {
  name: string;
  size?: number;
  parameter_size?: string;
  quantization_level?: string;
  family?: string;
  capabilities?: string[];
  tuned: boolean;
}

export interface CatalogHost {
  label: string;
  models: CatalogModel[];
}

export interface CatalogAlias {
  name: string;
  /** Host label the alias points at, or null if that machine was not in the scan. */
  host: string | null;
  model: string;
}

export interface Catalog {
  generated_at: string;
  scanned_at: string | null;
  hosts: CatalogHost[];
  aliases: CatalogAlias[];
}

function serverKeys(server: ScannedServer): Set<string> {
  const dns = (server.dnsName ?? "").replace(/\.$/, "").toLowerCase();
  const keys = [server.hostname, dns, dns.split(".")[0], server.ip, ...(server.also ?? [])]
    .filter((k): k is string => typeof k === "string" && k.length > 0)
    .map((k) => k.toLowerCase());
  return new Set(keys);
}

/** Capabilities cache key (internal only; never serialized). */
export function capsKey(server: ScannedServer, model: string): string {
  return `${server.endpoint}\n${model}`;
}

/**
 * Pick an opaque label per server: serve label, else the first alias name
 * (sorted) pointing at it, else host-N. Labels are unique.
 */
export function hostLabels(
  servers: ScannedServer[],
  aliases: Record<string, ModelAlias>,
  labels: Record<string, string>,
): string[] {
  const used = new Set<string>();
  const aliasNames = Object.keys(aliases).sort();
  let n = 0;
  return servers.map((server) => {
    const keys = serverKeys(server);
    let label =
      Object.entries(labels).find(([machine]) => keys.has(machine.toLowerCase()))?.[1] ??
      aliasNames.find((name) => keys.has((aliases[name]?.machine ?? "").toLowerCase()));
    if (!label) {
      do {
        n += 1;
        label = `host-${n}`;
      } while (used.has(label));
    }
    let unique = label;
    for (let i = 2; used.has(unique); i += 1) unique = `${label}-${i}`;
    used.add(unique);
    return unique;
  });
}

/**
 * Build the sanitized catalog. Only allow-listed fields are copied, so new
 * scan fields cannot leak by accident.
 */
export function buildCatalog(input: {
  servers: ScannedServer[];
  scannedAt: string | null;
  aliases: Record<string, ModelAlias>;
  labels: Record<string, string>;
  capabilities?: Map<string, string[]>;
}): Catalog {
  const labels = hostLabels(input.servers, input.aliases, input.labels);
  const hosts: CatalogHost[] = input.servers.map((server, i) => ({
    label: labels[i]!,
    models: server.models.map((m) => {
      const caps = input.capabilities?.get(capsKey(server, m.name));
      return {
        name: m.name,
        ...(typeof m.size === "number" ? { size: m.size } : {}),
        ...(m.parameter_size ? { parameter_size: m.parameter_size } : {}),
        ...(m.quantization_level ? { quantization_level: m.quantization_level } : {}),
        ...(m.family ? { family: m.family } : {}),
        ...(caps ? { capabilities: [...caps] } : {}),
        tuned: Boolean(m.tuned),
      };
    }),
  }));
  const aliases: CatalogAlias[] = Object.keys(input.aliases)
    .sort()
    .map((name) => {
      const alias = input.aliases[name]!;
      const idx = input.servers.findIndex((s) => serverKeys(s).has(alias.machine.toLowerCase()));
      return { name, host: idx >= 0 ? labels[idx]! : null, model: alias.model };
    });
  return {
    generated_at: new Date().toISOString(),
    scanned_at: input.scannedAt,
    hosts,
    aliases,
  };
}

async function fetchAllCapabilities(servers: ScannedServer[]): Promise<Map<string, string[]>> {
  const caps = new Map<string, string[]>();
  await Promise.all(
    servers.map(async (server) => {
      for (const model of server.models) {
        try {
          const shown = await ollamaShow(server.endpoint, model.name, 5000);
          if (shown && Array.isArray(shown.capabilities)) {
            caps.set(capsKey(server, model.name), shown.capabilities.filter((c) => typeof c === "string"));
          }
        } catch {
          // Capabilities are optional in the catalog.
        }
      }
    }),
  );
  return caps;
}

// ---------------------------------------------------------------------------
// Server

export function isLoopbackHost(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (h === "localhost") return true;
  if (isIP(h) === 4) return h.startsWith("127.");
  if (isIP(h) === 6) return h === "::1" || h === "0:0:0:0:0:0:0:1";
  return false;
}

export function parseListen(raw: string): { host: string; port: number } {
  const m = /^(?:\[([^\]]+)\]|([^:]+)):(\d{1,5})$/.exec(raw.trim());
  if (!m) throw new Error(`--listen must be host:port (got "${raw}")`);
  const host = (m[1] ?? m[2])!;
  const port = Number(m[3]);
  if (port > 65535) throw new Error(`--listen port out of range: ${port}`);
  return { host, port };
}

export interface ServeOptions {
  host: string;
  port: number;
  /** Re-scan interval; 0 = never (serve the last scan only). */
  refreshMs: number;
  /** Requests per minute per token. */
  rate: number;
  log?: (line: string) => void;
  /** Minimum gap between serve.json writes of a token's last use (default 60s). */
  lastUsedFlushMs?: number;
}

export interface ServeHandle {
  url: string;
  port: number;
  catalog(): Catalog;
  refresh(rescan: boolean): Promise<void>;
  close(): Promise<void>;
}

const SECURITY_HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

function sendJson(res: http.ServerResponse, status: number, body: unknown, extra: Record<string, string> = {}): void {
  const text = `${JSON.stringify(body, null, 2)}\n`;
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(text),
    ...extra,
  });
  res.end(text);
}

export async function startServe(opts: ServeOptions): Promise<ServeHandle> {
  const log = opts.log ?? (() => {});
  let current: Catalog = buildCatalog({ servers: [], scannedAt: null, aliases: {}, labels: {} });
  let refreshing: Promise<void> | null = null;

  async function rebuild(rescan: boolean): Promise<void> {
    let servers: ScannedServer[] = [];
    let scannedAt: string | null = null;
    const last = rescan ? null : await loadLastScan();
    if (last) {
      servers = last.servers;
      scannedAt = last.scanned_at ?? null;
    } else if (rescan || opts.refreshMs > 0) {
      const payload = await scanNetwork();
      servers = payload.servers;
      scannedAt = new Date().toISOString();
    }
    const [config, store, capabilities] = await Promise.all([
      loadConfig(),
      loadServeStore(),
      fetchAllCapabilities(servers),
    ]);
    current = buildCatalog({ servers, scannedAt, aliases: config.aliases, labels: store.labels, capabilities });
  }

  function refresh(rescan: boolean): Promise<void> {
    refreshing ??= rebuild(rescan).finally(() => {
      refreshing = null;
    });
    return refreshing;
  }

  await refresh(false);

  const windows = new Map<string, { start: number; count: number }>();
  const lastUsed = lastUsedTracker(opts.lastUsedFlushMs ?? 60_000, log);

  async function authenticate(req: http.IncomingMessage): Promise<string | undefined> {
    const header = req.headers.authorization ?? "";
    const m = /^Bearer\s+(\S{1,200})$/i.exec(header);
    if (!m) return undefined;
    const store = await loadServeStore();
    const token = matchToken(store.tokens, m[1]!);
    if (token) lastUsed.touch(token.sha256);
    return token?.name;
  }

  function rateLimited(name: string): number {
    const now = Date.now();
    const w = windows.get(name);
    if (!w || now - w.start >= 60_000) {
      windows.set(name, { start: now, count: 1 });
      return 0;
    }
    w.count += 1;
    return w.count > opts.rate ? Math.ceil((w.start + 60_000 - now) / 1000) : 0;
  }

  const server = http.createServer((req, res) => {
    const method = req.method ?? "GET";
    const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
    let who = "-";
    res.on("finish", () => log(`${new Date().toISOString()} ${who} ${method} ${pathname} ${res.statusCode}`));
    // Never read request bodies.
    req.resume();

    void (async () => {
      if (pathname === "/healthz") {
        if (method !== "GET" && method !== "HEAD") {
          sendJson(res, 405, { error: "method not allowed" }, { Allow: "GET, HEAD" });
          return;
        }
        res.writeHead(200, { ...SECURITY_HEADERS, "Content-Type": "text/plain; charset=utf-8" });
        res.end(method === "HEAD" ? undefined : "ok\n");
        return;
      }
      if (pathname === "/v1" || pathname.startsWith("/v1/")) {
        const name = await authenticate(req);
        if (!name) {
          sendJson(res, 401, { error: "unauthorized" }, { "WWW-Authenticate": 'Bearer realm="ollanet"' });
          return;
        }
        who = name;
        const retry = rateLimited(name);
        if (retry > 0) {
          sendJson(res, 429, { error: "rate limited" }, { "Retry-After": String(retry) });
          return;
        }
        if (pathname !== "/v1/catalog") {
          sendJson(res, 404, { error: "not found" });
          return;
        }
        if (method !== "GET") {
          sendJson(res, 405, { error: "method not allowed" }, { Allow: "GET" });
          return;
        }
        sendJson(res, 200, current);
        return;
      }
      sendJson(res, 404, { error: "not found" });
    })().catch(() => {
      if (!res.headersSent) sendJson(res, 500, { error: "internal error" });
      else res.destroy();
    });
  });
  server.headersTimeout = 10_000;
  server.requestTimeout = 15_000;

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port, opts.host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const timer =
    opts.refreshMs > 0
      ? setInterval(() => {
          refresh(true).catch((err) =>
            log(`refresh failed: ${err instanceof Error ? err.message : String(err)}`),
          );
        }, opts.refreshMs)
      : null;

  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : opts.port;
  const hostPart = opts.host.includes(":") ? `[${opts.host}]` : opts.host;

  return {
    url: `http://${hostPart}:${port}`,
    port,
    catalog: () => current,
    refresh,
    close: async () => {
      if (timer) clearInterval(timer);
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
      await lastUsed.flush();
    },
  };
}

/**
 * Debounced last-use writer: the first use of a token writes right away, later
 * uses at most once per `intervalMs` per token, and close() flushes the rest.
 * Writes are serialized; failures are logged, never fatal.
 */
function lastUsedTracker(intervalMs: number, log: (line: string) => void) {
  const pending = new Map<string, string>();
  const written = new Map<string, number>();
  let timer: NodeJS.Timeout | null = null;
  let chain: Promise<void> = Promise.resolve();

  function flush(): Promise<void> {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (pending.size > 0) {
      const batch = new Map(pending);
      pending.clear();
      const now = Date.now();
      for (const sha of batch.keys()) written.set(sha, now);
      chain = chain
        .then(() => recordLastUsed(batch))
        .catch((err) => log(`last-used write failed: ${err instanceof Error ? err.message : String(err)}`));
    }
    return chain;
  }

  function touch(sha: string): void {
    const now = Date.now();
    pending.set(sha, new Date(now).toISOString());
    const wait = (written.get(sha) ?? -Infinity) + intervalMs - now;
    if (wait <= 0) {
      void flush();
    } else if (!timer) {
      timer = setTimeout(() => void flush(), wait);
      timer.unref();
    }
  }

  return { touch, flush };
}

// ---------------------------------------------------------------------------
// State file for `ollanet serve status`

export interface ServeState {
  pid: number;
  url: string;
  funnel_url: string | null;
  started_at: string;
}

export function serveStatePath(): string {
  return path.join(path.dirname(serveStorePath()), "serve-state.json");
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function statusCommand(args: string[]): Promise<void> {
  const json = args.includes("--json");
  let state: ServeState | null = null;
  try {
    state = JSON.parse(await readFile(serveStatePath(), "utf8")) as ServeState;
  } catch {
    state = null;
  }
  const running = !!state && Number.isInteger(state.pid) && pidAlive(state.pid);
  if (json) {
    process.stdout.write(`${JSON.stringify(running ? { running, ...state } : { running: false }, null, 2)}\n`);
    return;
  }
  if (!running || !state) {
    process.stdout.write("ollanet serve is not running.\n");
    return;
  }
  process.stdout.write(`ollanet serve running (pid ${state.pid}, since ${state.started_at})\n`);
  process.stdout.write(`  local:   ${state.url}\n`);
  process.stdout.write(
    state.funnel_url
      ? `  funnel:  ${state.funnel_url}\n  catalog: ${state.funnel_url}v1/catalog\n`
      : "  funnel:  off\n",
  );
}

// ---------------------------------------------------------------------------
// CLI

async function tokenCommand(args: string[]): Promise<void> {
  const sub = args.shift();
  if (sub === "add") {
    let expiresMs: number | undefined;
    const positional: string[] = [];
    while (args.length > 0) {
      const arg = args.shift()!;
      const expires = takeFlag(arg, "--expires", args, usage);
      if (expires !== undefined) {
        expiresMs = parseDuration(expires);
        if (!expiresMs) {
          console.error(`--expires must be a duration like 30d, 12h, or 90m (got "${expires}")`);
          usage();
        }
        continue;
      }
      if (arg.startsWith("-")) {
        console.error(`Unknown flag: ${arg}`);
        usage();
      }
      positional.push(arg);
    }
    if (positional.length !== 1) usage();
    const { token, record, file } = await addToken(positional[0]!, expiresMs);
    process.stdout.write(`${token}\n`);
    if (!isQuiet()) {
      console.error(
        `Token "${record.name}" created${record.expires_at ? `, expires ${record.expires_at}` : ""}. ` +
          `It is shown only once; ${file} keeps just its SHA-256 hash.`,
      );
    }
    return;
  }
  if (sub === "list" || sub === "ls") {
    const json = args.includes("--json");
    const { tokens } = await loadServeStore();
    const rows = tokens.map((t) => ({
      name: t.name,
      created_at: t.created_at,
      expires_at: t.expires_at,
      expired: isExpired(t),
      last_used: t.last_used ?? null,
    }));
    if (json) {
      process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
      return;
    }
    if (rows.length === 0) {
      process.stdout.write("No serve tokens. Add one with: ollanet serve token add <name>\n");
      return;
    }
    process.stdout.write(tokenTable(tokens));
    return;
  }
  if (sub === "prune") return pruneCommand(args);
  if (sub === "rm" || sub === "remove" || sub === "delete") {
    if (args.length === 0) return interactiveRemove();
    if (args.length !== 1) usage();
    if (!(await removeToken(args[0]!))) {
      console.error(`No serve token named "${args[0]}".`);
      process.exitCode = 1;
      return;
    }
    process.stdout.write(`Removed token ${args[0]}\n`);
    return;
  }
  console.error(`Unknown token subcommand: ${sub ?? "(none)"}`);
  usage();
}

/** "never", "just now", "5m ago", "3h ago", "12d ago". */
export function relativeTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "never";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "never";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 48 * 3600) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function shortTime(iso: string): string {
  return `${iso.slice(0, 16).replace("T", " ")}Z`;
}

/** Aligned token table: NAME, CREATED, EXPIRES, LAST USED (optionally numbered). */
export function tokenTable(tokens: ServeToken[], opts: { numbered?: boolean; now?: number } = {}): string {
  const now = opts.now ?? Date.now();
  const header = ["NAME", "CREATED", "EXPIRES", "LAST USED"];
  const rows = tokens.map((t) => [
    t.name,
    shortTime(t.created_at),
    t.expires_at ? `${isExpired(t, now) ? "EXPIRED " : ""}${shortTime(t.expires_at)}` : "never",
    relativeTime(t.last_used, now),
  ]);
  const all = [header, ...rows].map((r, i) =>
    opts.numbered ? [i === 0 ? "#" : String(i), ...r] : r,
  );
  const widths = all[0]!.map((_, c) => Math.max(...all.map((r) => r[c]!.length)));
  return all.map((r) => `${r.map((cell, c) => cell.padEnd(widths[c]!)).join("  ").trimEnd()}\n`).join("");
}

/**
 * Parse a pick like "1,3", "2-4", "1 3", or "all" against a list of `count`.
 * Returns 0-based indices ([] for an empty answer = cancel), or an error string.
 */
export function parseSelection(input: string, count: number): number[] | string {
  const text = input.trim().toLowerCase();
  if (!text) return [];
  if (text === "all" || text === "*") return Array.from({ length: count }, (_, i) => i);
  const picked = new Set<number>();
  for (const part of text.split(/[\s,]+/).filter(Boolean)) {
    const m = /^(\d+)(?:-(\d+))?$/.exec(part);
    if (!m) return `Not a number or range: "${part}"`;
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : a;
    if (a < 1 || b > count || a > b) return `Out of range: "${part}" (1–${count})`;
    for (let i = a; i <= b; i += 1) picked.add(i - 1);
  }
  return [...picked].sort((x, y) => x - y);
}

type Ask = (question: string) => Promise<string>;

function isYes(answer: string): boolean {
  return /^\s*y(es)?\s*$/i.test(answer);
}

/**
 * Numbered pick + y/N confirm. Returns the names to remove ([] = nothing).
 * Throws on an invalid pick. `ask` and `write` are injectable for tests.
 */
export async function chooseTokensToRemove(
  tokens: ServeToken[],
  ask: Ask,
  write: (text: string) => void,
): Promise<string[]> {
  write(tokenTable(tokens, { numbered: true }));
  const pick = parseSelection(await ask("Remove which? (e.g. 1,3 or all; Enter to cancel): "), tokens.length);
  if (typeof pick === "string") throw new Error(pick);
  if (pick.length === 0) return [];
  const names = pick.map((i) => tokens[i]!.name);
  return isYes(await ask(`Remove ${names.length} token(s): ${names.join(", ")}? [y/N] `)) ? names : [];
}

function canPrompt(): boolean {
  return Boolean(process.stdin.isTTY && process.stderr.isTTY);
}

async function withPrompt<T>(fn: (ask: Ask) => Promise<T>): Promise<T> {
  const { createInterface } = await import("node:readline/promises");
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    return await fn((q) => rl.question(q));
  } finally {
    rl.close();
  }
}

async function interactiveRemove(): Promise<void> {
  if (!canPrompt()) {
    console.error("serve token rm needs a name when stdin/stderr are not a terminal.");
    usage();
  }
  const { tokens } = await loadServeStore();
  if (tokens.length === 0) {
    process.stdout.write("No serve tokens.\n");
    return;
  }
  const names = await withPrompt((ask) =>
    chooseTokensToRemove(tokens, ask, (text) => process.stderr.write(text)),
  );
  if (names.length === 0) {
    console.error("Nothing removed.");
    return;
  }
  const removed = await removeTokens(names);
  process.stdout.write(`Removed ${removed.join(", ")}\n`);
}

/** Tokens `prune` would remove, with a reason each. */
export function pruneCandidates(
  tokens: ServeToken[],
  opts: { expired: boolean; unusedDays?: number },
  now = Date.now(),
): Array<{ token: ServeToken; reason: string }> {
  const out: Array<{ token: ServeToken; reason: string }> = [];
  for (const t of tokens) {
    if (opts.expired && isExpired(t, now)) {
      out.push({ token: t, reason: "expired" });
      continue;
    }
    if (opts.unusedDays != null && now - lastActivity(t) >= opts.unusedDays * 86_400_000) {
      out.push({ token: t, reason: t.last_used ? `unused ${relativeTime(t.last_used, now)}` : "never used" });
    }
  }
  return out;
}

async function pruneCommand(args: string[]): Promise<void> {
  let expired = false;
  let yes = false;
  let unusedDays: number | undefined;
  while (args.length > 0) {
    const arg = args.shift()!;
    if (arg === "--expired") {
      expired = true;
      continue;
    }
    if (arg === "--yes" || arg === "-y") {
      yes = true;
      continue;
    }
    const days = takeFlag(arg, "--unused-days", args, usage);
    if (days !== undefined) {
      unusedDays = Number(days);
      if (!Number.isFinite(unusedDays) || unusedDays < 0) {
        console.error(`--unused-days must be a number of days (got "${days}")`);
        usage();
      }
      continue;
    }
    console.error(`Unknown argument: ${arg}`);
    usage();
  }
  if (!expired && unusedDays === undefined) {
    console.error("serve token prune needs --expired and/or --unused-days <n>.");
    usage();
  }
  const { tokens } = await loadServeStore();
  const candidates = pruneCandidates(tokens, { expired, unusedDays });
  if (candidates.length === 0) {
    process.stdout.write("Nothing to prune.\n");
    return;
  }
  const list = candidates.map((c) => `  ${c.token.name} (${c.reason})`).join("\n");
  if (!yes) {
    if (!canPrompt()) {
      console.error(`Would remove:\n${list}\nRefusing without --yes (not a terminal).`);
      process.exitCode = 1;
      return;
    }
    process.stderr.write(`Will remove:\n${list}\n`);
    const ok = await withPrompt(async (ask) => isYes(await ask(`Remove ${candidates.length} token(s)? [y/N] `)));
    if (!ok) {
      console.error("Nothing removed.");
      return;
    }
  }
  const removed = await removeTokens(candidates.map((c) => c.token.name));
  process.stdout.write(`Removed ${removed.join(", ")}\n`);
}

async function labelCommand(args: string[]): Promise<void> {
  const sub = args.shift();
  if (sub === "set" || sub === "add") {
    if (args.length !== 2) usage();
    await setLabel(args[0]!, args[1]!);
    process.stdout.write(`Label ${args[1]} for ${args[0]}\n`);
    return;
  }
  if (sub === "rm" || sub === "remove") {
    if (args.length !== 1) usage();
    if (!(await removeLabel(args[0]!))) {
      console.error(`No serve label for "${args[0]}".`);
      process.exitCode = 1;
      return;
    }
    process.stdout.write(`Removed label for ${args[0]}\n`);
    return;
  }
  if (sub === "list" || sub === "ls") {
    const { labels } = await loadServeStore();
    const entries = Object.entries(labels);
    if (entries.length === 0) {
      process.stdout.write("No serve labels (aliases or host-N are used).\n");
      return;
    }
    for (const [machine, label] of entries) process.stdout.write(`${label}  ← ${machine}\n`);
    return;
  }
  console.error(`Unknown label subcommand: ${sub ?? "(none)"}`);
  usage();
}

export async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.some((a) => isHelpFlag(a))) printHelp(helpText());
  if (args[0] === "token") return tokenCommand(args.slice(1));
  if (args[0] === "label") return labelCommand(args.slice(1));
  if (args[0] === "status") return statusCommand(args.slice(1));

  let listen = DEFAULT_LISTEN;
  let refreshRaw = DEFAULT_REFRESH;
  let rate = DEFAULT_RATE;
  let allowRemote = false;
  let funnel = false;
  let keepFunnel = false;
  let funnelPort = 443;
  while (args.length > 0) {
    const arg = args.shift()!;
    const l = takeFlag(arg, "--listen", args, usage);
    if (l !== undefined) {
      listen = l;
      continue;
    }
    const r = takeFlag(arg, "--refresh", args, usage);
    if (r !== undefined) {
      refreshRaw = r;
      continue;
    }
    const rt = takeFlag(arg, "--rate", args, usage);
    if (rt !== undefined) {
      rate = Number(rt);
      if (!Number.isInteger(rate) || rate < 1) {
        console.error(`--rate must be a positive integer (got "${rt}")`);
        usage();
      }
      continue;
    }
    if (arg === "--allow-remote") {
      allowRemote = true;
      continue;
    }
    if (arg === "--funnel") {
      funnel = true;
      continue;
    }
    if (arg === "--keep-funnel") {
      keepFunnel = true;
      continue;
    }
    const fp = takeFlag(arg, "--funnel-port", args, usage);
    if (fp !== undefined) {
      funnelPort = Number(fp);
      if (!(FUNNEL_PORTS as readonly number[]).includes(funnelPort)) {
        console.error(`--funnel-port must be one of ${FUNNEL_PORTS.join(", ")} (got "${fp}")`);
        usage();
      }
      funnel = true;
      continue;
    }
    console.error(`Unknown argument: ${arg}`);
    usage();
  }

  const { host, port } = parseListen(listen);
  if (!isLoopbackHost(host) && !allowRemote) {
    throw new Error(
      `Refusing to listen on ${host}: not a loopback address. Keep the default and expose it ` +
        `with Tailscale Funnel/Serve, or pass --allow-remote.`,
    );
  }
  const off = /^(off|never|0)$/i.test(refreshRaw.trim());
  const refreshMs = off ? 0 : parseDuration(refreshRaw);
  if (refreshMs === undefined || (refreshMs > 0 && refreshMs < MIN_REFRESH_MS)) {
    throw new Error(`--refresh must be off or a duration of at least 30s (got "${refreshRaw}")`);
  }

  const activeTokens = (await loadServeStore()).tokens.filter((t) => !isExpired(t));
  if (funnel && activeTokens.length === 0) {
    throw new Error(
      "Refusing --funnel: there are no active serve tokens and the Funnel URL is public. " +
        "Create one first: ollanet serve token add <name>",
    );
  }

  const quiet = isQuiet();
  const log = (line: string): void => {
    if (!quiet) console.error(line);
  };
  const handle = await startServe({ host, port, refreshMs, rate, log });
  const cat = handle.catalog();
  const models = cat.hosts.reduce((n, h) => n + h.models.length, 0);
  log(`ollanet serve listening on ${handle.url}  (read-only catalog)`);
  log(
    `catalog: ${cat.hosts.length} host(s), ${models} model(s)` +
      `${cat.scanned_at ? ` from scan at ${cat.scanned_at}` : ""}; ` +
      `refresh ${refreshMs > 0 ? `every ${refreshRaw}` : "off"}`,
  );
  if (activeTokens.length === 0) {
    log("No active tokens: /v1/* answers 401 until you run ollanet serve token add <name>");
  }
  if (!isLoopbackHost(host)) {
    log(`Warning: listening on non-loopback ${host} (--allow-remote).`);
  }

  let funnelHandle: FunnelHandle | null = null;
  if (funnel) {
    const localHost = host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;
    const target = `http://${localHost.includes(":") ? `[${localHost}]` : localHost}:${handle.port}`;
    try {
      funnelHandle = await startFunnel({ localPort: handle.port, target, funnelPort });
    } catch (err) {
      await handle.close();
      if (err instanceof FunnelError) {
        console.error(err.message);
        process.exitCode = 1;
        return;
      }
      throw err;
    }
    // The public URL is the result of --funnel, so it goes to stdout even with -q.
    process.stdout.write(`Funnel:  ${funnelHandle.publicUrl}\n`);
    process.stdout.write(`Catalog: ${funnelHandle.publicUrl}v1/catalog\n`);
    if (!funnelHandle.added) {
      log("Funnel was already pointing at this port; leaving it as is when serve exits.");
    } else if (keepFunnel) {
      log(`--keep-funnel: the Funnel stays up after exit. Turn it off with: tailscale funnel --https=${funnelPort} off`);
    } else {
      log("The Funnel is turned off when serve exits (Ctrl+C).");
    }
  }

  const statePath = serveStatePath();
  const state: ServeState = {
    pid: process.pid,
    url: handle.url,
    funnel_url: funnelHandle?.publicUrl ?? null,
    started_at: new Date().toISOString(),
  };
  await mkdir(path.dirname(statePath), { recursive: true })
    .then(() => writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8"))
    .catch(() => {});

  let tornDown = false;
  const teardown = (): void => {
    if (tornDown) return;
    tornDown = true;
    if (funnelHandle && !keepFunnel) funnelHandle.stop();
  };
  // Sync work only in 'exit': turn off our Funnel even on an unexpected exit.
  process.once("exit", teardown);
  const stop = (): void => {
    teardown();
    void Promise.all([handle.close(), rm(statePath, { force: true })]).finally(() => process.exit(0));
  };
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"] as const) {
    process.once(sig, stop);
  }
}
