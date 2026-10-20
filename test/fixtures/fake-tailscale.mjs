#!/usr/bin/env node
/**
 * Stand-in for the tailscale CLI (OLLANET_TAILSCALE_BIN). Appends each call to
 * FAKE_TS_LOG. FAKE_TS_MODE: "ok" (default), "noenable" (Funnel not approved:
 * print the enable link and wait forever, like the real CLI), "nocerts".
 */
import { appendFileSync } from "node:fs";

const args = process.argv.slice(2);
const mode = process.env.FAKE_TS_MODE ?? "ok";
if (process.env.FAKE_TS_LOG) appendFileSync(process.env.FAKE_TS_LOG, `${args.join(" ")}\n`);

if (args[0] === "status" && args[1] === "--json") {
  process.stdout.write(
    JSON.stringify({
      BackendState: "Running",
      Self: {
        DNSName: "box.example.ts.net.",
        CapMap: mode === "ok" ? { https: null, funnel: null } : { https: null },
      },
      CertDomains: mode === "nocerts" ? null : ["box.example.ts.net"],
    }),
  );
  process.exit(0);
}
if (args[0] === "funnel" && args[1] === "status") {
  process.stdout.write("{}\n");
  process.exit(0);
}
if (args[0] === "funnel" && args.includes("off")) {
  process.exit(0);
}
if (args[0] === "funnel" && args.includes("--bg")) {
  if (mode === "noenable") {
    process.stdout.write(
      "Funnel is not enabled on your tailnet.\nTo enable, visit:\n\n         https://login.tailscale.com/f/funnel?node=fakeNode123\n",
    );
    setInterval(() => {}, 1000); // the real CLI waits for approval
  } else {
    process.stdout.write("Available on the internet:\n\nhttps://box.example.ts.net/\n");
    process.exit(0);
  }
} else {
  process.stderr.write(`fake tailscale: unexpected args ${args.join(" ")}\n`);
  process.exit(2);
}
