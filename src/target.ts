import { configFromPartial, loadConfig, type AppConfig } from "./config.ts";
import { discoverHosts, resolveHost, shortName, type HostTarget } from "./hosts.ts";

/** Discover hosts the same way every command does (config + Tailscale + …). */
export async function listTargets(config?: Partial<AppConfig>): Promise<HostTarget[]> {
  const app = config ? configFromPartial(config) : await loadConfig();
  const { hosts } = await discoverHosts({
    hosts: app.hosts,
    discovery: app.discovery,
  });
  return hosts;
}

/** Resolve a machine name the same way pull / prompt / bench do. */
export async function resolveTarget(
  machine: string,
  config?: Partial<AppConfig>,
): Promise<HostTarget> {
  const query = machine.trim();
  if (!query) throw new Error("Machine is required.");
  const hosts = await listTargets(config);
  const host = resolveHost(hosts, query);
  if (!host.online && !host.isSelf && host.source === "tailscale") {
    throw new Error(`Machine "${shortName(host)}" appears offline.`);
  }
  return host;
}
