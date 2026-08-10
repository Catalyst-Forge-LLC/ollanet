import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const OLLAMA_PORT = Number(process.env.OLLAMA_PORT ?? 11434);

export interface TailscalePeer {
  HostName?: string;
  DNSName?: string;
  TailscaleIPs?: string[];
  Online?: boolean;
  OS?: string;
}

export interface TailscaleStatus {
  Self?: TailscalePeer;
  Peer?: Record<string, TailscalePeer>;
  MagicDNSSuffix?: string;
  CurrentTailnet?: { Name?: string; MagicDNSSuffix?: string };
}

export interface HostTarget {
  hostname: string;
  dnsName: string;
  ip: string;
  online: boolean;
  os: string;
  isSelf: boolean;
}

export function cleanDnsName(dnsName: string | undefined): string {
  if (!dnsName) return "";
  return dnsName.replace(/\.$/, "");
}

export function pickIpv4(ips: string[] | undefined): string | undefined {
  return ips?.find((ip) => !ip.includes(":"));
}

export function peerToTarget(peer: TailscalePeer, isSelf: boolean): HostTarget | null {
  const ip = pickIpv4(peer.TailscaleIPs);
  if (!ip) return null;
  return {
    hostname: peer.HostName ?? ip,
    dnsName: cleanDnsName(peer.DNSName),
    ip,
    online: peer.Online ?? false,
    os: peer.OS ?? "unknown",
    isSelf,
  };
}

export async function getTailscaleStatus(): Promise<TailscaleStatus> {
  try {
    const { stdout } = await execFileAsync("tailscale", ["status", "--json"], {
      maxBuffer: 20 * 1024 * 1024,
      windowsHide: true,
    });
    return JSON.parse(stdout) as TailscaleStatus;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Failed to run \`tailscale status --json\`. Is Tailscale installed and on PATH?\n${message}`,
    );
  }
}

export function collectTargets(status: TailscaleStatus): HostTarget[] {
  const targets: HostTarget[] = [];
  if (status.Self) {
    const self = peerToTarget(status.Self, true);
    if (self) targets.push(self);
  }
  for (const peer of Object.values(status.Peer ?? {})) {
    const target = peerToTarget(peer, false);
    if (target) targets.push(target);
  }
  targets.sort((a, b) => {
    if (a.isSelf !== b.isSelf) return a.isSelf ? -1 : 1;
    return a.hostname.localeCompare(b.hostname);
  });
  return targets;
}

export function shortName(host: HostTarget): string {
  if (host.dnsName) {
    return host.dnsName.split(".")[0] ?? host.hostname;
  }
  return host.hostname;
}

/** Match hostname, MagicDNS short/FQDN, or Tailscale IP (case-insensitive). */
export function resolveHost(targets: HostTarget[], query: string): HostTarget {
  const q = query.trim().toLowerCase().replace(/\.$/, "");
  if (!q) {
    throw new Error("Machine name is empty.");
  }

  const matches = targets.filter((host) => {
    const names = [
      host.hostname,
      host.dnsName,
      shortName(host),
      host.ip,
    ].map((n) => n.toLowerCase());
    return names.includes(q) || names.some((n) => n.startsWith(`${q}.`));
  });

  if (matches.length === 1) return matches[0]!;
  if (matches.length > 1) {
    const list = matches.map((h) => `${shortName(h)} (${h.ip})`).join(", ");
    throw new Error(`Ambiguous machine "${query}". Matches: ${list}`);
  }

  const available = targets.map((h) => shortName(h)).join(", ");
  throw new Error(`Unknown machine "${query}". Known peers: ${available}`);
}

export function ollamaBaseUrl(host: HostTarget, port = OLLAMA_PORT): string {
  return `http://${host.ip}:${port}`;
}
