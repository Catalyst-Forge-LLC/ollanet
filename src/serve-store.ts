/**
 * Token + label store for `ollanet serve`.
 *
 * Lives in `~/.ollanet/serve.json` (override with OLLANET_SERVE_FILE), never in
 * a checkout. Only SHA-256 hashes of tokens are stored; the token itself is
 * printed once by `ollanet serve token add`.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, open, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { USER_DIR } from "./paths.ts";

export interface ServeToken {
  name: string;
  /** Hex SHA-256 of the token. */
  sha256: string;
  created_at: string;
  expires_at: string | null;
  /** Last successful auth by `ollanet serve` (ISO), written at most once a minute. */
  last_used?: string | null;
}

export interface ServeStore {
  tokens: ServeToken[];
  /** Opaque catalog label per machine (key: hostname, MagicDNS name, or IP). */
  labels: Record<string, string>;
}

const NAME_RE = /^[a-z0-9][a-z0-9_.-]{0,39}$/i;
const TOKEN_PREFIX = "olns_";

export function serveStorePath(): string {
  return process.env.OLLANET_SERVE_FILE ?? path.join(USER_DIR, "serve.json");
}

/** Token names and labels: 1–40 of letters, digits, `.`, `_`, `-`. */
export function isValidServeName(name: string): boolean {
  return NAME_RE.test(name);
}

export async function loadServeStore(): Promise<ServeStore> {
  const file = serveStorePath();
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { tokens: [], labels: {} };
    throw err;
  }
  const parsed = JSON.parse(text) as Partial<ServeStore>;
  const tokens = Array.isArray(parsed.tokens)
    ? parsed.tokens.filter(
        (t): t is ServeToken =>
          !!t && typeof t.name === "string" && typeof t.sha256 === "string" && /^[0-9a-f]{64}$/.test(t.sha256),
      )
    : [];
  const labels: Record<string, string> = {};
  if (parsed.labels && typeof parsed.labels === "object") {
    for (const [k, v] of Object.entries(parsed.labels)) {
      if (typeof v === "string" && isValidServeName(v)) labels[k.toLowerCase()] = v;
    }
  }
  return { tokens, labels };
}

export async function saveServeStore(store: ServeStore): Promise<string> {
  const file = serveStorePath();
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  await writeFile(tmp, `${JSON.stringify(store, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(tmp, file);
  return file;
}

/**
 * Serialize read-modify-write of serve.json across processes (a running
 * `serve` recording last use, and CLI token add/rm/prune). A plain lock file
 * created with O_EXCL; a lock older than 10s is treated as stale.
 */
async function withStoreLock<T>(fn: () => Promise<T>): Promise<T> {
  const file = serveStorePath();
  await mkdir(path.dirname(file), { recursive: true });
  const lock = `${file}.lock`;
  const deadline = Date.now() + 5000;
  for (;;) {
    try {
      const handle = await open(lock, "wx");
      try {
        return await fn();
      } finally {
        await handle.close();
        await unlink(lock).catch(() => {});
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      const age = await stat(lock).then((st) => Date.now() - st.mtimeMs, () => 0);
      if (age > 10_000) {
        await unlink(lock).catch(() => {});
        continue;
      }
      if (Date.now() > deadline) throw new Error(`serve.json is locked (${lock}). Try again.`);
      await new Promise((r) => setTimeout(r, 25));
    }
  }
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function newToken(): string {
  return `${TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
}

/**
 * `30d`, `12h`, `10m`, `45s`, `500ms`; a bare number is seconds.
 * Returns milliseconds, or undefined when the text is not a duration.
 */
export function parseDuration(raw: string): number | undefined {
  const m = /^(\d+(?:\.\d+)?)(ms|s|m|h|d)?$/i.exec(raw.trim());
  if (!m) return undefined;
  const n = Number(m[1]);
  const unit = (m[2] ?? "s").toLowerCase();
  const scale: Record<string, number> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  const ms = n * (scale[unit] ?? 1000);
  return Number.isFinite(ms) ? Math.round(ms) : undefined;
}

export async function addToken(
  name: string,
  expiresInMs?: number,
): Promise<{ token: string; record: ServeToken; file: string }> {
  if (!isValidServeName(name)) {
    throw new Error(`Invalid token name "${name}" (1–40 of letters, digits, ".", "_", "-").`);
  }
  return withStoreLock(async () => {
    const store = await loadServeStore();
    if (store.tokens.some((t) => t.name.toLowerCase() === name.toLowerCase())) {
      throw new Error(`A token named "${name}" already exists. Remove it first: ollanet serve token rm ${name}`);
    }
    const token = newToken();
    const now = Date.now();
    const record: ServeToken = {
      name,
      sha256: hashToken(token),
      created_at: new Date(now).toISOString(),
      expires_at: expiresInMs ? new Date(now + expiresInMs).toISOString() : null,
    };
    store.tokens.push(record);
    const file = await saveServeStore(store);
    return { token, record, file };
  });
}

export async function removeToken(name: string): Promise<boolean> {
  return (await removeTokens([name])).length > 0;
}

/** Remove several tokens in one write. Returns the names actually removed. */
export async function removeTokens(names: string[]): Promise<string[]> {
  const wanted = new Set(names.map((n) => n.toLowerCase()));
  return withStoreLock(async () => {
    const store = await loadServeStore();
    const removed = store.tokens.filter((t) => wanted.has(t.name.toLowerCase())).map((t) => t.name);
    if (removed.length === 0) return [];
    store.tokens = store.tokens.filter((t) => !wanted.has(t.name.toLowerCase()));
    await saveServeStore(store);
    return removed;
  });
}

/**
 * Merge last-used times into serve.json. Re-reads the file first and touches
 * only `last_used` on tokens matched by hash, so token add/rm from the CLI in
 * the meantime is kept (a removed token simply is not written back). Never
 * moves a time backwards. Atomic via temp file + rename.
 */
export async function recordLastUsed(usedBySha: Map<string, string>): Promise<void> {
  if (usedBySha.size === 0) return;
  await withStoreLock(async () => {
    const store = await loadServeStore();
    let changed = false;
    for (const t of store.tokens) {
      const used = usedBySha.get(t.sha256);
      if (!used) continue;
      if (!t.last_used || Date.parse(used) > Date.parse(t.last_used)) {
        t.last_used = used;
        changed = true;
      }
    }
    if (changed) await saveServeStore(store);
  });
}

/** Last use, else creation: the clock for `token prune --unused-days`. */
export function lastActivity(token: ServeToken): number {
  return Date.parse(token.last_used ?? token.created_at);
}

export async function setLabel(machine: string, label: string): Promise<void> {
  if (!isValidServeName(label)) {
    throw new Error(`Invalid label "${label}" (1–40 of letters, digits, ".", "_", "-").`);
  }
  await withStoreLock(async () => {
    const store = await loadServeStore();
    store.labels[machine.trim().toLowerCase()] = label;
    await saveServeStore(store);
  });
}

export async function removeLabel(machine: string): Promise<boolean> {
  const key = machine.trim().toLowerCase();
  return withStoreLock(async () => {
    const store = await loadServeStore();
    if (!(key in store.labels)) return false;
    delete store.labels[key];
    await saveServeStore(store);
    return true;
  });
}

export function isExpired(token: ServeToken, now = Date.now()): boolean {
  return token.expires_at != null && Date.parse(token.expires_at) <= now;
}

/**
 * Find the token matching `presented`. Compares the SHA-256 digest against
 * every stored hash with timingSafeEqual (no early exit). Expired tokens never
 * match.
 */
export function matchToken(
  tokens: ServeToken[],
  presented: string,
  now = Date.now(),
): ServeToken | undefined {
  const digest = createHash("sha256").update(presented, "utf8").digest();
  let hit: ServeToken | undefined;
  for (const t of tokens) {
    const stored = Buffer.from(t.sha256, "hex");
    if (stored.length !== digest.length) continue;
    if (timingSafeEqual(stored, digest) && !hit) hit = t;
  }
  return hit && !isExpired(hit, now) ? hit : undefined;
}
