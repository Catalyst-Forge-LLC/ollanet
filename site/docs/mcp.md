---
title: MCP
---

```bash
ollanet mcp
```

Stdio MCP server (no extra npm deps). Cursor / Claude Desktop / any MCP host can spawn it.

## Tools

| Tool | What it does |
|---|---|
| `ollanet_scan` | Discover hosts + models |
| `ollanet_prompt` | Prompt or continue with `chat_id` |
| `ollanet_compare` | Same prompt on 2–5 models |
| `ollanet_pull` / `show` / `rm` / `ps` | Model management |
| `ollanet_list_chats` / `get_chat` | Transcripts |

## Cursor example

```json
{
  "mcpServers": {
    "ollanet": {
      "command": "npx",
      "args": ["-y", "ollanet", "mcp"]
    }
  }
}
```

From a checkout: `"command": "pnpm"`, `"args": ["ollanet", "--", "mcp"]` with `cwd` set to the repo. Uses the same config/chats dirs as the CLI.
