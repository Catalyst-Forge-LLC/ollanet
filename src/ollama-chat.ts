/**
 * Shared Ollama /api/chat client used by prompt and bench.
 */
import type { GenerateSettings } from "./config.ts";

export interface ChatChunk {
  model?: string;
  message?: { role?: string; content?: string; thinking?: string };
  done?: boolean;
  done_reason?: string;
  error?: string;
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  eval_count?: number;
  eval_duration?: number;
}

export interface OllamaChatOptions {
  baseUrl: string;
  model: string;
  messages: Array<{ role: string; content: string }>;
  stream: boolean;
  settings: GenerateSettings;
  /** Write assistant content to stdout / thinking to stderr when streaming. */
  writeStdout: boolean;
  /** Timeout in ms; 0 = none. */
  timeoutMs: number;
}

export interface OllamaChatResult {
  content: string;
  thinking: string;
  chunk: ChatChunk;
}

function buildOptions(settings: GenerateSettings): Record<string, unknown> {
  const options: Record<string, unknown> = {};
  if (settings.temperature != null) options.temperature = settings.temperature;
  if (settings.num_predict != null) options.num_predict = settings.num_predict;
  if (settings.num_ctx != null) options.num_ctx = settings.num_ctx;
  if (settings.seed != null) options.seed = settings.seed;
  return options;
}

function parseChunk(url: string, raw: string): ChatChunk {
  try {
    return JSON.parse(raw) as ChatChunk;
  } catch {
    throw new Error(
      `Non-JSON response from ${url} (is something else on this port?): ${raw.slice(0, 120)}`,
    );
  }
}

/** POST /api/chat with optional streaming and AbortSignal timeout. */
export async function ollamaChat(opts: OllamaChatOptions): Promise<OllamaChatResult> {
  const url = `${opts.baseUrl}/api/chat`;
  // Default think:false — thinking models otherwise burn num_predict on hidden reasoning.
  const think = opts.settings.think === true;
  const body: Record<string, unknown> = {
    model: opts.model,
    messages: opts.messages,
    stream: opts.stream,
    think,
  };

  if (opts.settings.keep_alive != null) body.keep_alive = opts.settings.keep_alive;
  if (opts.settings.format !== undefined) body.format = opts.settings.format;

  const options = buildOptions(opts.settings);
  if (Object.keys(options).length > 0) body.options = options;

  const controller = new AbortController();
  const timer =
    opts.timeoutMs > 0 ? setTimeout(() => controller.abort(), opts.timeoutMs) : undefined;

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    if (timer) clearTimeout(timer);
    const name = err instanceof Error ? err.name : "";
    if (name === "AbortError") {
      throw new Error(`Prompt timed out after ${opts.timeoutMs}ms (${url})`);
    }
    throw err;
  }

  if (!res.ok) {
    if (timer) clearTimeout(timer);
    const text = await res.text().catch(() => "");
    throw new Error(`Ollama HTTP ${res.status} ${res.statusText}${text ? `: ${text}` : ""}`);
  }

  try {
    if (!opts.stream) {
      const chunk = parseChunk(url, await res.text());
      if (chunk.error) throw new Error(chunk.error);
      const content = chunk.message?.content ?? "";
      const thinking = chunk.message?.thinking ?? "";
      if (opts.writeStdout) {
        if (think && thinking) {
          process.stderr.write(`${thinking}\n---\n`);
        }
        const visible = content || thinking;
        if (visible) process.stdout.write(`${visible}\n`);
      }
      return { content: content || thinking, thinking, chunk };
    }

    if (!res.body) throw new Error("No response body from Ollama");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let last: ChatChunk = {};
    let content = "";
    let thinking = "";
    let thinkingHeader = false;

    const handleChunk = (chunk: ChatChunk): void => {
      if (chunk.error) throw new Error(chunk.error);
      const thinkPiece = chunk.message?.thinking ?? "";
      const contentPiece = chunk.message?.content ?? "";
      if (thinkPiece) {
        thinking += thinkPiece;
        if (opts.writeStdout && think) {
          if (!thinkingHeader) {
            process.stderr.write("[thinking]\n");
            thinkingHeader = true;
          }
          process.stderr.write(thinkPiece);
        }
      }
      if (contentPiece) {
        content += contentPiece;
        if (opts.writeStdout) {
          if (thinkingHeader) {
            process.stderr.write("\n---\n");
            thinkingHeader = false;
          }
          process.stdout.write(contentPiece);
        }
      }
      last = chunk;
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        handleChunk(parseChunk(url, trimmed));
      }
    }

    const trailing = buffer.trim();
    if (trailing) {
      handleChunk(parseChunk(url, trailing));
    }

    if (opts.writeStdout && !content && thinking) {
      if (think) process.stderr.write("\n---\n");
      process.stdout.write(`${thinking}\n`);
    } else if (opts.writeStdout && content.length > 0 && !content.endsWith("\n")) {
      process.stdout.write("\n");
    }

    return { content: content || thinking, thinking, chunk: last };
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    if (name === "AbortError") {
      throw new Error(`Prompt timed out after ${opts.timeoutMs}ms (${url})`);
    }
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export interface OllamaModelInfo {
  name: string;
  digest?: string;
  size?: number;
  details?: {
    parameter_size?: string;
    quantization_level?: string;
    family?: string;
  };
}

export async function ollamaTags(
  baseUrl: string,
  timeoutMs: number,
): Promise<OllamaModelInfo[]> {
  const url = `${baseUrl}/api/tags`;
  const body = await ollamaGetJson<{ models?: OllamaModelInfo[] }>(url, timeoutMs);
  return body.models ?? [];
}

export async function ollamaShow(
  baseUrl: string,
  model: string,
  timeoutMs: number,
): Promise<{ capabilities?: string[] }> {
  const url = `${baseUrl}/api/show`;
  return ollamaPostJson(url, { model }, timeoutMs);
}

export async function ollamaVersion(
  baseUrl: string,
  timeoutMs: number,
): Promise<string | undefined> {
  try {
    const body = await ollamaGetJson<{ version?: string }>(`${baseUrl}/api/version`, timeoutMs);
    return body.version;
  } catch {
    return undefined;
  }
}

export interface PsModel {
  name?: string;
  model?: string;
  size_vram?: number;
  context_length?: number;
  digest?: string;
}

export interface PullChunk {
  status?: string;
  digest?: string;
  total?: number;
  completed?: number;
  error?: string;
}

export interface OllamaPullOptions {
  baseUrl: string;
  model: string;
  /** Allow HTTP / self-signed registries (Ollama `insecure`). */
  insecure?: boolean;
  stream: boolean;
  timeoutMs: number;
  onProgress?: (chunk: PullChunk) => void;
}

export interface OllamaPullResult {
  status: string;
  chunks: PullChunk[];
}

function parsePullChunk(url: string, raw: string): PullChunk {
  try {
    return JSON.parse(raw) as PullChunk;
  } catch {
    throw new Error(
      `Non-JSON response from ${url} (is something else on this port?): ${raw.slice(0, 120)}`,
    );
  }
}

/**
 * POST /api/pull — the *server* downloads the model. The client only sends the
 * request. Default timeout 0 (none): large pulls can take hours.
 */
export async function ollamaPull(opts: OllamaPullOptions): Promise<OllamaPullResult> {
  const url = `${opts.baseUrl}/api/pull`;
  const body: Record<string, unknown> = {
    model: opts.model,
    stream: opts.stream,
  };
  if (opts.insecure) body.insecure = true;

  const controller = new AbortController();
  const timer =
    opts.timeoutMs > 0 ? setTimeout(() => controller.abort(), opts.timeoutMs) : undefined;

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    if (timer) clearTimeout(timer);
    const name = err instanceof Error ? err.name : "";
    if (name === "AbortError") {
      throw new Error(`Pull timed out after ${opts.timeoutMs}ms (${url})`);
    }
    throw err;
  }

  if (!res.ok) {
    if (timer) clearTimeout(timer);
    const text = await res.text().catch(() => "");
    let detail = text;
    try {
      const parsed = JSON.parse(text) as { error?: string };
      if (parsed.error) detail = parsed.error;
    } catch {
      // keep raw text
    }
    throw new Error(`Ollama HTTP ${res.status} ${res.statusText}${detail ? `: ${detail}` : ""}`);
  }

  const chunks: PullChunk[] = [];
  const take = (chunk: PullChunk): void => {
    if (chunk.error) throw new Error(chunk.error);
    chunks.push(chunk);
    opts.onProgress?.(chunk);
  };

  try {
    if (!opts.stream) {
      take(parsePullChunk(url, await res.text()));
    } else {
      if (!res.body) throw new Error("No response body from Ollama");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          take(parsePullChunk(url, trimmed));
        }
      }
      const trailing = buffer.trim();
      if (trailing) take(parsePullChunk(url, trailing));
    }
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    if (name === "AbortError") {
      throw new Error(`Pull timed out after ${opts.timeoutMs}ms (${url})`);
    }
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }

  const last = chunks.at(-1);
  const status = last?.status ?? "";
  if (status !== "success") {
    throw new Error(status ? `Pull ended: ${status}` : "Pull failed (no success status)");
  }
  return { status, chunks };
}

export async function ollamaPs(baseUrl: string, timeoutMs: number): Promise<PsModel[]> {
  try {
    const body = await ollamaGetJson<{ models?: PsModel[] }>(`${baseUrl}/api/ps`, timeoutMs);
    return body.models ?? [];
  } catch {
    return [];
  }
}

function modelKey(name: string): string {
  return name.trim().toLowerCase();
}

export function psHasModel(models: PsModel[], name: string): boolean {
  const key = modelKey(name);
  return models.some((m) => {
    const n = (m.name ?? m.model ?? "").toLowerCase();
    return n === key || n.startsWith(`${key}:`) || key.startsWith(`${n}:`);
  });
}

function findPsModel(models: PsModel[], name: string): PsModel | undefined {
  const key = modelKey(name);
  return models.find((m) => {
    const n = (m.name ?? m.model ?? "").toLowerCase();
    return n === key || n.startsWith(`${key}:`) || key.startsWith(`${n}:`);
  });
}

export function vramForModel(models: PsModel[], name: string): number | undefined {
  return findPsModel(models, name)?.size_vram;
}

export function contextLengthForModel(
  models: PsModel[],
  name: string,
): number | undefined {
  return findPsModel(models, name)?.context_length;
}

/**
 * Capability filter: omitempty / empty means "unknown → treat as completion".
 * Only skip when a non-empty capabilities array is present and lacks completion.
 */
export function isCompletionCapable(capabilities: string[] | undefined | null): boolean {
  if (capabilities == null || capabilities.length === 0) return true;
  return capabilities.includes("completion");
}

/**
 * Vision-capable models (moondream, llava, …) often fail a text-only suite.
 * Only true when capabilities are present and include vision — absent/empty → false
 * (don't skip unknown older servers).
 */
export function isVisionCapable(capabilities: string[] | undefined | null): boolean {
  if (capabilities == null || capabilities.length === 0) return false;
  return capabilities.includes("vision");
}

/** True when capabilities are known and lack thinking (absent/empty → no warning). */
export function shouldWarnNoThinking(capabilities: string[] | undefined | null): boolean {
  if (capabilities == null || capabilities.length === 0) return false;
  return !capabilities.includes("thinking");
}

/** Poll /api/ps until model is absent (or timeout). Returns elapsed ms. */
export async function waitUntilUnloaded(
  baseUrl: string,
  model: string,
  timeoutMs: number,
  pollMs = 200,
): Promise<{ unloaded: boolean; waitedMs: number }> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const models = await ollamaPs(baseUrl, Math.min(5000, timeoutMs));
    if (!psHasModel(models, model)) {
      return { unloaded: true, waitedMs: Date.now() - started };
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  return { unloaded: false, waitedMs: Date.now() - started };
}

/** Request unload via keep_alive: 0 (no-op-ish if already unloaded after a short chat). */
export async function ollamaUnload(
  baseUrl: string,
  model: string,
  timeoutMs: number,
): Promise<void> {
  await ollamaChat({
    baseUrl,
    model,
    messages: [{ role: "user", content: "ping" }],
    stream: false,
    writeStdout: false,
    timeoutMs,
    settings: { keep_alive: 0, num_predict: 1, think: false },
  });
}

async function ollamaGetJson<T>(url: string, timeoutMs: number): Promise<T> {
  const controller = new AbortController();
  const timer = timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : undefined;
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`Ollama HTTP ${res.status} ${res.statusText} (${url})`);
    }
    const text = await res.text();
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new Error(
        `Non-JSON response from ${url} (is something else on this port?): ${text.slice(0, 120)}`,
      );
    }
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function ollamaPostJson<T>(
  url: string,
  body: unknown,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController();
  const timer = timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : undefined;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `Ollama HTTP ${res.status} ${res.statusText}${text ? `: ${text}` : ""} (${url})`,
      );
    }
    const text = await res.text();
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new Error(
        `Non-JSON response from ${url} (is something else on this port?): ${text.slice(0, 120)}`,
      );
    }
  } finally {
    if (timer) clearTimeout(timer);
  }
}
