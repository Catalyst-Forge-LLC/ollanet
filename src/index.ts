/**
 * ollanet — Node library for discovering and talking to Ollama on any
 * reachable network (loopback, LAN, Tailscale, VPN).
 *
 * Node 20+ only. Not for the browser. LAN scan is opt-in.
 *
 *   import { scanNetwork } from "ollanet";
 *   const { servers } = await scanNetwork({ lanScan: false });
 */

export { scanNetwork } from "./scan.ts";
export type { ScanOptions, ScanPayload, ScannedServer } from "./scan.ts";

export {
  discoverHosts,
  resolveHost,
  ollamaBaseUrl,
  shortName,
  ollamaPort,
} from "./hosts.ts";
export type {
  DiscoverOptions,
  DiscoveryResult,
  HostTarget,
  HostSource,
  HostConfigEntry,
} from "./hosts.ts";

export {
  loadConfig,
  defaultModelForHost,
  mergeSettings,
  configFromPartial,
} from "./config.ts";
export type { AppConfig, DiscoveryConfig, GenerateSettings } from "./config.ts";

export { runPrompt } from "./prompt.ts";
export type { PromptRunOptions, PromptRunResult } from "./prompt.ts";

export { pullModel } from "./pull.ts";
export type { PullOptions, PullResult } from "./pull.ts";

export { ollamaChat, ollamaTags, ollamaShow, ollamaPs, ollamaPull } from "./ollama-chat.ts";
export type { PullChunk, OllamaPullOptions, OllamaPullResult } from "./ollama-chat.ts";
