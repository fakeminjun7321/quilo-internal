"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { pullRequestNumberFromSubject } = require("../lib/version-info");

test("release version recognizes merge and squash PR commit subjects", () => {
  assert.equal(pullRequestNumberFromSubject("Merge pull request #39 from owner/branch"), 39);
  assert.equal(pullRequestNumberFromSubject("release: deploy PR #41"), 41);
  assert.equal(pullRequestNumberFromSubject("feat: add telemetry (#40)"), 40);
  assert.equal(pullRequestNumberFromSubject("fix: reference #42 in body"), 0);
});
