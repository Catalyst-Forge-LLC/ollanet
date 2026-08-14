/**
 * Unit tests for the pure helpers. These run against dist/, so `npm run build`
 * (or `npm test`, which builds first) must have run.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  discoverHosts,
  envInt,
  findDiscoveredHost,
  ollamaBaseUrl,
  resolveHost,
  shortName,
} from "../dist/hosts.js";
import {
  isCompletionCapable,
  isVisionCapable,
  shouldWarnNoThinking,
} from "../dist/ollama-chat.js";
import { cleanTopic, normalizeChatId, topicFromPrompt } from "../dist/chat-store.js";
import { mergeSettings, normalizeSettings, parseFormat } from "../dist/config.js";
import { looksTuned } from "../dist/tuned.js";
import { assemblePrompt, assertPromptFilename } from "../dist/prompt-input.js";
import { processorSplit } from "../dist/ps.js";
import { consumeSettingsFlag, parseKeepAlive, takeFlag } from "../dist/argv.js";

/** Minimal HostTarget literal for resolution tests. */
function host(partial) {
  return {
    hostname: partial.hostname,
    dnsName: partial.dnsName ?? "",
    ip: partial.ip,
    online: true,
    os: "linux",
    isSelf: false,
    source: "config",
    port: partial.port ?? 11434,
  };
}

const TARGETS = [
  host({ hostname: "studio", dnsName: "studio.tail1234.ts.net", ip: "100.64.0.2" }),
  host({ hostname: "localhost", dnsName: "localhost", ip: "127.0.0.1" }),
];

describe("normalizeChatId", () => {
  it("accepts a hex hash and strips a .json suffix", () => {
    assert.equal(normalizeChatId("A1B2C3D4E5F6"), "a1b2c3d4e5f6");
    assert.equal(normalizeChatId("a1b2c3d4e5f6.json"), "a1b2c3d4e5f6");
  });

  it("rejects path traversal and other non-hex input", () => {
    for (const bad of ["../../../etc/passwd", "a1b2/../../x", "not-hex", "", "abc"]) {
      assert.throws(() => normalizeChatId(bad), /Invalid chat id/);
    }
  });
});

describe("ollamaBaseUrl", () => {
  it("leaves IPv4 bare and brackets IPv6", () => {
    assert.equal(ollamaBaseUrl(host({ hostname: "h", ip: "192.168.1.50" })), "http://192.168.1.50:11434");
    assert.equal(ollamaBaseUrl(host({ hostname: "h", ip: "::1" })), "http://[::1]:11434");
  });

  it("honours a non-default port", () => {
    assert.equal(
      ollamaBaseUrl(host({ hostname: "h", ip: "10.0.0.1", port: 9999 })),
      "http://10.0.0.1:9999",
    );
  });
});

describe("resolveHost", () => {
  it("matches by short name, full DNS name, and IP", () => {
    assert.equal(resolveHost(TARGETS, "studio").ip, "100.64.0.2");
    assert.equal(resolveHost(TARGETS, "studio.tail1234.ts.net").ip, "100.64.0.2");
    assert.equal(resolveHost(TARGETS, "127.0.0.1").hostname, "localhost");
  });

  it("accepts direct addresses that were never discovered", () => {
    assert.equal(resolveHost(TARGETS, "192.168.1.50").ip, "192.168.1.50");
    assert.equal(resolveHost(TARGETS, "box.local").ip, "box.local");
  });

  // Regression: a dotless hostname with a port used to fall through unparsed and
  // produce http://[myhost:11434]:11434.
  it("splits host:port for dotless hostnames", () => {
    const h = resolveHost(TARGETS, "myhost:11500");
    assert.equal(h.ip, "myhost");
    assert.equal(h.port, 11500);
    assert.equal(ollamaBaseUrl(h), "http://myhost:11500");
  });

  it("splits host:port for IPv4 and bracketed IPv6", () => {
    assert.equal(ollamaBaseUrl(resolveHost(TARGETS, "10.1.2.3:1234")), "http://10.1.2.3:1234");
    assert.equal(ollamaBaseUrl(resolveHost(TARGETS, "[::1]:1234")), "http://[::1]:1234");
  });

  // Regression: bare words used to be treated as direct addresses, so typos
  // became confusing connection failures instead of a helpful error.
  it("rejects a bare-word typo with a list of known hosts", () => {
    assert.throws(() => resolveHost(TARGETS, "studioo"), /Unknown machine/);
    assert.throws(() => resolveHost(TARGETS, "studioo"), /studio/);
  });

  it("rejects an empty query", () => {
    assert.throws(() => resolveHost(TARGETS, "   "), /empty/);
  });
});

describe("findDiscoveredHost", () => {
  it("finds discovered hosts only, with no direct-address fallback", () => {
    assert.equal(findDiscoveredHost(TARGETS, "studio")?.ip, "100.64.0.2");
    assert.equal(findDiscoveredHost(TARGETS, "explain"), undefined);
    assert.equal(findDiscoveredHost(TARGETS, "192.168.1.50"), undefined);
  });
});

describe("shortName", () => {
  it("prefers the first label of the DNS name", () => {
    assert.equal(shortName(TARGETS[0]), "studio");
    assert.equal(shortName(host({ hostname: "raw", ip: "1.2.3.4" })), "raw");
  });

  // Regression: config { name, host: "192.168.1.50" } used to set dnsName to the IP,
  // so shortName() returned "192" instead of the configured name.
  it("uses the configured name when host is an IPv4 literal", async () => {
    const { hosts } = await discoverHosts({
      hosts: [{ name: "studio", host: "192.168.1.50", port: 11434 }],
      discovery: { localhost: false, tailscale: false, lan: false },
    });
    assert.equal(hosts.length, 1);
    assert.equal(shortName(hosts[0]), "studio");
    assert.equal(hosts[0].dnsName, "");
  });
});

describe("envInt", () => {
  it("falls back when unset or empty", () => {
    delete process.env.OLLANET_TEST_INT;
    assert.equal(envInt("OLLANET_TEST_INT", 42), 42);
    process.env.OLLANET_TEST_INT = "  ";
    assert.equal(envInt("OLLANET_TEST_INT", 42), 42);
  });

  it("parses and truncates valid numbers", () => {
    process.env.OLLANET_TEST_INT = "7";
    assert.equal(envInt("OLLANET_TEST_INT", 42), 7);
    process.env.OLLANET_TEST_INT = "7.9";
    assert.equal(envInt("OLLANET_TEST_INT", 42), 7);
    delete process.env.OLLANET_TEST_INT;
  });

  // Regression: these used to become NaN and fail silently.
  it("throws on non-numeric values instead of yielding NaN", () => {
    process.env.OLLANET_TEST_INT = "abc";
    assert.throws(() => envInt("OLLANET_TEST_INT", 42), /Invalid OLLANET_TEST_INT/);
    delete process.env.OLLANET_TEST_INT;
  });
});

describe("mergeSettings", () => {
  it("applies later layers over earlier ones", () => {
    const merged = mergeSettings(
      { temperature: 0.7, num_predict: 512 },
      { temperature: 0.2 },
      undefined,
      { num_ctx: 4096 },
    );
    assert.deepEqual(merged, { temperature: 0.2, num_predict: 512, num_ctx: 4096 });
  });

  // think:false is meaningful, so it must survive a null-ish check.
  it("preserves an explicit think:false", () => {
    assert.equal(mergeSettings({ think: false }).think, false);
    assert.equal(mergeSettings({ think: false }, { think: true }).think, true);
    assert.equal(mergeSettings({ think: true }, {}).think, true);
  });

  it("preserves keep_alive:0, which is falsy but meaningful", () => {
    assert.equal(mergeSettings({ keep_alive: "5m" }, { keep_alive: 0 }).keep_alive, 0);
  });
});

describe("normalizeSettings", () => {
  it("coerces string booleans for think", () => {
    assert.equal(normalizeSettings({ think: "true" }).think, true);
    assert.equal(normalizeSettings({ think: "off" }).think, false);
    assert.equal(normalizeSettings({ think: "maybe" }).think, undefined);
    assert.equal(normalizeSettings({}).think, undefined);
  });
});

describe("parseFormat", () => {
  it("accepts json and a schema string, ignoring junk", () => {
    assert.equal(parseFormat("json"), "json");
    assert.deepEqual(parseFormat('{"type":"object"}'), { type: "object" });
    assert.equal(parseFormat(""), undefined);
  });
});

describe("topic helpers", () => {
  it("collapses whitespace and truncates long prompts", () => {
    assert.equal(topicFromPrompt("  hello   world \n"), "hello world");
    assert.equal(topicFromPrompt(""), "Untitled chat");
    assert.ok(topicFromPrompt("x".repeat(200)).length <= 72);
  });

  it("strips quotes and Title: prefixes from model output", () => {
    assert.equal(cleanTopic('"Ferret Haiku"', "fb"), "Ferret Haiku");
    assert.equal(cleanTopic("Title: Ferret Haiku", "fb"), "Ferret Haiku");
    assert.equal(cleanTopic("   ", "fb"), "fb");
  });
});

describe("processorSplit", () => {
  it("matches ollama ps PROCESSOR wording", () => {
    assert.deepEqual(processorSplit(100, 100), {
      cpu_percent: 0,
      gpu_percent: 100,
      processor: "100% GPU",
    });
    assert.deepEqual(processorSplit(100, 0), {
      cpu_percent: 100,
      gpu_percent: 0,
      processor: "100% CPU",
    });
    assert.deepEqual(processorSplit(200, 50), {
      cpu_percent: 75,
      gpu_percent: 25,
      processor: "75%/25% CPU/GPU",
    });
    assert.equal(processorSplit(0, 10).processor, "Unknown");
    assert.deepEqual(processorSplit(), {});
  });
});

describe("argv helpers", () => {
  const usage = () => {
    throw new Error("usage");
  };

  it("parses keep_alive numbers vs duration strings", () => {
    assert.equal(parseKeepAlive("0"), 0);
    assert.equal(parseKeepAlive("-1"), -1);
    assert.equal(parseKeepAlive("5m"), "5m");
    assert.equal(parseKeepAlive("  "), "  ");
  });

  it("reads --flag value and --flag=value", () => {
    assert.equal(takeFlag("--id", "--id", ["abc"], usage), "abc");
    assert.equal(takeFlag("--id=xyz", "--id", [], usage), "xyz");
    assert.equal(takeFlag("--other", "--id", ["abc"], usage), undefined);
  });

  it("consumes shared generate-settings flags", () => {
    const settings = {};
    const args = ["0.2", "128", "5m"];
    assert.equal(
      consumeSettingsFlag("--temperature", args, settings, usage, { temperature: true }),
      true,
    );
    assert.equal(
      consumeSettingsFlag("--num-predict", args, settings, usage, { numPredict: true }),
      true,
    );
    assert.equal(consumeSettingsFlag("--keep-alive", args, settings, usage), true);
    assert.equal(consumeSettingsFlag("--think", [], settings, usage), true);
    assert.deepEqual(settings, { temperature: 0.2, num_predict: 128, keep_alive: "5m", think: true });
    assert.equal(consumeSettingsFlag("--hot", [], settings, usage), false);
  });
});

describe("prompt-input", () => {
  it("assembles argv, file, and stdin with blank lines", () => {
    assert.equal(assemblePrompt({ argv: "hi", file: "FILE", stdin: "IN" }), "hi\n\nFILE\n\nIN");
    assert.equal(assemblePrompt({ file: "  only file  " }), "only file");
    assert.equal(assemblePrompt({}), "");
  });

  it("allows only .txt and .md prompt files", () => {
    assert.ok(assertPromptFilename("notes.md").endsWith("notes.md"));
    assert.ok(assertPromptFilename("a.TXT").toLowerCase().endsWith(".txt"));
    assert.throws(() => assertPromptFilename("x.json"), /\.txt or \.md/);
    assert.throws(() => assertPromptFilename("noext"), /\.txt or \.md/);
  });
});

describe("looksTuned", () => {
  it("matches Finetuna-style names and Modelfile text", () => {
    assert.equal(looksTuned("gemma4-ctx32k"), true);
    assert.equal(looksTuned("gemma4-ctx32k-flash"), true);
    assert.equal(looksTuned("llama-finetuna"), true);
    assert.equal(looksTuned("stock-flash"), true);
    assert.equal(looksTuned("fake:1b", { modelfile: "# written by finetuna\nFROM fake:1b" }), true);
    assert.equal(looksTuned("fake:1b"), false);
    assert.equal(looksTuned("llama3.2:latest"), false);
    assert.equal(looksTuned(""), false);
  });
});

describe("capability helpers", () => {
  it("treats missing or empty capabilities as completion-capable", () => {
    assert.equal(isCompletionCapable(undefined), true);
    assert.equal(isCompletionCapable(null), true);
    assert.equal(isCompletionCapable([]), true);
    assert.equal(isCompletionCapable(["completion"]), true);
    assert.equal(isCompletionCapable(["embedding"]), false);
  });

  it("only warns about --think when thinking is known-absent", () => {
    assert.equal(shouldWarnNoThinking(undefined), false);
    assert.equal(shouldWarnNoThinking([]), false);
    assert.equal(shouldWarnNoThinking(["completion", "thinking"]), false);
    assert.equal(shouldWarnNoThinking(["completion"]), true);
  });

  it("detects vision only when capabilities explicitly include it", () => {
    assert.equal(isVisionCapable(undefined), false);
    assert.equal(isVisionCapable([]), false);
    assert.equal(isVisionCapable(["completion"]), false);
    assert.equal(isVisionCapable(["completion", "vision"]), true);
  });
});
