---
tool_facts_version: "0.1.0"
name: ollanet MCP Server
developer: Catalyst Forge
version: "0.6.6"
status: active
license: Apache-2.0
kind: mcp-server
homepage: https://ollanet.dev
repository: https://github.com/Catalyst-Forge-LLC/ollanet
runtime:
  execution: local-process
  transport: stdio
credentials:
  required: []
egress:
  telemetry: none
  destinations: []
tools:
  - name: ollanet_scan
    purpose: "Discover reachable Ollama hosts and list their models; optional LAN TCP scan"
    side_effects: read
    reach:
      filesystem: none
      network: unrestricted
      processes: false
    idempotent: true
  - name: ollanet_prompt
    purpose: "Send a prompt to an Ollama host or continue a saved chat; may persist transcript locally"
    side_effects: write
    reach:
      filesystem: scoped
      network: unrestricted
      processes: false
    idempotent: false
  - name: ollanet_compare
    purpose: "Run the same prompt against multiple hosts/models and return a comparison"
    side_effects: write
    reach:
      filesystem: scoped
      network: unrestricted
      processes: false
    idempotent: false
  - name: ollanet_pull
    purpose: "Pull (download) a model onto a remote Ollama host"
    side_effects: write
    reach:
      filesystem: none
      network: unrestricted
      processes: false
    idempotent: false
  - name: ollanet_show
    purpose: "Show model metadata from an Ollama host"
    side_effects: read
    reach:
      filesystem: none
      network: unrestricted
      processes: false
    idempotent: true
  - name: ollanet_rm
    purpose: "Remove a model from an Ollama host"
    side_effects: destructive
    reach:
      filesystem: none
      network: unrestricted
      processes: false
    idempotent: false
  - name: ollanet_ps
    purpose: "List models currently loaded on an Ollama host"
    side_effects: read
    reach:
      filesystem: none
      network: unrestricted
      processes: false
    idempotent: true
  - name: ollanet_list_chats
    purpose: "List locally saved chat transcripts"
    side_effects: read
    reach:
      filesystem: scoped
      network: none
      processes: false
    idempotent: true
  - name: ollanet_get_chat
    purpose: "Load one locally saved chat transcript by id"
    side_effects: read
    reach:
      filesystem: scoped
      network: none
      processes: false
    idempotent: true
generated:
  date: 2026-08-20
  generator: hand-authored (tools inventory from ollanet mcp 0.6.6)
credits:
  generated_with: https://toolfacts.dev
  built_by: "Catalyst Forge - https://www.catalystforge.com/"
---

# Tool Facts - ollanet MCP Server

| | |
|---|---|
| **Developer** | Catalyst Forge |
| **Version** | 0.6.6 |
| **Status** | active |
| **License** | Apache-2.0 |
| **Kind** | mcp-server |

## Runtime

| | |
|---|---|
| Execution | local-process |
| Transport | stdio |

## Credentials

None required.

## Egress

| | |
|---|---|
| Telemetry | none |
| Destinations | (none) |

## Tools (9)

| Tool | Side effects | Filesystem | Network | Processes | Idempotent |
|---|---|---|---|---|---|
| `ollanet_scan` | read | none | unrestricted | no | yes |
| `ollanet_prompt` | write | scoped | unrestricted | no | no |
| `ollanet_compare` | write | scoped | unrestricted | no | no |
| `ollanet_pull` | write | none | unrestricted | no | no |
| `ollanet_show` | read | none | unrestricted | no | yes |
| `ollanet_rm` | destructive | none | unrestricted | no | no |
| `ollanet_ps` | read | none | unrestricted | no | yes |
| `ollanet_list_chats` | read | scoped | none | no | yes |
| `ollanet_get_chat` | read | scoped | none | no | yes |

**Purpose lines**

| Tool | Purpose |
|---|---|
| `ollanet_scan` | Discover reachable Ollama hosts and list their models; optional LAN TCP scan |
| `ollanet_prompt` | Send a prompt to an Ollama host or continue a saved chat; may persist transcript locally |
| `ollanet_compare` | Run the same prompt against multiple hosts/models and return a comparison |
| `ollanet_pull` | Pull (download) a model onto a remote Ollama host |
| `ollanet_show` | Show model metadata from an Ollama host |
| `ollanet_rm` | Remove a model from an Ollama host |
| `ollanet_ps` | List models currently loaded on an Ollama host |
| `ollanet_list_chats` | List locally saved chat transcripts |
| `ollanet_get_chat` | Load one locally saved chat transcript by id |

---
*Generated with [ToolFacts](https://toolfacts.dev) · Built by [Catalyst Forge](https://www.catalystforge.com/)*
