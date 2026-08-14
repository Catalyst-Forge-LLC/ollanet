---
title: Install
description: Install ollanet from npm or GitHub.
order: 1
---

Requires **Node.js 20+**.

### From npm

```bash
npm install -g ollanet
ollanet scan
```

Or one-off:

```bash
npx ollanet scan
```

### From GitHub

npm 12+ blocks git dependencies by default:

```bash
npx --allow-git=all github:Catalyst-Forge-LLC/ollanet scan
```

### MCP (agents)

Point your MCP host at the stdio server:

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

Tools: `ollanet_scan`, `ollanet_prompt`, `ollanet_pull`, `ollanet_list_chats`, `ollanet_get_chat`.

### Library (apps)

Node 20+ only (not the browser). Requires ollanet **0.4.0+**. `pullModel` needs **0.5.0+**.

```ts
import { scanNetwork } from "ollanet";

const { servers } = await scanNetwork({ lanScan: false });
```

### Config

Installed copies use `~/.ollanet/config.json` and store chats under `~/.ollanet/responses/`. Full flag reference lives in the [GitHub README](https://github.com/Catalyst-Forge-LLC/ollanet#readme).
