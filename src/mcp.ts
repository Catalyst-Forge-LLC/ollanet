/**
 * ollanet mcp — stdio MCP server (zero deps).
 *
 * Speaks the Model Context Protocol over stdin/stdout so agents (Cursor,
 * Claude Desktop, etc.) can discover hosts, prompt models, and continue chats.
 *
 *   ollanet mcp
 *
 * stdout is reserved for JSON-RPC; log only to stderr.
 */

import { createInterface } from "node:readline";
import { readFile } from "node:fs/promises";
import { listChats, loadChat } from "./chat-store.ts";
import type { GenerateSettings } from "./config.ts";
import { projectPath } from "./paths.ts";
import { listLoaded } from "./ps.ts";
import { pullModel } from "./pull.ts";
import { runPrompt } from "./prompt.ts";
import { removeModel } from "./rm.ts";
import { lastScan } from "./scan-store.ts";
import { scanNetwork } from "./scan.ts";
import { showModel } from "./show.ts";

// Pin to the oldest widely-supported MCP revision. Clients may request a newer
// date; we still answer with this — legal negotiation, max compatibility.
const PROTOCOL_VERSION = "2024-11-05";

type JsonRpcId = string | number | null;

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: JsonRpcId;
  method?: string;
  params?: unknown;
}

interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const TOOLS: ToolDef[] = [
  {
    name: "ollanet_scan",
    description:
      "Discover reachable Ollama hosts and list their models. " +
      "Use this before routing work to pick a host/model. " +
      "Optional LAN TCP scan (off unless lan=true; equivalent to CLI --lan) and include offline Tailscale peers.",
    inputSchema: {
      type: "object",
      properties: {
        lan: {
          type: "boolean",
          description: "TCP-scan local LAN CIDRs for open Ollama ports (default false)",
        },
        all: {
          type: "boolean",
          description: "Also probe offline Tailscale peers (default false)",
        },
        last: {
          type: "boolean",
          description: "Return the last saved scan without probing the network (default false)",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "ollanet_prompt",
    description:
      "Send a prompt to an Ollama host on the network (or continue a saved chat by id). " +
      "Returns the assistant reply and chat_id for follow-ups. " +
      "Machine can be a discovered name, MagicDNS name, hostname, or IP[:port].",
    inputSchema: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description: "User message to send",
        },
        machine: {
          type: "string",
          description: "Host name/IP (required for new chats; optional override when continuing)",
        },
        model: {
          type: "string",
          description: "Model name (optional; uses config default or chat model)",
        },
        chat_id: {
          type: "string",
          description: "Continue a saved chat by its hex hash id",
        },
        system: {
          type: "string",
          description: "System prompt (new chats, or if the chat has none yet)",
        },
        temperature: { type: "number" },
        num_predict: { type: "integer" },
        num_ctx: { type: "integer" },
        keep_alive: {
          description: 'Keep model loaded (e.g. "5m", 0, -1)',
        },
        think: {
          type: "boolean",
          description: "Enable model thinking (default false)",
        },
        save: {
          type: "boolean",
          description: "Persist the transcript (default true)",
        },
      },
      required: ["prompt"],
      additionalProperties: false,
    },
  },
  {
    name: "ollanet_pull",
    description:
      "Pull (or update) a model onto a reachable Ollama host. " +
      "The named machine downloads from the registry onto its own disk — " +
      "ollanet does not upload weights. Machine is a discovered name, MagicDNS name, hostname, or IP[:port].",
    inputSchema: {
      type: "object",
      properties: {
        machine: {
          type: "string",
          description: "Host name/IP that should download the model",
        },
        model: {
          type: "string",
          description: "Model to pull (e.g. gemma3:12b)",
        },
        insecure: {
          type: "boolean",
          description: "Allow HTTP / self-signed model registries (default false)",
        },
      },
      required: ["machine", "model"],
      additionalProperties: false,
    },
  },
  {
    name: "ollanet_show",
    description:
      "Inspect a model on a reachable Ollama host (Modelfile, parameters, capabilities). " +
      "Marks Finetuna-style tuned names. Machine is a discovered name, MagicDNS name, hostname, or IP[:port].",
    inputSchema: {
      type: "object",
      properties: {
        machine: { type: "string", description: "Host name/IP" },
        model: { type: "string", description: "Model to inspect" },
      },
      required: ["machine", "model"],
      additionalProperties: false,
    },
  },
  {
    name: "ollanet_rm",
    description:
      "Delete a model from a reachable Ollama host's disk. Destructive. " +
      "Requires confirm=true. Machine is a discovered name, MagicDNS name, hostname, or IP[:port].",
    inputSchema: {
      type: "object",
      properties: {
        machine: { type: "string", description: "Host name/IP" },
        model: { type: "string", description: "Model to delete" },
        confirm: {
          type: "boolean",
          description: "Must be true to actually delete (default false)",
        },
      },
      required: ["machine", "model", "confirm"],
      additionalProperties: false,
    },
  },
  {
    name: "ollanet_ps",
    description:
      "List models currently loaded in VRAM. Optional machine; omit to probe every discovered host. " +
      "scan is on-disk inventory; ps is what is resident right now.",
    inputSchema: {
      type: "object",
      properties: {
        machine: {
          type: "string",
          description: "Host name/IP (optional; omit for all discovered hosts)",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "ollanet_list_chats",
    description: "List saved ollanet chat transcripts (id, topic, machine, model, message count).",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "ollanet_get_chat",
    description: "Load one saved chat by id, including full message history.",
    inputSchema: {
      type: "object",
      properties: {
        chat_id: {
          type: "string",
          description: "Hex chat hash from a prior prompt",
        },
      },
      required: ["chat_id"],
      additionalProperties: false,
    },
  },
];

function writeMessage(msg: unknown): void {
  process.stdout.write(`${JSON.stringify(msg)}\n`);
}

function ok(id: JsonRpcId | undefined, result: unknown): void {
  if (id === undefined) return;
  writeMessage({ jsonrpc: "2.0", id, result });
}

function fail(id: JsonRpcId | undefined, code: number, message: string): void {
  if (id === undefined) return;
  writeMessage({ jsonrpc: "2.0", id, error: { code, message } });
}

function textResult(data: unknown, isError = false): {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
} {
  const text = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  return {
    content: [{ type: "text", text }],
    ...(isError ? { isError: true } : {}),
  };
}

async function packageVersion(): Promise<string> {
  try {
    const pkg = JSON.parse(await readFile(projectPath("package.json"), "utf8")) as {
      version?: string;
    };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

async function callTool(
  name: string,
  args: Record<string, unknown>,
): Promise<ReturnType<typeof textResult>> {
  switch (name) {
    case "ollanet_scan": {
      if (args.last === true) {
        const stored = await lastScan();
        if (!stored) {
          return textResult({ error: "No saved scan. Run ollanet_scan without last=true first." }, true);
        }
        return textResult(stored);
      }
      const payload = await scanNetwork({
        lanScan: Boolean(args.lan),
        includeOffline: Boolean(args.all),
      });
      return textResult(payload);
    }
    case "ollanet_prompt": {
      const prompt = typeof args.prompt === "string" ? args.prompt : "";
      if (!prompt.trim()) {
        return textResult({ error: "prompt is required" }, true);
      }
      const settings: GenerateSettings = {};
      if (typeof args.system === "string") settings.system = args.system;
      if (typeof args.temperature === "number") settings.temperature = args.temperature;
      if (typeof args.num_predict === "number") settings.num_predict = Math.trunc(args.num_predict);
      if (typeof args.num_ctx === "number") settings.num_ctx = Math.trunc(args.num_ctx);
      if (typeof args.think === "boolean") settings.think = args.think;
      if (args.keep_alive !== undefined) {
        const raw = args.keep_alive;
        if (typeof raw === "number") settings.keep_alive = raw;
        else if (typeof raw === "string") {
          const asNum = Number(raw);
          settings.keep_alive =
            raw.trim() !== "" && Number.isFinite(asNum) && String(asNum) === raw ? asNum : raw;
        }
      }
      const result = await runPrompt({
        prompt,
        machine: typeof args.machine === "string" ? args.machine : undefined,
        model: typeof args.model === "string" ? args.model : undefined,
        chatId: typeof args.chat_id === "string" ? args.chat_id : undefined,
        save: args.save === undefined ? true : Boolean(args.save),
        settings,
        writeStdout: false,
        stream: false,
        quiet: true,
      });
      return textResult(result);
    }
    case "ollanet_pull": {
      const machine = typeof args.machine === "string" ? args.machine : "";
      const model = typeof args.model === "string" ? args.model : "";
      if (!machine.trim()) return textResult({ error: "machine is required" }, true);
      if (!model.trim()) return textResult({ error: "model is required" }, true);
      const result = await pullModel({
        machine,
        model,
        insecure: args.insecure === true,
        writeStdout: false,
        quiet: true,
      });
      return textResult(result);
    }
    case "ollanet_show": {
      const machine = typeof args.machine === "string" ? args.machine : "";
      const model = typeof args.model === "string" ? args.model : "";
      if (!machine.trim()) return textResult({ error: "machine is required" }, true);
      if (!model.trim()) return textResult({ error: "model is required" }, true);
      return textResult(await showModel({ machine, model }));
    }
    case "ollanet_rm": {
      const machine = typeof args.machine === "string" ? args.machine : "";
      const model = typeof args.model === "string" ? args.model : "";
      if (!machine.trim()) return textResult({ error: "machine is required" }, true);
      if (!model.trim()) return textResult({ error: "model is required" }, true);
      if (args.confirm !== true) {
        return textResult({ error: "confirm must be true to delete a model" }, true);
      }
      return textResult(await removeModel({ machine, model, yes: true }));
    }
    case "ollanet_ps": {
      const machine = typeof args.machine === "string" ? args.machine : undefined;
      return textResult(await listLoaded({ machine }));
    }
    case "ollanet_list_chats": {
      const chats = await listChats();
      return textResult(
        chats.map((c) => ({
          id: c.id,
          topic: c.topic,
          machine: c.machine,
          model: c.model,
          messages: c.messages.length,
          created_at: c.created_at,
          updated_at: c.updated_at,
        })),
      );
    }
    case "ollanet_get_chat": {
      const id = typeof args.chat_id === "string" ? args.chat_id : "";
      if (!id) return textResult({ error: "chat_id is required" }, true);
      const chat = await loadChat(id);
      return textResult(chat);
    }
    default:
      return textResult({ error: `Unknown tool: ${name}` }, true);
  }
}

async function handleRequest(msg: JsonRpcRequest, version: string): Promise<void> {
  const { id, method } = msg;
  if (!method) {
    fail(id, -32600, "Invalid Request: missing method");
    return;
  }

  // Notifications (no id) — acknowledge silently.
  if (method === "notifications/initialized" || method.startsWith("notifications/")) {
    return;
  }

  switch (method) {
    case "initialize":
      ok(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: "ollanet", version },
      });
      return;
    case "ping":
      ok(id, {});
      return;
    case "tools/list":
      ok(id, { tools: TOOLS });
      return;
    case "tools/call": {
      const params = (msg.params ?? {}) as { name?: string; arguments?: Record<string, unknown> };
      const name = params.name;
      if (!name) {
        fail(id, -32602, "tools/call requires params.name");
        return;
      }
      try {
        const result = await callTool(name, params.arguments ?? {});
        ok(id, result);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        ok(id, textResult({ error: message }, true));
      }
      return;
    }
    default:
      fail(id, -32601, `Method not found: ${method}`);
  }
}

export async function main(): Promise<void> {
  const version = await packageVersion();
  console.error(`ollanet mcp ${version} (stdio) — tools: ${TOOLS.map((t) => t.name).join(", ")}`);

  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let msg: JsonRpcRequest;
    try {
      msg = JSON.parse(trimmed) as JsonRpcRequest;
    } catch {
      writeMessage({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: "Parse error" },
      });
      continue;
    }

    // JSON-RPC batch
    if (Array.isArray(msg)) {
      for (const item of msg) {
        await handleRequest(item as JsonRpcRequest, version);
      }
      continue;
    }

    await handleRequest(msg, version);
  }
}
