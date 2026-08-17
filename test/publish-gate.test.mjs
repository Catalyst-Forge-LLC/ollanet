import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
	applyVersion,
	bumpPatch,
	compareSemver,
	isGitHubActions,
	nextPublishVersion,
} from "../scripts/publish-gate.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("compareSemver orders patch, minor, major", () => {
	assert.equal(compareSemver("0.1.2", "0.1.2"), 0);
	assert.equal(compareSemver("0.1.3", "0.1.2"), 1);
	assert.equal(compareSemver("0.1.2", "0.1.4"), -1);
	assert.equal(compareSemver("0.2.0", "0.1.9"), 1);
});

test("nextPublishVersion bumps only when local is not ahead", () => {
	assert.equal(nextPublishVersion("0.1.4", null), null);
	assert.equal(nextPublishVersion("0.1.4", "0.1.2"), null);
	assert.equal(nextPublishVersion("0.1.4", "0.1.4"), "0.1.5");
	assert.equal(nextPublishVersion("0.1.3", "0.1.4"), "0.1.5");
	assert.equal(bumpPatch("1.0.0"), "1.0.1");
});

test("applyVersion keeps package.json formatting", () => {
	const raw = '{\n\t"name": "pkg",\n\t"version": "0.1.4",\n}\n';
	assert.equal(
		applyVersion(raw, "0.1.5"),
		'{\n\t"name": "pkg",\n\t"version": "0.1.5",\n}\n',
	);
});

test("prepublishOnly runs the publish gate", () => {
	const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
	assert.match(pkg.scripts.prepublishOnly, /publish-gate/);
});

test("isGitHubActions follows CI env", () => {
	const prev = {
		GITHUB_ACTIONS: process.env.GITHUB_ACTIONS,
		CI: process.env.CI,
		GITHUB_WORKFLOW: process.env.GITHUB_WORKFLOW,
	};
	delete process.env.GITHUB_ACTIONS;
	delete process.env.CI;
	delete process.env.GITHUB_WORKFLOW;
	assert.equal(isGitHubActions(), false);
	process.env.GITHUB_ACTIONS = "true";
	assert.equal(isGitHubActions(), true);
	delete process.env.GITHUB_ACTIONS;
	process.env.CI = "true";
	assert.equal(isGitHubActions(), true);
	for (const [k, v] of Object.entries(prev)) {
		if (v === undefined) delete process.env[k];
		else process.env[k] = v;
	}
});
