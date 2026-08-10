#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(root, "src", "cli.ts");
const tsxCli = path.join(root, "node_modules", "tsx", "dist", "cli.mjs");

const child = spawn(process.execPath, [tsxCli, cli, ...process.argv.slice(2)], {
  stdio: "inherit",
  windowsHide: true,
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});

child.on("error", (err) => {
  console.error(`Failed to start ollanet: ${err.message}`);
  console.error("Run `pnpm install` in the ollanet project directory first.");
  process.exit(1);
});
