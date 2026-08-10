import { randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { defaultResponsesDir } from "./paths.ts";

export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
  timestamp: string;
  machine?: string;
  model?: string;
  stats?: {
    eval_count?: number;
    eval_duration?: number;
    total_duration?: number;
    prompt_eval_count?: number;
  };
}

export interface ChatTranscript {
  id: string;
  topic: string;
  created_at: string;
  updated_at: string;
  machine: string;
  model: string;
  system?: string;
  messages: ChatMessage[];
}

const RESPONSES_DIR =
  process.env.OLLANET_RESPONSES_DIR ??
  process.env.OLLAMA_RESPONSES_DIR ??
  defaultResponsesDir();

export function responsesDir(): string {
  return RESPONSES_DIR;
}

export function newChatId(): string {
  return randomBytes(6).toString("hex");
}

export function chatPath(id: string): string {
  const safe = normalizeChatId(id);
  return path.join(RESPONSES_DIR, `${safe}.json`);
}

export function normalizeChatId(id: string): string {
  const cleaned = id.trim().toLowerCase().replace(/\.json$/i, "");
  if (!/^[a-f0-9]{8,32}$/.test(cleaned)) {
    throw new Error(`Invalid chat id "${id}". Expected a hex hash from a prior prompt.`);
  }
  return cleaned;
}

export async function ensureResponsesDir(): Promise<string> {
  await mkdir(RESPONSES_DIR, { recursive: true });
  return RESPONSES_DIR;
}

export async function loadChat(id: string): Promise<ChatTranscript> {
  const safe = normalizeChatId(id);
  try {
    const raw = await readFile(chatPath(safe), "utf8");
    const parsed = JSON.parse(raw) as ChatTranscript;
    if (!parsed.id || !Array.isArray(parsed.messages)) {
      throw new Error("missing id/messages");
    }
    return parsed;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      throw new Error(`Chat not found: ${safe} (${chatPath(safe)})`);
    }
    throw new Error(
      `Failed to load chat ${safe}: ${err instanceof Error ? err.message : err}`,
    );
  }
}

export async function saveChat(chat: ChatTranscript): Promise<string> {
  await ensureResponsesDir();
  const file = chatPath(chat.id);
  await writeFile(file, `${JSON.stringify(chat, null, 2)}\n`, "utf8");
  return file;
}

export function createChat(opts: {
  machine: string;
  model: string;
  system?: string;
  topic?: string;
}): ChatTranscript {
  const now = new Date().toISOString();
  return {
    id: newChatId(),
    topic: opts.topic?.trim() || "Untitled chat",
    created_at: now,
    updated_at: now,
    machine: opts.machine,
    model: opts.model,
    ...(opts.system ? { system: opts.system } : {}),
    messages: [],
  };
}

export function appendMessage(
  chat: ChatTranscript,
  message: Omit<ChatMessage, "timestamp"> & { timestamp?: string },
): ChatMessage {
  const entry: ChatMessage = {
    ...message,
    timestamp: message.timestamp ?? new Date().toISOString(),
  };
  chat.messages.push(entry);
  chat.updated_at = entry.timestamp;
  if (message.machine) chat.machine = message.machine;
  if (message.model) chat.model = message.model;
  return entry;
}

export async function listChats(): Promise<ChatTranscript[]> {
  await ensureResponsesDir();
  const files = (await readdir(RESPONSES_DIR))
    .filter((f) => f.endsWith(".json"))
    .sort();

  const chats: ChatTranscript[] = [];
  for (const file of files) {
    try {
      const raw = await readFile(path.join(RESPONSES_DIR, file), "utf8");
      const parsed = JSON.parse(raw) as ChatTranscript;
      if (parsed.id && Array.isArray(parsed.messages)) chats.push(parsed);
    } catch {
      // skip corrupt files
    }
  }

  chats.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  return chats;
}

/** Fallback topic from the first user message when model summarization fails. */
export function topicFromPrompt(prompt: string): string {
  const oneLine = prompt.replace(/\s+/g, " ").trim();
  if (!oneLine) return "Untitled chat";
  if (oneLine.length <= 72) return oneLine;
  return `${oneLine.slice(0, 69).trimEnd()}...`;
}

export function cleanTopic(raw: string, fallback: string): string {
  const cleaned = raw
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/^(topic|title)\s*:\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return fallback;
  if (cleaned.length <= 80) return cleaned;
  return `${cleaned.slice(0, 77).trimEnd()}...`;
}

export function toApiMessages(
  chat: ChatTranscript,
): Array<{ role: ChatRole; content: string }> {
  const out: Array<{ role: ChatRole; content: string }> = [];
  if (chat.system) {
    out.push({ role: "system", content: chat.system });
  }
  for (const msg of chat.messages) {
    if (msg.role === "system") continue;
    out.push({ role: msg.role, content: msg.content });
  }
  return out;
}
