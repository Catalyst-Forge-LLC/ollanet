/**
 * Bench CLI tests against the mock Ollama server.
 */
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import { makeSandbox, runCli, startMock } from "./helpers.mjs";

function mockConfig(port, extra = {}) {
  return {
    hosts: [{ name: "mockhost", host: "127.0.0.1", port }],
    defaultModels: { mockhost: "fake:1b" },
    discovery: { localhost: false, tailscale: false, lan: false },
    ...extra,
  };
}

describe("bench", () => {
  it("runs quick suite with per-run throughput attempts and saves JSON", async () => {
    const mock = await startMock({
      models: ["fake:1b"],
      capabilities: { "fake:1b": ["completion"] },
      reply: "OK",
      doneReason: "length",
      evalCount: 256,
      evalDuration: 2e9,
    });
    const sandbox = await makeSandbox(mockConfig(mock.port));

    const res = await runCli(
      ["bench", "mockhost", "fake:1b", "--runs", "3", "--no-warmup", "--json"],
      { sandbox, env: { OLLAMA_BENCH_TIMEOUT_MS: "10000" } },
    );

    assert.equal(res.code, 0, res.stderr);
    const payload = JSON.parse(res.stdout);
    assert.equal(payload.runs, 3);
    assert.ok(payload.suite_revision);
    assert.ok(payload.comparability_key);
    assert.equal(payload.models.length, 1);

    const model = payload.models[0];
    assert.equal(model.name, "fake:1b");
    assert.ok(model.digest);

    const throughput = model.cases.find((c) => c.id === "throughput");
    assert.ok(throughput);
    assert.equal(throughput.attempts.length, 3);
    const ping = model.cases.find((c) => c.id === "ping");
    assert.equal(ping.attempts.length, 1);

    const toks = throughput.attempts.map((a) => a.tok_s).filter((n) => n != null);
    assert.equal(toks.length, 3);
    // 256 tokens / 2s = 128 tok/s
    assert.ok(Math.abs(toks[0] - 128) < 0.1);
    assert.ok(model.summary.tok_s_median != null);

    const files = await readdir(sandbox.benchmarksDir);
    assert.equal(files.length, 1);
    const saved = JSON.parse(await readFile(path.join(sandbox.benchmarksDir, files[0]), "utf8"));
    assert.equal(saved.models[0].cases.find((c) => c.id === "throughput").attempts.length, 3);

    await mock.close();
    await sandbox.cleanup();
  });

  it("filters --all to completion models and lists skipped embeddings", async () => {
    const mock = await startMock({
      models: ["fake:1b", "nomic-embed-text"],
      capabilities: {
        "fake:1b": ["completion"],
        "nomic-embed-text": ["embedding"],
      },
      reply: "OK",
      doneReason: "length",
    });
    const sandbox = await makeSandbox(mockConfig(mock.port));

    const res = await runCli(["bench", "mockhost", "--all", "--runs", "1", "--no-warmup", "--json"], {
      sandbox,
      env: { OLLAMA_BENCH_TIMEOUT_MS: "10000" },
    });

    assert.equal(res.code, 0, res.stderr);
    const payload = JSON.parse(res.stdout);
    assert.deepEqual(
      payload.models.map((m) => m.name),
      ["fake:1b"],
    );
    assert.equal(payload.skipped_models.length, 1);
    assert.equal(payload.skipped_models[0].name, "nomic-embed-text");

    await mock.close();
    await sandbox.cleanup();
  });

  it("includes vision+completion models in --all; --exclude-vision opts out", async () => {
    const mock = await startMock({
      models: ["fake:1b", "gemma3:12b", "nomic-embed-text"],
      capabilities: {
        "fake:1b": ["completion"],
        "gemma3:12b": ["completion", "vision"],
        "nomic-embed-text": ["embedding"],
      },
      reply: "OK",
      doneReason: "length",
    });
    const sandbox = await makeSandbox(mockConfig(mock.port));

    const res = await runCli(["bench", "mockhost", "--all", "--runs", "1", "--no-warmup", "--json"], {
      sandbox,
      env: { OLLAMA_BENCH_TIMEOUT_MS: "10000" },
    });
    assert.equal(res.code, 0, res.stderr);
    let payload = JSON.parse(res.stdout);
    assert.deepEqual(
      payload.models.map((m) => m.name).sort(),
      ["fake:1b", "gemma3:12b"],
    );
    assert.equal(payload.skipped_models.length, 1);
    assert.equal(payload.skipped_models[0].name, "nomic-embed-text");

    const res2 = await runCli(
      ["bench", "mockhost", "--all", "--exclude-vision", "--runs", "1", "--no-warmup", "--json"],
      { sandbox, env: { OLLAMA_BENCH_TIMEOUT_MS: "10000" } },
    );
    assert.equal(res2.code, 0, res2.stderr);
    payload = JSON.parse(res2.stdout);
    assert.deepEqual(
      payload.models.map((m) => m.name),
      ["fake:1b"],
    );
    assert.equal(payload.skipped_models.find((s) => s.name === "gemma3:12b")?.reason, "vision");

    await mock.close();
    await sandbox.cleanup();
  });

  it("formats spread at the same precision as the median", async () => {
    let n = 0;
    const mock = await startMock({
      models: ["legacy:7b"],
      capabilities: { "legacy:7b": ["completion"] },
      onChat: ({ body }) => {
        if (body?.options?.num_predict === 256) {
          n += 1;
          const durations = [3.055e9, 3.052e9, 2.96e9]; // ~83.8, 83.9, 86.5 tok/s
          return {
            message: { content: "x".repeat(50) },
            done: true,
            done_reason: "length",
            eval_count: 256,
            eval_duration: durations[(n - 1) % 3],
            load_duration: 0,
            total_duration: durations[(n - 1) % 3],
          };
        }
        return {
          message: { content: "OK" },
          done: true,
          done_reason: "stop",
          eval_count: 2,
          eval_duration: 1e8,
          load_duration: 0,
          total_duration: 1e8,
        };
      },
    });
    const sandbox = await makeSandbox(mockConfig(mock.port));
    const res = await runCli(["bench", "mockhost", "legacy:7b", "--runs", "3", "--no-warmup"], {
      sandbox,
      env: { OLLAMA_BENCH_TIMEOUT_MS: "10000" },
    });
    assert.equal(res.code, 0, res.stderr);
    const row = res.stdout.split("\n").find((l) => l.startsWith("legacy:7b"));
    assert.ok(row, res.stdout);
    // Must not look like "83.8  84–86" (median outside displayed min).
    assert.match(row, /83\.\d\s+83\.\d–86\.\d/);

    await mock.close();
    await sandbox.cleanup();
  });

  it("treats omitted capabilities as completion-capable", async () => {
    const mock = await startMock({
      models: ["legacy:1b"],
      // null → /api/show omits the capabilities key entirely
      capabilities: { "legacy:1b": null },
      reply: "OK",
      doneReason: "length",
    });
    const sandbox = await makeSandbox(mockConfig(mock.port));

    const res = await runCli(["bench", "mockhost", "--all", "--runs", "1", "--no-warmup", "--json"], {
      sandbox,
      env: { OLLAMA_BENCH_TIMEOUT_MS: "10000" },
    });

    assert.equal(res.code, 0, res.stderr);
    const payload = JSON.parse(res.stdout);
    assert.deepEqual(
      payload.models.map((m) => m.name),
      ["legacy:1b"],
    );
    assert.equal(payload.skipped_models.length, 0);

    await mock.close();
    await sandbox.cleanup();
  });

  it("records context_length from /api/ps while the model is loaded", async () => {
    const mock = await startMock({
      models: ["fake:1b"],
      capabilities: { "fake:1b": ["completion"] },
      reply: "OK",
      doneReason: "length",
    });
    const sandbox = await makeSandbox(mockConfig(mock.port));

    const res = await runCli(["bench", "mockhost", "fake:1b", "--runs", "1", "--no-warmup", "--json"], {
      sandbox,
      env: { OLLAMA_BENCH_TIMEOUT_MS: "10000" },
    });

    assert.equal(res.code, 0, res.stderr);
    const payload = JSON.parse(res.stdout);
    assert.equal(payload.models[0].context_length, 8192);
    assert.equal(payload.models[0].size_vram, 123456789);

    await mock.close();
    await sandbox.cleanup();
  });

  it("flags early-stop throughput attempts and excludes them from median", async () => {
    let call = 0;
    const mock = await startMock({
      models: ["fake:1b"],
      capabilities: { "fake:1b": ["completion"] },
      onChat: ({ body }) => {
        if (body?.options?.num_predict === 256) {
          call += 1;
          // First two early-stop; third full length
          if (call <= 2) {
            return {
              message: { content: "short" },
              done: true,
              done_reason: "stop",
              eval_count: 40,
              eval_duration: 1e9,
              load_duration: 0,
              total_duration: 1e9,
            };
          }
          return {
            message: { content: "long".repeat(50) },
            done: true,
            done_reason: "length",
            eval_count: 256,
            eval_duration: 2e9,
            load_duration: 0,
            total_duration: 2e9,
          };
        }
        return {
          message: { content: "OK" },
          done: true,
          done_reason: "stop",
          eval_count: 2,
          eval_duration: 1e8,
          load_duration: 0,
          total_duration: 1e8,
        };
      },
    });
    const sandbox = await makeSandbox(mockConfig(mock.port));

    const res = await runCli(["bench", "mockhost", "fake:1b", "--runs", "3", "--no-warmup", "--json"], {
      sandbox,
      env: { OLLAMA_BENCH_TIMEOUT_MS: "10000" },
    });

    assert.equal(res.code, 0, res.stderr);
    const payload = JSON.parse(res.stdout);
    const throughput = payload.models[0].cases.find((c) => c.id === "throughput");
    assert.equal(throughput.attempts.filter((a) => a.early_stop).length, 2);
    assert.equal(payload.models[0].summary.early_stop_count, 2);
    assert.ok(Math.abs(payload.models[0].summary.tok_s_median - 128) < 0.1);

    await mock.close();
    await sandbox.cleanup();
  });

  it("records cold_load from the probe, not post-warmup timings", async () => {
    const mock = await startMock({
      models: ["fake:1b"],
      capabilities: { "fake:1b": ["completion"] },
      reply: "OK",
      doneReason: "length",
      loadDuration: 0,
      coldLoadDuration: 2_100_000_000,
    });
    const sandbox = await makeSandbox(mockConfig(mock.port));

    // Pre-load the model so cold-load path exercises unload.
    mock.loaded.add("fake:1b");
    mock.setUnloadPollDelay(1);

    const res = await runCli(
      ["bench", "mockhost", "fake:1b", "--runs", "1", "--cold-load", "--json"],
      { sandbox, env: { OLLAMA_BENCH_TIMEOUT_MS: "10000", OLLAMA_BENCH_UNLOAD_WAIT_MS: "5000" } },
    );

    assert.equal(res.code, 0, res.stderr);
    const payload = JSON.parse(res.stdout);
    const cold = payload.models[0].cold_load;
    assert.ok(cold, "expected cold_load object");
    assert.ok(cold.load_ms > 0, `expected non-zero load_ms, got ${cold.load_ms}`);
    assert.equal(cold.ollama.load_duration, 2_100_000_000);
    assert.equal(payload.models[0].summary.load_ms, cold.load_ms);

    await mock.close();
    await sandbox.cleanup();
  });

  it("isolates per-model errors under --all without aborting the run", async () => {
    const mock = await startMock({
      models: ["good:1b", "bad:1b"],
      capabilities: {
        "good:1b": ["completion"],
        "bad:1b": ["completion"],
      },
      onChat: ({ body }) => {
        if (body?.model === "bad:1b") {
          return null; // fall through — we'll use status via a trick
        }
        return {
          message: { content: body?.options?.num_predict === 256 ? "x".repeat(100) : "OK" },
          done: true,
          done_reason: "length",
          eval_count: body?.options?.num_predict === 256 ? 256 : 3,
          eval_duration: 1e9,
          load_duration: 0,
          total_duration: 1e9,
        };
      },
    });
    // Force bad model failures by patching after listen — simpler: use onChat throw via error body
    await mock.close();

    const mock2 = await startMock({
      models: ["good:1b", "bad:1b"],
      capabilities: {
        "good:1b": ["completion"],
        "bad:1b": ["completion"],
      },
      onChat: ({ body }) => {
        if (body?.model === "bad:1b" && body?.options?.num_predict !== 1) {
          return { error: "simulated failure" };
        }
        return {
          message: { content: "OK" },
          done: true,
          done_reason: "length",
          eval_count: body?.options?.num_predict === 256 ? 256 : 3,
          eval_duration: 1e9,
          load_duration: 0,
          total_duration: 1e9,
        };
      },
    });
    const sandbox = await makeSandbox(mockConfig(mock2.port));

    const res = await runCli(["bench", "mockhost", "--all", "--runs", "1", "--no-warmup", "--json"], {
      sandbox,
      env: { OLLAMA_BENCH_TIMEOUT_MS: "10000" },
    });

    assert.equal(res.code, 0, res.stderr);
    const payload = JSON.parse(res.stdout);
    assert.equal(payload.models.length, 2);
    const bad = payload.models.find((m) => m.name === "bad:1b");
    const good = payload.models.find((m) => m.name === "good:1b");
    assert.ok(bad.cases.some((c) => c.attempts.some((a) => a.error)));
    assert.ok(good);

    await mock2.close();
    await sandbox.cleanup();
  });

  it("discards the first throughput run under --hot and skips inter-model unload", async () => {
    let throughput = 0;
    const mock = await startMock({
      models: ["fake:1b", "qwen3:0.6b"],
      capabilities: {
        "fake:1b": ["completion"],
        "qwen3:0.6b": ["completion"],
      },
      onChat: ({ body }) => {
        if (body?.options?.num_predict === 256) {
          throughput += 1;
          const durations = [4e9, 2e9, 2e9]; // discarded 64 tok/s; counted 128
          const eval_duration = durations[(throughput - 1) % 3];
          return {
            message: { content: "x".repeat(50) },
            done: true,
            done_reason: "length",
            eval_count: 256,
            eval_duration,
            load_duration: 0,
            total_duration: eval_duration,
          };
        }
        return {
          message: { content: "OK" },
          done: true,
          done_reason: "stop",
          eval_count: 2,
          eval_duration: 1e8,
          load_duration: 0,
          total_duration: 1e8,
        };
      },
    });
    const sandbox = await makeSandbox(mockConfig(mock.port));

    const res = await runCli(
      ["bench", "mockhost", "fake:1b", "qwen3:0.6b", "--hot", "--runs", "2", "--json", "--no-save"],
      { sandbox, env: { OLLAMA_BENCH_TIMEOUT_MS: "10000" } },
    );

    assert.equal(res.code, 0, res.stderr);
    assert.match(res.stderr, /Hot: discarding the first throughput run/);
    const payload = JSON.parse(res.stdout);
    assert.equal(payload.runs, 2);
    assert.equal(payload.settings.hot, true);
    assert.equal(payload.settings.warmup, false);

    const model = payload.models[0];
    const thru = model.cases.find((c) => c.id === "throughput");
    assert.equal(thru.attempts.length, 3);
    assert.equal(thru.attempts[0].discarded, true);
    assert.equal(thru.attempts[0].run, 0);
    assert.equal(thru.attempts[1].discarded, undefined);
    assert.equal(thru.attempts[1].run, 1);
    assert.equal(thru.attempts[2].run, 2);
    // Median from the two counted 128 tok/s shots, not the discarded 64.
    assert.ok(Math.abs(model.summary.tok_s_median - 128) < 0.1);

    const unloads = mock.requests.filter(
      (r) => r.body?.keep_alive === 0 || r.body?.keep_alive === "0",
    );
    assert.equal(unloads.length, 0, " --hot must not unload between models");

    await mock.close();
    await sandbox.cleanup();
  });

  it("full suite records one 1024-token prose throughput shot", async () => {
    const mock = await startMock({
      models: ["fake:1b"],
      capabilities: { "fake:1b": ["completion"] },
      reply: "OK",
      doneReason: "length",
      evalCount: 256,
      evalDuration: 2e9,
    });
    const sandbox = await makeSandbox(mockConfig(mock.port));

    const res = await runCli(
      [
        "bench",
        "mockhost",
        "fake:1b",
        "--suite",
        "full",
        "--hot",
        "--runs",
        "2",
        "--json",
      ],
      { sandbox, env: { OLLAMA_BENCH_TIMEOUT_MS: "10000" } },
    );

    assert.equal(res.code, 0, res.stderr);
    const payload = JSON.parse(res.stdout);
    assert.equal(payload.suite, "full");
    assert.equal(payload.settings.throughput_long_num_predict, 1024);
    const model = payload.models[0];
    const peak = model.cases.find((c) => c.id === "throughput");
    const long = model.cases.find((c) => c.id === "throughput_long");
    assert.equal(peak.attempts.length, 3);
    assert.equal(peak.attempts[0].discarded, true);
    assert.ok(long);
    assert.equal(long.attempts.length, 1);
    assert.equal(long.attempts[0].discarded, undefined);
    assert.ok(model.summary.tok_s_long_median != null);

    await mock.close();
    await sandbox.cleanup();
  });

  it("requires --judge-model with --judge", async () => {
    const mock = await startMock({ models: ["fake:1b"] });
    const sandbox = await makeSandbox(mockConfig(mock.port));
    const res = await runCli(["bench", "mockhost", "fake:1b", "--judge"], { sandbox });
    assert.notEqual(res.code, 0);
    assert.match(res.stderr, /judge-model/);
    await mock.close();
    await sandbox.cleanup();
  });
});
