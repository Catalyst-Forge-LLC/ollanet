#!/usr/bin/env node
/**
 * ollanet — chat with Ollama servers across your Tailnet.
 *
 *   ollanet scan
 *   ollanet prompt <machine> "hello"
 *   ollanet chats
 */

const HELP = `ollanet — Tailnet Ollama chat CLI

Usage:
  ollanet scan [--json] [--all]
  ollanet prompt <machine> [model] <prompt...>
  ollanet prompt --chat <hash> <prompt...>
  ollanet chats [--json] [--id <hash>]

Examples:
  ollanet scan
  ollanet prompt mycroftone "What is Tailscale?"
  ollanet prompt --chat a1b2c3d4e5f6 "Tell me more"
  ollanet chats

Config: config.json (or OLLANET_CONFIG)
Chats:  responses/ (or OLLANET_RESPONSES_DIR)
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
