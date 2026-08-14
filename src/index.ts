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
export type { ScanOptions, ScanPayload, ScannedServer, ScanFailure } from "./scan.ts";
export { lastScan, lastScanPath, loadLastScan } from "./scan-store.ts";
export type { StoredScan } from "./scan-store.ts";

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

export { runCompare } from "./compare.ts";
export type { CompareOptions, CompareRecord, CompareModelResult } from "./compare.ts";

export { assemblePrompt, readPromptFile } from "./prompt-input.ts";

export { pullModel } from "./pull.ts";
export type { PullOptions, PullResult } from "./pull.ts";

export { showModel } from "./show.ts";
export type { ShowOptions, ShowResult } from "./show.ts";

export { removeModel } from "./rm.ts";
export type { RemoveOptions, RemoveResult } from "./rm.ts";

export { listLoaded } from "./ps.ts";
export type { PsOptions, PsResult, LoadedHost, LoadedModel } from "./ps.ts";

export { looksTuned } from "./tuned.ts";

export {
  ollamaChat,
  ollamaTags,
  ollamaShow,
  ollamaPs,
  ollamaPsRequired,
  ollamaPull,
  ollamaDelete,
} from "./ollama-chat.ts";
export type {
  PullChunk,
  OllamaPullOptions,
  OllamaPullResult,
  OllamaShowInfo,
} from "./ollama-chat.ts";
