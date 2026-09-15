---
tool_facts_version: "0.1.0"
name: ollanet MCP Server
developer: Catalyst Forge
version: "0.6.12"
status: active
license: MIT
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
  destinations:
    - "User-selected Ollama hosts (prompt text, compare, bench, scan, pull, show, rm, ps)"
    - "Remote Ollama registry fetch on pull (performed by the selected host, not by this client)"
tools:
  - name: ollanet_scan
    purpose: "Discover configured or selected Ollama hosts and list their models. Optional LAN TCP scan. Reachable is not trusted."
    side_effects: read
    reach:
      filesystem: none
      network: unrestricted
      processes: false
    idempotent: true
  - name: ollanet_prompt
    purpose: "Send prompt text to a selected Ollama host or continue a saved chat. Transcripts stay on this machine unless --no-save."
    side_effects: write
    reach:
      filesystem: scoped
      network: unrestricted
      processes: false
    idempotent: false
  - name: ollanet_compare
    purpose: "Run the same prompt on 2-5 models on one Ollama host. May write compares/*.md and .json locally."
    side_effects: write
    reach:
      filesystem: scoped
      network: unrestricted
      processes: false
    idempotent: false
  - name: ollanet_pull
    purpose: "Ask a remote Ollama host to fetch a model from the registry onto that host"
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
  date: 2026-09-10
  generator: hand-authored (tools inventory from ollanet mcp 0.6.8)
credits:
  generated_with: https://toolfacts.dev
  built_by: "Catalyst Forge - https://www.catalystforge.com/"
---

# Tool Facts - ollanet MCP Server

| | |
|---|---|
| **Developer** | Catalyst Forge |
| **Version** | 0.6.12 |
| **Status** | active |
| **License** | MIT |
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
| Destinations | User-selected Ollama hosts. On pull, that host may fetch from the Ollama registry. |

No vendor telemetry is configured in this package. Commands still send traffic to the hosts you name. Prompt text goes to the selected host. Chats are stored locally (`responses/`). Other machines see a chat only if they share that directory. This list covers inspected operations. It does not prove every data path is absent.

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
| `ollanet_scan` | Discover configured or selected Ollama hosts and list their models. Optional LAN TCP scan. Reachable is not trusted. |
| `ollanet_prompt` | Send prompt text to a selected Ollama host or continue a saved chat. Transcripts stay on this machine unless --no-save. |
| `ollanet_compare` | Run the same prompt on 2-5 models on one Ollama host. May write compares/*.md and .json locally. |
| `ollanet_pull` | Ask a remote Ollama host to fetch a model from the registry onto that host |
| `ollanet_show` | Show model metadata from an Ollama host |
| `ollanet_rm` | Remove a model from an Ollama host |
| `ollanet_ps` | List models currently loaded on an Ollama host |
| `ollanet_list_chats` | List locally saved chat transcripts |
| `ollanet_get_chat` | Load one locally saved chat transcript by id |

---
*Generated with [ToolFacts](https://toolfacts.dev) · Built by [Catalyst Forge](https://www.catalystforge.com/)*

[toolfacts-label]: https://toolfacts.dev/v#tf1.eNrFlm9v5EQMxr-K5VeAsltAAqHcK1SEhNSD6nrvTqfKnfFuhpsZDx4ny6ra744mm4XedeH-6FBfJhrbz89-4sw9Tth_02GmxNijxEiZDZ5fXsMN68SKHXqeOEphxR4vySjuq8HPolvGDifWGiRjj1-vv1__gB1WIxsr9kjOwtTOxOA415b_-S8vscM3IXvsMbmyqqciOmYLTcM98p_sRjsmjeIoroqK41qxQ1PKtYga9ljNB8FDh07Zc7ZAsbZ45T_GoOyxf_X60CFvtcX292gcObHpHnvMknlmqxYytWp1OW8iLc-r-3eacqup0QXPt7zZsLPG2OJ1PIEqkxtapU2IXPfVOP1TKrPtRN9gj2PWFhacsccOFzqu2G8oVj50GDynIsbZlncdllGLzE18wUkmBoIkniNsVBJQht9ipEQwSDU8dI_UF5VU7DHBToP9u_bqpMwiP5v6G84eCI5ywOQd6SAKTrKFPDbEShN7cAPZM0i0h9LsVg1mHzgNxWC2SNyfY3aSCik_PfSLMYMNDJUSn9Alw7er745DrO1JMj_sxBF4VgoLSL34ap08UPaw_r1KPjvnMcaPBf7cDr0eY4QvvOxyFPJf_m1VyW3eoJzE-H2GrY7yYxBl8v8Xh-n4FsZPoTqZWGGuRnfxLc11nkOc3Thw0GWSz0BKWycU4erHX-Hl5TXMJOcIB9k9LeHNILtlNomNPBl98D6pTyv9qjV--XjcqMrZ4h6a39i3r-n9BG10t221fCzJmf2wwH0Kw7K_Hqy6B9utnhO-5aPuJ5Mt5Odt9Z_S4W4PwePhdYeDJC60bbGDWan9xcXCsvY8zYKL1GAy_5pPR7bBhvFu7SRdnK4dq_nasbq6ujwlmO8EY3bUTDQrPfwFHLIcOA
