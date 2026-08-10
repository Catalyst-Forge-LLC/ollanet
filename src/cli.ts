#!/usr/bin/env node
/**
 * ollanet — chat with Ollama servers on any reachable network.
 *
 *   ollanet scan
 *   ollanet prompt <machine-or-ip> "hello"
 *   ollanet chats
 */

const HELP = `ollanet — Ollama over your network

Discover Ollama hosts on localhost, your LAN, Tailscale, or any IP/hostname
you can reach — then chat with hash-addressed transcripts.

Usage:
  ollanet scan [--json] [--all] [--lan]
  ollanet prompt <machine|ip> [model] <prompt...>
  ollanet prompt --chat <hash> <prompt...>
  ollanet chats [--json] [--id <hash>]
  ollanet bench <machine|ip> [model...] [--all] [options]
  ollanet mcp

Examples:
  ollanet scan
  ollanet scan --lan
  ollanet prompt localhost "What is MagicDNS?"
  ollanet prompt 192.168.1.50 gemma4:12b "Hello"
  ollanet prompt --chat a1b2c3d4e5f6 "Tell me more"
  ollanet chats
  ollanet bench localhost --all
  ollanet bench localhost llama3.2:1b --runs 3
  ollanet mcp                  # stdio MCP server for agents

Config: ~/.ollanet/config.json when installed, ./config.json in a checkout
        (override with OLLANET_CONFIG)
Hosts:  config.hosts, OLLANET_HOSTS, optional Tailscale + --lan
Chats:  ~/.ollanet/responses or ./responses (override with OLLANET_RESPONSES_DIR)
`;

async function main(): Promise<void> {
  // pnpm/npm often forward a bare `--`; ignore it.
  const argv = process.argv.slice(2).filter((arg) => arg !== "--");
  const cmd = argv[0];

  if (!cmd || cmd === "-h" || cmd === "--help" || cmd === "help") {
    process.stdout.write(HELP);
    return;
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

  // Strip the subcommand so command modules see their own argv.
  process.argv = [process.argv[0] ?? "node", process.argv[1] ?? "ollanet", ...argv.slice(1)];

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
