#!/usr/bin/env node
/**
 * Run a prompt / continue a chat against an Ollama server on the network.
 *
 * New chat (saved by default):
 *   ollanet prompt mycroftone "What is Tailscale?"
 *   ollanet prompt 192.168.1.50 "Hello"
 *
 * Continue:
 *   ollanet prompt --chat a1b2c3d4e5f6 "Tell me more"
 *
 * List chats:
 *   ollanet chats
 */

import { stdin as stdinStream } from "node:process";
import {
  appendMessage,
  cleanTopic,
  createChat,
  loadChat,
  saveChat,
  toApiMessages,
  topicFromPrompt,
  type ChatTranscript,
} from "./chat-store.ts";
import {
  configPath,
  defaultModelForHost,
  loadConfig,
  machineSettingsForHost,
  mergeSettings,
  parseFormat,
  settingsFromEnv,
  settingsSummary,
  type GenerateSettings,
} from "./config.ts";
import {
  discoverHosts,
  ollamaBaseUrl,
  resolveHost,
  shortName,
  type HostTarget,
} from "./hosts.ts";

interface ChatChunk {
  model?: string;
  message?: { role?: string; content?: string; thinking?: string };
  done?: boolean;
  error?: string;
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  eval_count?: number;
  eval_duration?: number;
}

function usage(): never {
  console.error(`Usage:
  ollanet prompt <machine> [model] <prompt...>
  ollanet prompt --chat <hash> <prompt...>
  ollanet prompt <machine> --chat <hash> <prompt...>

Examples:
  ollanet prompt mycroftone "Explain MagicDNS"
  ollanet prompt --chat a1b2c3d4e5f6 "Give an example"
  ollanet prompt mycroftone --temperature 0.2 --num-predict 64 "2+2?"
  ollanet chats

Each reply is saved under responses/<hash>.json and the hash is printed so you
can continue later with --chat. Use --no-save to skip persistence.

Config: ${configPath()}
Precedence: CLI > env > machineDefaults > defaults

Options:
  --chat <hash>          Continue a saved chat
  --machine <name>       Machine (new chat positional, or override when using --chat)
  --no-save              Do not write/update a responses/*.json transcript
  --model <name>         Model (overrides config / chat default)
  --system <text>        System prompt (new chats only unless chat has none)
  --temperature <n>      Sampling temperature
  --num-predict <n>      Max tokens to generate
  --num-ctx <n>          Context window size
  --keep-alive <value>   Keep model loaded (e.g. 5m, 0, -1)
  --format <json|schema> Force JSON mode or a JSON schema string
  --think                Enable model thinking (qwen3 etc.); streams to stderr
  --no-think             Disable thinking (default) so tokens go to the reply
  --no-stream            Wait for the full response
  --json                 Emit final response JSON (implies --no-stream)`);
  process.exit(1);
}

function looksLikeModel(value: string): boolean {
  return value.includes(":") || value.includes("/");
}

function takeValue(args: string[], flag: string): string {
  const value = args.shift();
  if (!value) {
    console.error(`${flag} requires a value`);
    usage();
  }
  return value;
}

function parseNumberFlag(raw: string, flag: string): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    console.error(`${flag} must be a number (got "${raw}")`);
    usage();
  }
  return n;
}

function parseArgs(argv: string[]): {
  machine?: string;
  model?: string;
  promptParts: string[];
  stream: boolean;
  json: boolean;
  save: boolean;
  chatId?: string;
  settings: GenerateSettings;
} {
  const args = [...argv];
  let machineFlag: string | undefined;
  let modelFlag: string | undefined;
  let chatId: string | undefined;
  let stream = true;
  let json = false;
  let save = true;
  const settings: GenerateSettings = {};
  const positional: string[] = [];

  while (args.length > 0) {
    const arg = args.shift()!;
    if (arg === "--") continue;
    if (arg === "--help" || arg === "-h") usage();
    if (arg === "--no-stream") {
      stream = false;
      continue;
    }
    if (arg === "--json") {
      json = true;
      stream = false;
      continue;
    }
    if (arg === "--no-save") {
      save = false;
      continue;
    }
    if (arg === "--think") {
      settings.think = true;
      continue;
    }
    if (arg === "--no-think") {
      settings.think = false;
      continue;
    }

    if (arg === "--chat" || arg.startsWith("--chat=")) {
      chatId = arg.includes("=") ? arg.slice("--chat=".length) : takeValue(args, "--chat");
      continue;
    }
    if (arg === "--machine" || arg.startsWith("--machine=")) {
      machineFlag = arg.includes("=") ? arg.slice("--machine=".length) : takeValue(args, "--machine");
      continue;
    }
    if (arg === "--model" || arg.startsWith("--model=")) {
      modelFlag = arg.includes("=") ? arg.slice("--model=".length) : takeValue(args, "--model");
      continue;
    }
    if (arg === "--system" || arg.startsWith("--system=")) {
      settings.system = arg.includes("=")
        ? arg.slice("--system=".length)
        : takeValue(args, "--system");
      continue;
    }
    if (arg === "--temperature" || arg === "-t" || arg.startsWith("--temperature=")) {
      const raw = arg.includes("=") ? arg.slice("--temperature=".length) : takeValue(args, "--temperature");
      settings.temperature = parseNumberFlag(raw, "--temperature");
      continue;
    }
    if (arg === "--num-predict" || arg.startsWith("--num-predict=")) {
      const raw = arg.includes("=") ? arg.slice("--num-predict=".length) : takeValue(args, "--num-predict");
      settings.num_predict = Math.trunc(parseNumberFlag(raw, "--num-predict"));
      continue;
    }
    if (arg === "--num-ctx" || arg.startsWith("--num-ctx=")) {
      const raw = arg.includes("=") ? arg.slice("--num-ctx=".length) : takeValue(args, "--num-ctx");
      settings.num_ctx = Math.trunc(parseNumberFlag(raw, "--num-ctx"));
      continue;
    }
    if (arg === "--keep-alive" || arg.startsWith("--keep-alive=")) {
      const raw = arg.includes("=") ? arg.slice("--keep-alive=".length) : takeValue(args, "--keep-alive");
      const asNum = Number(raw);
      settings.keep_alive = raw.trim() !== "" && Number.isFinite(asNum) && String(asNum) === raw ? asNum : raw;
      continue;
    }
    if (arg === "--format" || arg.startsWith("--format=")) {
      const raw = arg.includes("=") ? arg.slice("--format=".length) : takeValue(args, "--format");
      const format = parseFormat(raw);
      if (format !== undefined) settings.format = format;
      continue;
    }

    if (arg.startsWith("-")) {
      console.error(`Unknown flag: ${arg}`);
      usage();
    }
    positional.push(arg);
  }

  let machine = machineFlag;
  let model = modelFlag;
  let promptParts = positional;

  if (!chatId) {
    // New chat: <machine> [model] <prompt...>
    if (!machine) {
      if (positional.length < 1) usage();
      machine = positional[0];
      promptParts = positional.slice(1);
    }
    if (!model && promptParts.length > 0 && looksLikeModel(promptParts[0]!)) {
      model = promptParts[0];
      promptParts = promptParts.slice(1);
    }
  }
  // Continue (--chat): all positionals are the prompt. Optional machine override
  // via --machine, or a leading discovered-host name peeled in main().

  return { machine, model, promptParts, stream, json, save, chatId, settings };
}

async function readStdinIfPiped(): Promise<string> {
  if (stdinStream.isTTY) return "";
  const chunks: Buffer[] = [];
  for await (const chunk of stdinStream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8").trim();
}

function buildOptions(settings: GenerateSettings): Record<string, unknown> {
  const options: Record<string, unknown> = {};
  if (settings.temperature != null) options.temperature = settings.temperature;
  if (settings.num_predict != null) options.num_predict = settings.num_predict;
  if (settings.num_ctx != null) options.num_ctx = settings.num_ctx;
  return options;
}

async function runChat(opts: {
  baseUrl: string;
  model: string;
  messages: Array<{ role: string; content: string }>;
  stream: boolean;
  settings: GenerateSettings;
  writeStdout: boolean;
}): Promise<{ content: string; thinking: string; chunk: ChatChunk }> {
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

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Ollama HTTP ${res.status} ${res.statusText}${text ? `: ${text}` : ""}`);
  }

  if (!opts.stream) {
    const chunk = (await res.json()) as ChatChunk;
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
      handleChunk(JSON.parse(trimmed) as ChatChunk);
    }
  }

  const trailing = buffer.trim();
  if (trailing) {
    handleChunk(JSON.parse(trailing) as ChatChunk);
  }

  // If the model only emitted thinking (budget exhausted), surface it on stdout.
  if (opts.writeStdout && !content && thinking) {
    if (think) process.stderr.write("\n---\n");
    process.stdout.write(`${thinking}\n`);
  } else if (opts.writeStdout && content.length > 0 && !content.endsWith("\n")) {
    process.stdout.write("\n");
  }

  return { content: content || thinking, thinking, chunk: last };
}

async function generateTopic(opts: {
  baseUrl: string;
  model: string;
  prompt: string;
  settings: GenerateSettings;
}): Promise<string> {
  const fallback = topicFromPrompt(opts.prompt);
  try {
    const { content } = await runChat({
      baseUrl: opts.baseUrl,
      model: opts.model,
      stream: false,
      writeStdout: false,
      settings: mergeSettings(opts.settings, {
        temperature: 0.2,
        num_predict: 24,
        think: false,
        // keep_alive 0 so topic pass doesn't pin the model longer than needed
        keep_alive: 0,
      }),
      messages: [
        {
          role: "user",
          content:
            "Write a concise 3-8 word topic title for the following user message. " +
            "Reply with only the title, no quotes or punctuation wrapping.\n\n" +
            opts.prompt,
        },
      ],
    });
    return cleanTopic(content, fallback);
  } catch {
    return fallback;
  }
}

function formatDuration(ns: number | undefined): string {
  if (ns == null) return "";
  const ms = ns / 1e6;
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  const { promptParts, stream, json, save } = parsed;

  const fromArgs = promptParts.join(" ").trim();
  const fromStdin = await readStdinIfPiped();
  const prompt = [fromArgs, fromStdin].filter(Boolean).join("\n\n").trim();
  if (!prompt) {
    console.error("No prompt provided (pass args and/or pipe stdin).");
    usage();
  }

  const config = await loadConfig();
  const { hosts: targets } = await discoverHosts({
    hosts: config.hosts,
    discovery: config.discovery,
  });

  let chat: ChatTranscript | undefined;
  let isNewChat = false;
  let machineQuery = parsed.machine;
  let promptText = prompt;

  if (parsed.chatId) {
    chat = await loadChat(parsed.chatId);

    // Allow `ollanet prompt mycroftone --chat HASH "follow-up"` by peeling a
    // leading positional that matches a discovered host.
    if (!machineQuery && promptParts.length >= 2) {
      try {
        resolveHost(targets, promptParts[0]!);
        machineQuery = promptParts[0];
        promptText = [...promptParts.slice(1), fromStdin].filter(Boolean).join("\n\n").trim();
      } catch {
        // first token is part of the prompt
      }
    }
  }

  machineQuery = machineQuery ?? chat?.machine;
  if (!machineQuery) {
    console.error("Machine is required for a new chat (or use --chat <hash>).");
    usage();
  }
  if (!promptText) {
    console.error("No prompt provided (pass args and/or pipe stdin).");
    usage();
  }

  const host: HostTarget = resolveHost(targets, machineQuery);
  if (!host.online && !host.isSelf && host.source === "tailscale") {
    throw new Error(`Machine "${shortName(host)}" appears offline.`);
  }

  const model =
    parsed.model ??
    chat?.model ??
    defaultModelForHost(config, host);
  if (!model) {
    throw new Error(
      `No model specified for "${shortName(host)}" and no default in ${configPath()}.\n` +
        `Pass a model, use --model <name>, or add it under defaultModels.`,
    );
  }

  const settings = mergeSettings(
    // Thinking models otherwise spend the whole num_predict budget on hidden reasoning.
    { think: false },
    config.defaults,
    machineSettingsForHost(config, host),
    settingsFromEnv(),
    chat?.system ? { system: chat.system } : undefined,
    parsed.settings,
  );

  if (!chat && save) {
    chat = createChat({
      machine: shortName(host),
      model,
      system: settings.system,
      topic: topicFromPrompt(promptText),
    });
    isNewChat = true;
  } else if (!chat) {
    // --no-save one-shot: ephemeral transcript for the API call only
    chat = createChat({
      machine: shortName(host),
      model,
      system: settings.system,
    });
    isNewChat = true;
  } else {
    if (parsed.settings.system && !chat.system) {
      chat.system = parsed.settings.system;
    }
    chat.model = model;
    chat.machine = shortName(host);
  }

  appendMessage(chat, { role: "user", content: promptText });

  const baseUrl = ollamaBaseUrl(host);
  if (!json) {
    const src = parsed.model ? "explicit" : chat && !isNewChat ? "chat" : "default";
    const extras = settingsSummary(settings);
    const chatTag = parsed.chatId ? `  chat=${chat.id}` : "";
    console.error(
      `→ ${shortName(host)} (${host.ip})  model=${model}  [${src}]${chatTag}${extras ? `  ${extras}` : ""}`,
    );
  }

  const { content, thinking, chunk } = await runChat({
    baseUrl,
    model,
    messages: toApiMessages(chat),
    stream: json ? false : stream,
    writeStdout: !json,
    settings,
  });

  appendMessage(chat, {
    role: "assistant",
    content,
    ...(thinking ? { thinking } : {}),
    machine: shortName(host),
    model,
    stats: {
      eval_count: chunk.eval_count,
      eval_duration: chunk.eval_duration,
      total_duration: chunk.total_duration,
      prompt_eval_count: chunk.prompt_eval_count,
    },
  });

  if (isNewChat && save) {
    chat.topic = await generateTopic({
      baseUrl,
      model,
      prompt: promptText,
      settings,
    });
  }

  if (save) {
    const file = await saveChat(chat);
    if (!json) {
      console.error(`chat ${chat.id}  topic: ${chat.topic}`);
      console.error(`saved ${file}`);
      console.error(`continue: ollanet prompt --chat ${chat.id} "your follow-up"`);
    }
  }

  if (json) {
    console.log(
      JSON.stringify(
        {
          chat_id: save ? chat.id : null,
          topic: chat.topic,
          content,
          thinking: thinking || null,
          ollama: chunk,
        },
        null,
        2,
      ),
    );
    return;
  }

  const stats = [
    chunk.eval_count != null ? `${chunk.eval_count} tokens` : "",
    chunk.eval_duration
      ? `${((chunk.eval_count ?? 0) / (chunk.eval_duration / 1e9)).toFixed(1)} tok/s`
      : "",
    chunk.total_duration ? formatDuration(chunk.total_duration) : "",
  ].filter(Boolean);
  if (stats.length > 0) {
    console.error(`(${stats.join(" · ")})`);
  }
}
