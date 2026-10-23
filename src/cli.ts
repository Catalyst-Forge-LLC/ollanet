#!/usr/bin/env node
/**
 * ollanet — Ollama over any reachable network (CLI, MCP, library).
 *
 *   ollanet scan
 *   ollanet prompt <machine-or-ip> "hello"
 *   ollanet compare <machine> <model> <model>
 *   ollanet pull <machine> <model>
 *   ollanet show <machine> <model>
 *   ollanet rm <machine> <model> --yes
 *   ollanet ps [machine]
 *   ollanet bench <machine> [model...]
 *   ollanet chats
 *   ollanet mcp
 *   ollanet serve [--funnel]
 */

const HELP = `ollanet: find, manage, and use Ollama on hosts you choose
A reachable host is not a trusted host. pull and rm change the remote host.

Usage:
  ollanet scan [--json] [--all] [--lan] [--last]
  ollanet prompt <machine|ip> [model] <prompt...>
  ollanet prompt --chat <hash> <prompt...>
  ollanet prompt <machine|ip> --file <path.txt|.md>
  <command> | ollanet prompt <machine|ip> [model] --stdin
  ollanet compare <machine> <model> <model> [model...] [--prompt <text> | --file <path> | --stdin]
  ollanet pull <machine|ip> <model>
  ollanet show <machine|ip> <model>
  ollanet rm <machine|ip> <model> --yes
  ollanet ps [machine]
  ollanet chats [--json] [--id <hash>]
  ollanet bench <machine|ip> [model...] [--all] [options]
  ollanet alias list|add|rm …
  ollanet mcp
  ollanet serve [--listen <host:port>] [--funnel]  (read-only catalog)
  ollanet serve status
  ollanet serve token add|list|rm|prune …
  ollanet serve label set|rm|list …
  ollanet help [command]

Examples:
  Find hosts
    ollanet scan
    ollanet scan --lan                # also sweep your subnet on port 11434 (opt-in)
    ollanet scan --last               # print the last saved scan (no network)

  Prompt and chat
    ollanet prompt localhost "What is MagicDNS?"
    ollanet prompt localhost --file ./notes.md
    ollanet alias add desk studio gemma3:12b
    ollanet prompt desk "hello"       # expands machine + model
    git diff | ollanet prompt desk "Review this" --stdin -q
    ollanet prompt --chat a1b2c3d4e5f6 "Tell me more"
    ollanet chats

  Compare and bench
    ollanet compare studio gemma3:12b llama3.2:3b
    ollanet compare studio gemma3:12b llama3.2:3b --prompt "Explain MagicDNS"
    ollanet bench localhost --all
    ollanet bench localhost llama3.2:1b --runs 3
    ollanet bench localhost gemma3:12b --hot --runs 5

  Manage models (pull and rm change the remote host)
    ollanet pull studio gemma3:12b
    ollanet show studio gemma4-ctx32k
    ollanet rm studio llama3.2:1b --yes
    ollanet ps studio

  Share a read-only catalog
    ollanet serve token add cloud-agent --expires 30d
    ollanet serve --funnel            # catalog on https://<device>.<tailnet>.ts.net/
    ollanet serve status              # local and Funnel URLs of the running server
    ollanet serve label set studio gpu-box   # agents see gpu-box, not the host name
    ollanet serve token prune         # expired, or unused 30+ days (asks first)

  Agents and scripts
    ollanet mcp                       # stdio MCP server for agents
    ollanet scan --json -q            # machine-readable hosts and models

Every flag and more examples: ollanet help <command>  (or ollanet <command> --help)

Quiet:  -q / --quiet on any command (or OLLANET_QUIET=1): results on stdout,
        stderr only for errors and warnings
Progress: compare/bench progress lines only when stderr is a terminal
        (OLLANET_PROGRESS=1 forces on, 0 off)
Config: ~/.ollanet/config.json when installed, ./config.json in a checkout
        (override with OLLANET_CONFIG)
Hosts:  config.hosts, OLLANET_HOSTS, optional Tailscale + --lan
Aliases: config.aliases — ollanet alias add|list|rm
Chats:  ~/.ollanet/responses or ./responses (override with OLLANET_RESPONSES_DIR)
Scan:   ~/.ollanet/last-scan.json or ./last-scan.json (override with OLLANET_LAST_SCAN)
Serve:  ~/.ollanet/serve.json, token hashes and labels (override with OLLANET_SERVE_FILE)
`;

async function main(): Promise<void> {
  // pnpm/npm often forward a bare `--`; ignore it.
  const argv = process.argv.slice(2).filter((arg) => arg !== "--");
  const cmd = argv[0];

  if (!cmd || cmd === "-h" || cmd === "--help") {
    process.stdout.write(HELP);
    return;
  }

  if (cmd === "help") {
    const topic = argv[1];
    if (!topic || topic === "-h" || topic === "--help") {
      process.stdout.write(HELP);
      return;
    }
    const { commandHelp, commandNames } = await import("./help.ts");
    const text = await commandHelp(topic);
    if (!text) {
      console.error(`Unknown command: ${topic}`);
      console.error(`Try: ollanet help   (commands: ${commandNames().join(", ")})`);
      process.exitCode = 1;
      return;
    }
    process.stdout.write(text.endsWith("\n") ? text : `${text}\n`);
    return;
  }

  const rest = argv.slice(1);
  const { isHelpRequest, commandHelp } = await import("./help.ts");
  if (isHelpRequest(rest)) {
    const text = await commandHelp(cmd);
    if (text) {
      process.stdout.write(text.endsWith("\n") ? text : `${text}\n`);
      return;
    }
  }

  if (cmd === "-v" || cmd === "--version" || cmd === "version") {
    const { readFile } = await import("node:fs/promises");
    const { projectPath } = await import("./paths.ts");
    const pkg = JSON.parse(await readFile(projectPath("package.json"), "utf8")) as {
      version?: string;
    };
    console.log(`ollanet ${pkg.version ?? "0.0.0"}`);
    return;
  }

  // Strip the subcommand so command modules see their own argv. -q / --quiet
  // is global: it is removed here and read through isQuiet().
  const { takeQuietFlag } = await import("./argv.ts");
  process.argv = [
    process.argv[0] ?? "node",
    process.argv[1] ?? "ollanet",
    ...takeQuietFlag(argv.slice(1)),
  ];

  switch (cmd) {
    case "scan":
    case "ls-servers": {
      const { main: run } = await import("./scan.ts");
      await run();
      return;
    }
    case "prompt":
    case "ask":
    case "chat": {
      const { main: run } = await import("./prompt.ts");
      await run();
      return;
    }
    case "chats":
    case "ls":
    case "history": {
      const { main: run } = await import("./chats.ts");
      await run();
      return;
    }
    case "pull":
    case "download": {
      const { main: run } = await import("./pull.ts");
      await run();
      return;
    }
    case "show":
    case "inspect": {
      const { main: run } = await import("./show.ts");
      await run();
      return;
    }
    case "rm":
    case "delete": {
      const { main: run } = await import("./rm.ts");
      await run();
      return;
    }
    case "ps":
    case "loaded": {
      const { main: run } = await import("./ps.ts");
      await run();
      return;
    }
    case "compare":
    case "vs":
    case "h2h": {
      const { main: run } = await import("./compare.ts");
      await run();
      return;
    }
    case "bench":
    case "benchmark": {
      const { main: run } = await import("./bench.ts");
      await run();
      return;
    }
    case "mcp": {
      const { main: run } = await import("./mcp.ts");
      await run();
      return;
    }
    case "serve": {
      const { main: run } = await import("./serve.ts");
      await run();
      return;
    }
    case "alias":
    case "aliases": {
      const { main: run } = await import("./alias.ts");
      await run();
      return;
    }
    default:
      console.error(`Unknown command: ${cmd}\n`);
      process.stderr.write(HELP);
      process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
