import { readFile } from "node:fs/promises";
import {
  shortName,
  type DiscoveryConfig,
  type HostConfigEntry,
  type HostTarget,
} from "./hosts.ts";
import { projectPath } from "./paths.ts";

export type { DiscoveryConfig, HostConfigEntry };

/** Runtime knobs sent to Ollama `/api/generate`. */
export interface GenerateSettings {
  temperature?: number;
  num_predict?: number;
  num_ctx?: number;
  keep_alive?: string | number;
  /** `"json"` or a JSON-schema object */
  format?: "json" | Record<string, unknown>;
  system?: string;
}

export interface AppConfig {
  /** Explicit hosts/IPs to probe (LAN, VPN, MagicDNS, etc.). */
  hosts: HostConfigEntry[];
  discovery: DiscoveryConfig;
  defaultModels: Record<string, string>;
  /** Global defaults applied to every prompt. */
  defaults: GenerateSettings;
  /** Per-machine overrides (keyed by short name / hostname / DNS / IP). */
  machineDefaults: Record<string, GenerateSettings & { model?: string }>;
}

function emptyConfig(): AppConfig {
  return {
    hosts: [],
    discovery: {},
    defaultModels: {},
    defaults: {},
    machineDefaults: {},
  };
}

const CONFIG_PATH =
  process.env.OLLANET_CONFIG ??
  process.env.OLLAMA_CONFIG ??
  projectPath("config.json");

export async function loadConfig(): Promise<AppConfig> {
  try {
    const raw = await readFile(CONFIG_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<AppConfig> & {
      defaultModels?: Record<string, string>;
    };
    const machineDefaults = normalizeMachineDefaults(parsed.machineDefaults);
    const defaultModels = {
      ...normalizeStringMap(parsed.defaultModels),
      // Allow `machineDefaults.<host>.model` as an alternate place to set defaults.
      ...Object.fromEntries(
        Object.entries(machineDefaults)
          .filter(([, v]) => typeof v.model === "string" && v.model.trim())
          .map(([k, v]) => [k, v.model!.trim()]),
      ),
    };

    return {
      hosts: Array.isArray(parsed.hosts) ? parsed.hosts : [],
      discovery: normalizeDiscovery(parsed.discovery),
      defaultModels,
      defaults: normalizeSettings(parsed.defaults),
      machineDefaults,
    };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return emptyConfig();
    }
    throw new Error(
      `Failed to read config at ${CONFIG_PATH}: ${err instanceof Error ? err.message : err}`,
    );
  }
}

function normalizeDiscovery(input: unknown): DiscoveryConfig {
  if (!input || typeof input !== "object") return {};
  const src = input as Record<string, unknown>;
  const out: DiscoveryConfig = {};
  if (typeof src.localhost === "boolean") out.localhost = src.localhost;
  if (typeof src.tailscale === "boolean") out.tailscale = src.tailscale;
  if (typeof src.lan === "boolean") out.lan = src.lan;
  if (Array.isArray(src.cidrs)) {
    out.cidrs = src.cidrs.filter((c): c is string => typeof c === "string" && c.includes("/"));
  }
  return out;
}

function normalizeStringMap(map: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(map ?? {})) {
    if (typeof value !== "string" || !value.trim()) continue;
    out[key.trim().toLowerCase()] = value.trim();
  }
  return out;
}

function normalizeMachineDefaults(
  map: Record<string, GenerateSettings & { model?: string }> | undefined,
): Record<string, GenerateSettings & { model?: string }> {
  const out: Record<string, GenerateSettings & { model?: string }> = {};
  for (const [key, value] of Object.entries(map ?? {})) {
    if (!value || typeof value !== "object") continue;
    out[key.trim().toLowerCase()] = {
      ...normalizeSettings(value),
      ...(typeof value.model === "string" && value.model.trim()
        ? { model: value.model.trim() }
        : {}),
    };
  }
  return out;
}

export function normalizeSettings(input: unknown): GenerateSettings {
  if (!input || typeof input !== "object") return {};
  const src = input as Record<string, unknown>;
  const out: GenerateSettings = {};

  const temperature = asFiniteNumber(src.temperature ?? src.temp);
  if (temperature != null) out.temperature = temperature;

  const numPredict = asFiniteNumber(src.num_predict ?? src.numPredict);
  if (numPredict != null) out.num_predict = Math.trunc(numPredict);

  const numCtx = asFiniteNumber(src.num_ctx ?? src.numCtx);
  if (numCtx != null) out.num_ctx = Math.trunc(numCtx);

  const keepAlive = src.keep_alive ?? src.keepAlive;
  if (typeof keepAlive === "string" && keepAlive.trim()) {
    out.keep_alive = keepAlive.trim();
  } else if (typeof keepAlive === "number" && Number.isFinite(keepAlive)) {
    out.keep_alive = keepAlive;
  }

  const format = parseFormat(src.format);
  if (format !== undefined) out.format = format;

  if (typeof src.system === "string" && src.system.trim()) {
    out.system = src.system;
  }

  return out;
}

function asFiniteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return undefined;
}

export function parseFormat(value: unknown): GenerateSettings["format"] | undefined {
  if (value == null || value === "") return undefined;
  if (value === "json") return "json";
  if (typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "json") return "json";
    if (trimmed.startsWith("{")) {
      try {
        const parsed = JSON.parse(trimmed) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          return parsed as Record<string, unknown>;
        }
      } catch {
        throw new Error(`Invalid --format JSON schema: ${trimmed.slice(0, 80)}`);
      }
    }
    throw new Error(`Invalid format "${value}". Use "json" or a JSON schema object/string.`);
  }
  return undefined;
}

export function hostLookupKeys(host: HostTarget): string[] {
  return [
    shortName(host),
    host.hostname,
    host.dnsName,
    host.dnsName.split(".")[0] ?? "",
    host.ip,
  ]
    .map((k) => k.toLowerCase())
    .filter(Boolean);
}

/** Resolve a default model for a host using short name, hostname, DNS, or IP keys. */
export function defaultModelForHost(
  config: AppConfig,
  host: HostTarget,
): string | undefined {
  for (const key of hostLookupKeys(host)) {
    const hit = config.defaultModels[key];
    if (hit) return hit;
  }
  return undefined;
}

export function machineSettingsForHost(
  config: AppConfig,
  host: HostTarget,
): GenerateSettings {
  for (const key of hostLookupKeys(host)) {
    const hit = config.machineDefaults[key];
    if (hit) {
      const { model: _model, ...settings } = hit;
      return settings;
    }
  }
  return {};
}

/** Later layers win. Undefined values are skipped. */
export function mergeSettings(...layers: Array<GenerateSettings | undefined>): GenerateSettings {
  const out: GenerateSettings = {};
  for (const layer of layers) {
    if (!layer) continue;
    if (layer.temperature != null) out.temperature = layer.temperature;
    if (layer.num_predict != null) out.num_predict = layer.num_predict;
    if (layer.num_ctx != null) out.num_ctx = layer.num_ctx;
    if (layer.keep_alive != null) out.keep_alive = layer.keep_alive;
    if (layer.format !== undefined) out.format = layer.format;
    if (layer.system != null) out.system = layer.system;
  }
  return out;
}

export function settingsFromEnv(): GenerateSettings {
  return normalizeSettings({
    temperature: process.env.OLLAMA_TEMPERATURE,
    num_predict: process.env.OLLAMA_NUM_PREDICT,
    num_ctx: process.env.OLLAMA_NUM_CTX,
    keep_alive: process.env.OLLAMA_KEEP_ALIVE,
    format: process.env.OLLAMA_FORMAT,
    system: process.env.OLLAMA_SYSTEM,
  });
}

export function settingsSummary(settings: GenerateSettings): string {
  const parts: string[] = [];
  if (settings.temperature != null) parts.push(`temp=${settings.temperature}`);
  if (settings.num_predict != null) parts.push(`num_predict=${settings.num_predict}`);
  if (settings.num_ctx != null) parts.push(`num_ctx=${settings.num_ctx}`);
  if (settings.keep_alive != null) parts.push(`keep_alive=${settings.keep_alive}`);
  if (settings.format !== undefined) {
    parts.push(settings.format === "json" ? "format=json" : "format=<schema>");
  }
  return parts.join(" ");
}

export function configPath(): string {
  return CONFIG_PATH;
}
