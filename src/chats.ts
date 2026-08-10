#!/usr/bin/env node
/**
 * List saved ollanet chats.
 *
 * Usage:
 *   ollanet chats
 *   ollanet chats --json
 *   ollanet chats --id a1b2c3d4e5f6
 */

import {
  loadChat,
  listChats,
  responsesDir,
  type ChatTranscript,
} from "./chat-store.ts";

function usage(): never {
  console.error(`Usage: ollanet chats [--json] [--id <hash>]

Lists transcripts in ${responsesDir()}.

Options:
  --json       Machine-readable output
  --id <hash>  Show one chat (messages included with --json, preview otherwise)`);
  process.exit(1);
}

function parseArgs(argv: string[]): { json: boolean; id?: string } {
  const args = [...argv];
  let json = false;
  let id: string | undefined;

  while (args.length > 0) {
    const arg = args.shift()!;
    if (arg === "--") continue;
    if (arg === "--help" || arg === "-h") usage();
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--id" || arg.startsWith("--id=")) {
      id = arg.includes("=") ? arg.slice("--id=".length) : args.shift();
      if (!id) {
        console.error("--id requires a value");
        usage();
      }
      continue;
    }
    console.error(`Unknown flag: ${arg}`);
    usage();
  }

  return { json, id };
}

function pad(value: string, width: number): string {
  if (value.length >= width) return `${value.slice(0, width - 1)}…`;
  return value.padEnd(width);
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}

function summarize(chat: ChatTranscript) {
  return {
    id: chat.id,
    topic: chat.topic,
    machine: chat.machine,
    model: chat.model,
    messages: chat.messages.length,
    created_at: chat.created_at,
    updated_at: chat.updated_at,
    system: chat.system ?? null,
  };
}

function printTable(chats: ChatTranscript[]): void {
  if (chats.length === 0) {
    console.log(`No chats in ${responsesDir()}`);
    console.log(`Start one with: ollanet prompt <machine> "hello"`);
    return;
  }

  console.log(
    `${pad("ID", 14)} ${pad("UPDATED", 17)} ${pad("MACHINE", 18)} ${pad("MODEL", 22)} ${pad("MSGS", 5)} TOPIC`,
  );
  for (const chat of chats) {
    console.log(
      `${pad(chat.id, 14)} ${pad(formatWhen(chat.updated_at), 17)} ${pad(chat.machine, 18)} ${pad(chat.model, 22)} ${pad(String(chat.messages.length), 5)} ${chat.topic}`,
    );
  }
  console.log(`\n${chats.length} chat(s) in ${responsesDir()}`);
  console.log(`Continue: ollanet prompt --chat <id> "follow-up"`);
}

function printPreview(chat: ChatTranscript): void {
  console.log(`id:       ${chat.id}`);
  console.log(`topic:    ${chat.topic}`);
  console.log(`machine:  ${chat.machine}`);
  console.log(`model:    ${chat.model}`);
  console.log(`created:  ${chat.created_at}`);
  console.log(`updated:  ${chat.updated_at}`);
  if (chat.system) console.log(`system:   ${chat.system}`);
  console.log(`messages: ${chat.messages.length}`);
  console.log("");
  for (const msg of chat.messages) {
    const who = msg.role.padEnd(9);
    const when = formatWhen(msg.timestamp);
    const body = msg.content.replace(/\s+/g, " ").trim();
    const preview = body.length > 160 ? `${body.slice(0, 157)}...` : body;
    console.log(`[${when}] ${who} ${preview}`);
  }
  console.log(`\nContinue: ollanet prompt --chat ${chat.id} "follow-up"`);
}

export async function main(): Promise<void> {
  const { json, id } = parseArgs(process.argv.slice(2));

  if (id) {
    const chat = await loadChat(id);
    if (json) {
      console.log(JSON.stringify(chat, null, 2));
    } else {
      printPreview(chat);
    }
    return;
  }

  const chats = await listChats();
  if (json) {
    console.log(JSON.stringify(chats.map(summarize), null, 2));
    return;
  }
  printTable(chats);
}
