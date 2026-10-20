/**
 * Token + label store for `ollanet serve`.
 *
 * Lives in `~/.ollanet/serve.json` (override with OLLANET_SERVE_FILE), never in
 * a checkout. Only SHA-256 hashes of tokens are stored; the token itself is
 * printed once by `ollanet serve token add`.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { USER_DIR } from "./paths.ts";

export interface ServeToken {
  name: string;
  /** Hex SHA-256 of the token. */
  sha256: string;
  created_at: string;
  expires_at: string | null;
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
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify(store, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(tmp, file);
  return file;
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
}

export async function removeToken(name: string): Promise<boolean> {
  const store = await loadServeStore();
  const before = store.tokens.length;
  store.tokens = store.tokens.filter((t) => t.name.toLowerCase() !== name.toLowerCase());
  if (store.tokens.length === before) return false;
  await saveServeStore(store);
  return true;
}

export async function setLabel(machine: string, label: string): Promise<void> {
  if (!isValidServeName(label)) {
    throw new Error(`Invalid label "${label}" (1–40 of letters, digits, ".", "_", "-").`);
  }
  const store = await loadServeStore();
  store.labels[machine.trim().toLowerCase()] = label;
  await saveServeStore(store);
}

export async function removeLabel(machine: string): Promise<boolean> {
  const store = await loadServeStore();
  const key = machine.trim().toLowerCase();
  if (!(key in store.labels)) return false;
  delete store.labels[key];
  await saveServeStore(store);
  return true;
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
