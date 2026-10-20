/**
 * Tailscale Funnel for `ollanet serve --funnel`.
 *
 * Shells out to the `tailscale` CLI (override with OLLANET_TAILSCALE_BIN; a
 * .js/.mjs/.cjs path runs under node). Every call has a timeout, and the exec
 * functions are injectable so tests never touch a real tailnet.
 */
import { spawn, spawnSync } from "node:child_process";

export interface ExecResult {
  /** Exit code, or null when the process could not start or was killed. */
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  /** The binary was not found. */
  missing: boolean;
}

export interface ExecOptions {
  timeoutMs: number;
  /** Stop early (kill the process) once combined output matches. */
  until?: RegExp;
}

export type TailscaleExec = (args: string[], opts: ExecOptions) => Promise<ExecResult>;
export type TailscaleExecSync = (args: string[], opts: { timeoutMs: number }) => ExecResult;

export const FUNNEL_PORTS = [443, 8443, 10000] as const;
export const HTTPS_ADMIN_URL = "https://login.tailscale.com/admin/dns";
export const FUNNEL_DOCS_URL = "https://tailscale.com/kb/1223/funnel";
const ENABLE_URL_RE = /https:\/\/login\.tailscale\.com\/[^\s"'<>]+/;

function tailscaleCommand(): { cmd: string; prefix: string[] } {
  const bin = process.env.OLLANET_TAILSCALE_BIN?.trim() || "tailscale";
  if (/\.(c|m)?js$/i.test(bin)) return { cmd: process.execPath, prefix: [bin] };
  return { cmd: bin, prefix: [] };
}

export const defaultExec: TailscaleExec = (args, opts) =>
  new Promise((resolve) => {
    const { cmd, prefix } = tailscaleCommand();
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    const child = spawn(cmd, [...prefix, ...args], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    const finish = (r: Partial<ExecResult>): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr, timedOut, missing: false, ...r });
    };
    const check = (): void => {
      if (opts.until && opts.until.test(`${stdout}\n${stderr}`)) child.kill();
    };
    child.stdout.on("data", (d) => {
      stdout += d;
      check();
    });
    child.stderr.on("data", (d) => {
      stderr += d;
      check();
    });
    child.on("error", (err) => {
      finish({ missing: (err as NodeJS.ErrnoException).code === "ENOENT", stderr: stderr || err.message });
    });
    child.on("close", (code) => finish({ code }));
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, opts.timeoutMs);
  });

export const defaultExecSync: TailscaleExecSync = (args, opts) => {
  const { cmd, prefix } = tailscaleCommand();
  const r = spawnSync(cmd, [...prefix, ...args], {
    encoding: "utf8",
    timeout: opts.timeoutMs,
    windowsHide: true,
  });
  const err = r.error as NodeJS.ErrnoException | undefined;
  return {
    code: r.status,
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? err?.message ?? "",
    timedOut: err?.code === "ETIMEDOUT",
    missing: err?.code === "ENOENT",
  };
};

/** A Funnel setup problem with a message meant for the person at the terminal. */
export class FunnelError extends Error {
  constructor(
    message: string,
    readonly enableUrl?: string,
  ) {
    super(message);
  }
}

interface TailscaleSelf {
  DNSName?: string;
  CapMap?: Record<string, unknown>;
  Capabilities?: string[];
}

interface TailscaleStatusJson {
  BackendState?: string;
  Self?: TailscaleSelf;
  CertDomains?: string[] | null;
}

export interface Preflight {
  /** MagicDNS name without the trailing dot. */
  dnsName: string;
  /** Funnel node attribute present (Self.CapMap / Capabilities). */
  funnelAllowed: boolean;
}

function firstLine(text: string): string {
  return text.split(/\r?\n/).find((l) => l.trim())?.trim() ?? "";
}

export function hasFunnelCap(self: TailscaleSelf | undefined): boolean {
  const keys = [...Object.keys(self?.CapMap ?? {}), ...(self?.Capabilities ?? [])];
  return keys.some((k) => {
    const key = k.toLowerCase();
    return key === "funnel" || key.startsWith("https://tailscale.com/cap/funnel");
  });
}

/** `tailscale status --json`: installed, running, MagicDNS name, HTTPS certs, Funnel attr. */
export async function preflight(exec: TailscaleExec = defaultExec): Promise<Preflight> {
  const r = await exec(["status", "--json"], { timeoutMs: 10_000 });
  if (r.missing) {
    throw new FunnelError(
      "tailscale CLI not found. Install Tailscale (https://tailscale.com/download) or set OLLANET_TAILSCALE_BIN.",
    );
  }
  if (r.timedOut) throw new FunnelError("tailscale status --json timed out.");
  let status: TailscaleStatusJson;
  try {
    status = JSON.parse(r.stdout) as TailscaleStatusJson;
  } catch {
    throw new FunnelError(
      `tailscale status --json failed${r.stderr ? `: ${firstLine(r.stderr)}` : ` (exit ${r.code})`}`,
    );
  }
  if (status.BackendState !== "Running") {
    throw new FunnelError(
      `Tailscale is not running (state: ${status.BackendState ?? "unknown"}). Run: tailscale up`,
    );
  }
  const dnsName = (status.Self?.DNSName ?? "").replace(/\.$/, "");
  if (!dnsName) {
    throw new FunnelError(`This device has no MagicDNS name. Turn on MagicDNS at ${HTTPS_ADMIN_URL}, then retry.`);
  }
  if (!Array.isArray(status.CertDomains) || status.CertDomains.length === 0) {
    throw new FunnelError(
      `HTTPS certificates are off for your tailnet. Turn on "HTTPS Certificates" at ${HTTPS_ADMIN_URL}, then retry.`,
    );
  }
  return { dnsName, funnelAllowed: hasFunnelCap(status.Self) };
}

export function funnelOnArgs(funnelPort: number, target: string): string[] {
  return ["funnel", "--bg", `--https=${funnelPort}`, target];
}

export function funnelOffArgs(funnelPort: number): string[] {
  return ["funnel", `--https=${funnelPort}`, "off"];
}

export function publicUrl(dnsName: string, funnelPort: number): string {
  return `https://${dnsName}${funnelPort === 443 ? "" : `:${funnelPort}`}/`;
}

/**
 * What `tailscale funnel status --json` serves at https://<dns>:<port>/.
 * Returns the proxy target, null when nothing is configured there, or
 * undefined when the status could not be read.
 */
export async function currentHandler(
  exec: TailscaleExec,
  dnsName: string,
  funnelPort: number,
): Promise<string | null | undefined> {
  const r = await exec(["funnel", "status", "--json"], { timeoutMs: 10_000 });
  if (r.code !== 0) return undefined;
  let parsed: { Web?: Record<string, { Handlers?: Record<string, { Proxy?: string; Path?: string; Text?: string }> }> };
  try {
    parsed = JSON.parse(r.stdout || "{}");
  } catch {
    return undefined;
  }
  const web = parsed.Web?.[`${dnsName}:${funnelPort}`];
  const root = web?.Handlers?.["/"];
  if (!web || !root) return null;
  return root.Proxy ?? root.Path ?? root.Text ?? "(non-proxy handler)";
}

function isOurTarget(handler: string, localPort: number): boolean {
  const m = /^(?:https?:\/\/)?(127\.0\.0\.1|localhost|\[::1\])?:?(\d+)\/?$/i.exec(handler.trim());
  return !!m && Number(m[2]) === localPort;
}

export interface FunnelHandle {
  publicUrl: string;
  /** False when an identical funnel was already up; stop() then leaves it alone. */
  added: boolean;
  /** Turn off only what we added. Synchronous so it can run in an exit handler. */
  stop(): void;
}

export interface StartFunnelOptions {
  localPort: number;
  /** Local URL Funnel proxies to, e.g. http://127.0.0.1:11500 */
  target: string;
  funnelPort: number;
  exec?: TailscaleExec;
  execSync?: TailscaleExecSync;
  /** Time allowed for `tailscale funnel --bg` (default 30s). */
  timeoutMs?: number;
}

export async function startFunnel(opts: StartFunnelOptions): Promise<FunnelHandle> {
  const exec = opts.exec ?? defaultExec;
  const execSync = opts.execSync ?? defaultExecSync;
  if (!(FUNNEL_PORTS as readonly number[]).includes(opts.funnelPort)) {
    throw new FunnelError(`--funnel-port must be one of ${FUNNEL_PORTS.join(", ")} (got ${opts.funnelPort}).`);
  }
  const pre = await preflight(exec);
  const url = publicUrl(pre.dnsName, opts.funnelPort);

  const existing = await currentHandler(exec, pre.dnsName, opts.funnelPort);
  if (existing && isOurTarget(existing, opts.localPort)) {
    return { publicUrl: url, added: false, stop: () => {} };
  }
  if (existing) {
    throw new FunnelError(
      `${url} already serves ${existing}. ollanet will not replace it. ` +
        `Pick another --funnel-port (${FUNNEL_PORTS.join(", ")}) or remove it with: tailscale funnel --https=${opts.funnelPort} off`,
    );
  }

  const r = await exec(funnelOnArgs(opts.funnelPort, opts.target), {
    timeoutMs: opts.timeoutMs ?? 30_000,
    until: /To enable, visit|login\.tailscale\.com\/f\/funnel/i,
  });
  const output = `${r.stdout}\n${r.stderr}`;
  const enableUrl = ENABLE_URL_RE.exec(output)?.[0];
  if (enableUrl || (!pre.funnelAllowed && r.code !== 0)) {
    throw new FunnelError(
      enableUrl
        ? `Funnel is not enabled for this device. Approve it at ${enableUrl} , then run this again.`
        : `Funnel is not enabled for this device. Add the "funnel" node attribute in your tailnet policy (${FUNNEL_DOCS_URL}), then run this again.`,
      enableUrl,
    );
  }
  if (r.missing) throw new FunnelError("tailscale CLI not found.");
  if (r.code !== 0) {
    throw new FunnelError(
      r.timedOut
        ? "tailscale funnel did not finish in time. Check tailscale funnel status."
        : `tailscale funnel failed: ${firstLine(r.stderr) || firstLine(r.stdout) || `exit ${r.code}`}`,
    );
  }

  let stopped = false;
  return {
    publicUrl: url,
    added: true,
    stop: () => {
      if (stopped) return;
      stopped = true;
      execSync(funnelOffArgs(opts.funnelPort), { timeoutMs: 10_000 });
    },
  };
}
