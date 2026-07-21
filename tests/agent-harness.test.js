"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

test("Codex and Claude Code share one instruction source", () => {
  const agents = read("AGENTS.md");
  const claude = read("CLAUDE.md");
  assert.match(claude, /^@AGENTS\.md$/m);
  assert.match(claude, /^@docs\/engineering\/agent-harness\.md$/m);
  assert.match(claude, /^@docs\/engineering\/agent-memory\.md$/m);
  assert.match(agents, /docs\/engineering\/agent-harness\.md/);
  assert.match(agents, /npm run harness:doctor/);
});

test("harness config uses only bounded allowlisted commands", () => {
  const config = JSON.parse(read(".harness/config.json"));
  assert.equal(config.version, 1);
  assert.equal(config.nodeMajor, 24);
  const allowlist = new Set(config.allowedExecutables);
  for (const [tierName, entries] of Object.entries(config.tiers)) {
    assert.ok(entries.length > 0, `${tierName} must not be empty`);
    for (const entry of entries) {
      assert.ok(allowlist.has(entry.argv[0]), `${entry.argv[0]} must be allowlisted`);
      assert.ok(entry.timeoutMs >= 1000, `${entry.name} must have a bounded timeout`);
      assert.ok(!entry.argv.some((arg) => /\b(?:deploy|push|migration|email|token)\b/i.test(arg)), `${entry.name} must not mutate production`);
    }
  }
});

test("checkpoint runs and transient evidence remain gitignored", () => {
  const gitignore = read(".gitignore");
  assert.match(gitignore, /^\.harness\/runs\/$/m);
  const schema = JSON.parse(read(".harness/state.schema.json"));
  for (const field of [
    "runId", "objective", "acceptanceCriteria", "allowedPaths", "baseRevision",
    "dirtyBaseline", "iteration", "changedFiles", "commands", "openRisks",
    "blockers", "status", "nextAction", "updatedAt",
  ]) {
    assert.ok(schema.required.includes(field), `schema must require ${field}`);
  }
});

test("package scripts expose the shared verification tiers", () => {
  const pkg = JSON.parse(read("package.json"));
  for (const name of [
    "harness:doctor", "harness:init", "harness:checkpoint", "harness:resume",
    "verify:quick", "verify:core", "verify:release", "test:unit", "test:security", "test:pipelines",
  ]) {
    assert.ok(pkg.scripts[name], `package.json must define ${name}`);
  }
});
