import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  comparabilityKey,
  getSuiteCases,
  median,
  suiteRevision,
} from "../dist/bench-suite.js";

describe("bench checkers", () => {
  const cases = Object.fromEntries(getSuiteCases("full").map((c) => [c.id, c]));

  it("ping accepts chatty OK replies via last-token rule", () => {
    assert.equal(cases.ping.check("OK").ok, true);
    assert.equal(cases.ping.check("OK.").ok, true);
    assert.equal(cases.ping.check("Sure — OK").ok, true);
    assert.equal(cases.ping.check("nope").ok, false);
  });

  it("math accepts the expected int among integers on the last line", () => {
    assert.equal(cases.math.check("323").ok, true);
    assert.equal(cases.math.check("323 (i.e., 17×19)").ok, true);
    assert.equal(cases.math.check("I think 17 and 19 make something").ok, false);
  });

  it("suite_revision changes when prompts change identity", () => {
    const a = suiteRevision("quick");
    const b = suiteRevision("full");
    assert.equal(a.length, 16);
    assert.notEqual(a, b);
  });

  it("comparability_key includes num_predict and other pins", () => {
    const base = {
      suite: "quick",
      throughputNumPredict: 256,
      seed: 0,
      temperature: 0,
      think: false,
      numCtx: null,
    };
    const a = comparabilityKey(base);
    const b = comparabilityKey({ ...base, throughputNumPredict: 128 });
    assert.notEqual(a, b);
    assert.equal(comparabilityKey(base), a);
    assert.notEqual(a, comparabilityKey({ ...base, hot: true }));
  });

  it("median works for odd and even lengths", () => {
    assert.equal(median([3, 1, 2]), 2);
    assert.equal(median([4, 1, 2, 3]), 2.5);
    assert.equal(median([]), undefined);
  });

  it("throughput prompt is enumerative so models hit the num_predict cap", () => {
    assert.match(cases.throughput.prompt, /Count from 1/i);
    assert.doesNotMatch(cases.throughput.prompt, /Explain how/i);
  });

  it("full adds a single 1024-token prose throughput case; quick does not", () => {
    const quick = Object.fromEntries(getSuiteCases("quick").map((c) => [c.id, c]));
    assert.equal(quick.throughput_long, undefined);
    assert.equal(cases.throughput_long.role, "throughput");
    assert.equal(cases.throughput_long.num_predict, 1024);
    assert.equal(cases.throughput_long.repeats, 1);
    assert.match(cases.throughput_long.prompt, /trade-off briefing/i);
    assert.doesNotMatch(cases.throughput_long.prompt, /Count from 1/i);
  });
});
