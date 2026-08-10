import { execFile } from "node:child_process";
import net from "node:net";
import os from "node:os";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Parse a required numeric env var; invalid values throw instead of becoming NaN. */
export function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || String(raw).trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    throw new Error(`Invalid ${name}="${raw}" (expected a number)`);
  }
  return Math.trunc(n);
}

export const OLLAMA_PORT = envInt("OLLAMA_PORT", 11434);

export type HostSource = "localhost" | "config" | "env" | "tailscale" | "lan" | "direct";

export type HostConfigEntry =
  | string
  | {
      name?: string;
      host?: string;
      ip?: string;
      port?: number;
    };

export interface DiscoveryConfig {
  /** Always include localhost / 127.0.0.1 (default true). */
  localhost?: boolean;
  /** Use Tailscale peers when the CLI is available (default true). */
  tailscale?: boolean;
  /** TCP-scan local LAN CIDRs for open Ollama ports (default false). */
  lan?: boolean;
  /** Explicit CIDRs for LAN scan (default: guessed /24s from local interfaces). */
  cidrs?: string[];
}

export interface HostTarget {
  hostname: string;
  dnsName: string;
  ip: string;
  online: boolean;
  os: string;
  isSelf: boolean;
  source: HostSource;
  port: number;
}

interface TailscalePeer {
  HostName?: string;
  DNSName?: string;
  TailscaleIPs?: string[];
  Online?: boolean;
  OS?: string;
}

interface TailscaleStatus {
  Self?: TailscalePeer;
  Peer?: Record<string, TailscalePeer>;
  MagicDNSSuffix?: string;
  CurrentTailnet?: { Name?: string; MagicDNSSuffix?: string };
}

export interface DiscoveryResult {
  hosts: HostTarget[];
  sources: string[];
  networkLabel: string;
}

export interface DiscoverOptions {
  hosts?: HostConfigEntry[];
  discovery?: DiscoveryConfig;
  /** Include Tailscale peers marked offline. */
  includeOffline?: boolean;
  /** Probe local LAN CIDRs for open Ollama ports. */
  lanScan?: boolean;
}

function cleanDnsName(dnsName: string | undefined): string {
  if (!dnsName) return "";
  return dnsName.replace(/\.$/, "");
}

function pickIpv4(ips: string[] | undefined): string | undefined {
  return ips?.find((ip) => !ip.includes(":"));
}

export function shortName(host: HostTarget): string {
  if (host.dnsName) {
    return host.dnsName.split(".")[0] ?? host.hostname;
  }
  return host.hostname;
}

export function ollamaBaseUrl(host: HostTarget, port = host.port || OLLAMA_PORT): string {
  const hostPart = host.ip.includes(":") ? `[${host.ip}]` : host.ip;
  return `http://${hostPart}:${port}`;
}

function makeHost(partial: {
  hostname: string;
  ip: string;
  source: HostSource;
  dnsName?: string;
  online?: boolean;
  os?: string;
  isSelf?: boolean;
  port?: number;
}): HostTarget {
  return {
    hostname: partial.hostname,
    dnsName: partial.dnsName ?? "",
    ip: partial.ip,
    online: partial.online ?? true,
    os: partial.os ?? "unknown",
    isSelf: partial.isSelf ?? false,
    source: partial.source,
    port: partial.port ?? OLLAMA_PORT,
  };
}

function dedupeKey(host: HostTarget): string {
  return `${host.ip}:${host.port}`;
}

function mergeHosts(hosts: HostTarget[]): HostTarget[] {
  const byKey = new Map<string, HostTarget>();
  for (const host of hosts) {
    const key = dedupeKey(host);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, host);
      continue;
    }
    // Prefer named / richer metadata when merging duplicates.
    byKey.set(key, {
      ...existing,
      hostname:
        existing.hostname === existing.ip && host.hostname !== host.ip
          ? host.hostname
          : existing.hostname,
      dnsName: existing.dnsName || host.dnsName,
      online: existing.online || host.online,
      os: existing.os !== "unknown" ? existing.os : host.os,
      isSelf: existing.isSelf || host.isSelf,
      source: existing.source === "direct" ? host.source : existing.source,
    });
  }

  return [...byKey.values()].sort((a, b) => {
    if (a.isSelf !== b.isSelf) return a.isSelf ? -1 : 1;
    return shortName(a).localeCompare(shortName(b));
  });
}

function localhostTargets(): HostTarget[] {
  const hostname = os.hostname() || "localhost";
  return [
    makeHost({
      hostname,
      dnsName: "localhost",
      ip: "127.0.0.1",
      source: "localhost",
      isSelf: true,
      online: true,
      os: process.platform,
    }),
  ];
}

function parseHostEntry(entry: HostConfigEntry): HostTarget | null {
  if (typeof entry === "string") {
    const trimmed = entry.trim();
    if (!trimmed) return null;
    return makeHost({
      hostname: trimmed,
      ip: trimmed,
      source: "config",
      online: true,
    });
  }
  const address = (entry.host ?? entry.ip ?? "").trim();
  if (!address) return null;
  const name = (entry.name ?? address).trim();
  return makeHost({
    hostname: name,
    dnsName: address.includes(".") ? address : "",
    ip: address,
    source: "config",
    online: true,
    port: typeof entry.port === "number" ? entry.port : OLLAMA_PORT,
  });
}

function envHostTargets(): HostTarget[] {
  const raw = process.env.OLLANET_HOSTS ?? "";
  return raw
    .split(/[,;\s]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((address) =>
      makeHost({
        hostname: address,
        ip: address,
        source: "env",
        online: true,
      }),
    );
}

function peerToTarget(peer: TailscalePeer, isSelf: boolean): HostTarget | null {
  const ip = pickIpv4(peer.TailscaleIPs);
  if (!ip) return null;
  return makeHost({
    hostname: peer.HostName ?? ip,
    dnsName: cleanDnsName(peer.DNSName),
    ip,
    online: peer.Online ?? false,
    os: peer.OS ?? "unknown",
    isSelf,
    source: "tailscale",
  });
}

async function tryTailscaleTargets(includeOffline: boolean): Promise<{
  hosts: HostTarget[];
  label?: string;
}> {
  try {
    const { stdout } = await execFileAsync("tailscale", ["status", "--json"], {
      maxBuffer: 20 * 1024 * 1024,
      windowsHide: true,
    });
    const status = JSON.parse(stdout) as TailscaleStatus;
    const hosts: HostTarget[] = [];
    if (status.Self) {
      const self = peerToTarget(status.Self, true);
      if (self) hosts.push(self);
    }
    for (const peer of Object.values(status.Peer ?? {})) {
      const target = peerToTarget(peer, false);
      if (!target) continue;
      if (!includeOffline && !target.online && !target.isSelf) continue;
      hosts.push(target);
    }
    const label =
      status.CurrentTailnet?.Name ??
      status.MagicDNSSuffix ??
      status.CurrentTailnet?.MagicDNSSuffix;
    return { hosts, label };
  } catch {
    return { hosts: [] };
  }
}

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
}

function intToIpv4(value: number): string {
  return [
    (value >>> 24) & 255,
    (value >>> 16) & 255,
    (value >>> 8) & 255,
    value & 255,
  ].join(".");
}

function cidrToIps(cidr: string): string[] {
  const [base, bitsRaw] = cidr.split("/");
  if (!base || !bitsRaw) return [];
  const bits = Number(bitsRaw);
  if (!Number.isInteger(bits) || bits < 16 || bits > 30) return [];
  const baseInt = ipv4ToInt(base);
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  const network = (baseInt & mask) >>> 0;
  const size = 2 ** (32 - bits);
  const ips: string[] = [];
  // Skip network + broadcast addresses.
  for (let i = 1; i < size - 1; i += 1) {
    ips.push(intToIpv4((network + i) >>> 0));
  }
  return ips;
}

function guessLocalCidrs(): string[] {
  const cidrs = new Set<string>();
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (String(entry.family) !== "IPv4") continue;
      if (entry.internal) continue;
      const ip = entry.address;
      if (!ip || ip.startsWith("127.")) continue;
      // Prefer a /24 around each interface address for scan speed.
      const parts = ip.split(".").map(Number);
      if (parts.length !== 4) continue;
      cidrs.add(`${parts[0]}.${parts[1]}.${parts[2]}.0/24`);
    }
  }
  return [...cidrs];
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function run(): Promise<void> {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index]!);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, Math.max(items.length, 1)) }, () => run()),
  );
  return results;
}

async function tcpOpen(ip: string, port: number, timeoutMs: number): Promise<boolean> {
  return await new Promise((resolve) => {
    const socket = net.connect({ host: ip, port });
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, timeoutMs);
    socket.once("connect", () => {
      clearTimeout(timer);
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

async function lanScanTargets(cidrs: string[], port: number): Promise<HostTarget[]> {
  const timeoutMs = envInt("OLLANET_LAN_TIMEOUT_MS", 200);
  const concurrency = Math.max(1, envInt("OLLANET_LAN_CONCURRENCY", 64));
  const ips = [...new Set(cidrs.flatMap((cidr) => cidrToIps(cidr)))];
  if (ips.length === 0) return [];

  const flags = await mapPool(ips, concurrency, async (ip) => ({
    ip,
    open: await tcpOpen(ip, port, timeoutMs),
  }));

  return flags
    .filter((f) => f.open)
    .map((f) =>
      makeHost({
        hostname: f.ip,
        ip: f.ip,
        source: "lan",
        online: true,
        port,
      }),
    );
}

/**
 * True for IPs, FQDNs, and host:port — not bare words.
 * Bare words must match a discovered host so typos get a helpful error.
 */
function looksLikeAddress(query: string): boolean {
  const q = query.trim();
  if (!q || /\s/.test(q)) return false;
  if (/^\d{1,3}(\.\d{1,3}){3}(:\d+)?$/.test(q)) return true;
  if (/^\[[0-9a-f:]+\](:\d+)?$/i.test(q)) return true;
  if (/^[a-z0-9][a-z0-9._-]*:\d+$/i.test(q)) return true;
  if (q.includes(".") && /^[a-z0-9][a-z0-9.-]+$/i.test(q)) return true;
  return false;
}

function parseDirectAddress(query: string): HostTarget | null {
  const q = query.trim();
  if (!looksLikeAddress(q)) return null;

  let hostname = q;
  let ip = q;
  let port = OLLAMA_PORT;

  const ipv4WithPort = q.match(/^(\d{1,3}(?:\.\d{1,3}){3}):(\d+)$/);
  if (ipv4WithPort) {
    ip = ipv4WithPort[1]!;
    hostname = ip;
    port = Number(ipv4WithPort[2]);
  } else {
    // host:port with or without dots. Requires a single colon + numeric port so
    // bare IPv6 (multiple colons) is left alone.
    const hostPort = q.match(/^([a-z0-9][a-z0-9._-]*):(\d+)$/i);
    if (hostPort) {
      hostname = hostPort[1]!;
      ip = hostname;
      port = Number(hostPort[2]);
    } else {
      const bracketed = q.match(/^\[([0-9a-f:]+)\]:(\d+)$/i);
      if (bracketed) {
        ip = bracketed[1]!;
        hostname = ip;
        port = Number(bracketed[2]);
      }
    }
  }

  return makeHost({
    hostname,
    ip,
    source: "direct",
    online: true,
    port,
  });
}

/** Discover candidate Ollama hosts from localhost, config, env, Tailscale, and optional LAN scan. */
export async function discoverHosts(opts: DiscoverOptions = {}): Promise<DiscoveryResult> {
  const discovery = opts.discovery ?? {};
  const sources: string[] = [];
  const collected: HostTarget[] = [];
  const labels: string[] = [];

  if (discovery.localhost !== false) {
    collected.push(...localhostTargets());
    sources.push("localhost");
  }

  const fromConfig = (opts.hosts ?? [])
    .map(parseHostEntry)
    .filter((h): h is HostTarget => h != null);
  if (fromConfig.length > 0) {
    collected.push(...fromConfig);
    sources.push("config");
  }

  const fromEnv = envHostTargets();
  if (fromEnv.length > 0) {
    collected.push(...fromEnv);
    sources.push("env");
  }

  if (discovery.tailscale !== false) {
    const { hosts, label } = await tryTailscaleTargets(opts.includeOffline ?? false);
    if (hosts.length > 0) {
      collected.push(...hosts);
      sources.push("tailscale");
      if (label) labels.push(label);
    }
  }

  const lanEnabled = opts.lanScan ?? discovery.lan === true;
  if (lanEnabled) {
    const cidrs =
      discovery.cidrs && discovery.cidrs.length > 0 ? discovery.cidrs : guessLocalCidrs();
    const lanHosts = await lanScanTargets(cidrs, OLLAMA_PORT);
    if (lanHosts.length > 0) {
      collected.push(...lanHosts);
      sources.push("lan");
      labels.push(...cidrs);
    } else {
      sources.push("lan");
    }
  }

  const hosts = mergeHosts(collected);
  const networkLabel =
    labels[0] ??
    (sources.includes("tailscale")
      ? "tailscale"
      : sources.includes("lan")
        ? "lan"
        : sources.join("+") || "local");

  return { hosts, sources, networkLabel };
}

function hostNameMatches(host: HostTarget, q: string): boolean {
  const names = [host.hostname, host.dnsName, shortName(host), host.ip].map((n) =>
    n.toLowerCase(),
  );
  return names.includes(q) || names.some((n) => n.startsWith(`${q}.`));
}

/**
 * Match a query against already-discovered hosts only (no direct-address fallback).
 * Used when peeling an optional leading hostname before a prompt.
 */
export function findDiscoveredHost(
  targets: HostTarget[],
  query: string,
): HostTarget | undefined {
  const q = query.trim().toLowerCase().replace(/\.$/, "");
  if (!q) return undefined;
  const matches = targets.filter((host) => hostNameMatches(host, q));
  if (matches.length === 1) return matches[0];
  return undefined;
}

/** Resolve a machine name against discovered hosts, or treat it as a direct address. */
export function resolveHost(targets: HostTarget[], query: string): HostTarget {
  const q = query.trim().toLowerCase().replace(/\.$/, "");
  if (!q) {
    throw new Error("Machine name is empty.");
  }

  const matches = targets.filter((host) => hostNameMatches(host, q));

  if (matches.length === 1) return matches[0]!;
  if (matches.length > 1) {
    const list = matches.map((h) => `${shortName(h)} (${h.ip})`).join(", ");
    throw new Error(`Ambiguous machine "${query}". Matches: ${list}`);
  }

  const direct = parseDirectAddress(query);
  if (direct) return direct;

  const available = targets.map((h) => shortName(h)).join(", ") || "(none)";
  throw new Error(
    `Unknown machine "${query}". Known hosts: ${available}\n` +
      `Tip: pass an IP/hostname directly, add it under config.hosts, or set OLLANET_HOSTS.`,
  );
}
