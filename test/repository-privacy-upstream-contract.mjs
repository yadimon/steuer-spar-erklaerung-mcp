import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, sep } from "node:path";
import { createReviewedUpstreamHistory } from "./repository-privacy-upstream.mjs";

const temporary = mkdtempSync(join(tmpdir(), "sse-privacy-upstream-"));
const ownedRoot = realpathSync(temporary);
const fixture = join(temporary, "fixture"), emptyConfig = join(temporary, "empty-config");
mkdirSync(fixture);
writeFileSync(emptyConfig, "");
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith("GIT_")));
Object.assign(env, { GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: emptyConfig });
const git = (args, options = {}) => execFileSync("git", args, {
  cwd: fixture, env, windowsHide: true, ...options,
});
const text = (args) => git(args, { encoding: "utf8" }).trim();
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
try {
  git(["init", "--initial-branch=main", "--template="]);
  git(["config", "user.name", "Fixture"]);
  git(["config", "user.email", ["fixture", "example.invalid"].join("@")]);
  git(["config", "commit.gpgsign", "false"]);
  git(["config", "core.hooksPath", join(temporary, "empty-hooks")]);
  const path = "upstream.hpp", bytes = Buffer.from("Reviewed upstream fixture\n");
  const reviewed = new Map([[path, sha256(bytes)]]);
  writeFileSync(join(fixture, path), bytes);
  writeFileSync(join(fixture, "other.hpp"), bytes);
  git(["add", "--", path, "other.hpp"]);
  git(["commit", "-m", "test: create reviewed fixture"]);
  const first = text(["rev-parse", "HEAD"]);
  writeFileSync(join(fixture, "extra.txt"), "Second revision\n");
  git(["add", "--", "extra.txt"]);
  git(["commit", "-m", "test: retain reviewed bytes"]);
  const second = text(["rev-parse", "HEAD"]);
  writeFileSync(join(fixture, path), `Changed ${["private", "example.invalid"].join("@")}\n`);
  git(["add", "--", path]);
  git(["commit", "-m", "test: change reviewed fixture"]);
  const changed = text(["rev-parse", "HEAD"]);
  assert.equal(text(["rev-parse", `${first}:${path}`]), text(["rev-parse", `${second}:${path}`]));
  const calls = [];
  const countedGit = (command, args, options) => {
    calls.push(args);
    return execFileSync(command, args, { ...options, env });
  };
  const filter = createReviewedUpstreamHistory(fixture, reviewed, countedGit);
  const firstLine = `${first}:${path}:1:match`, secondLine = `${second}:${path}:2:match`;
  assert.deepEqual(filter([firstLine]), []);
  assert.deepEqual(filter([secondLine]), []);
  assert.equal(calls.filter((args) => args[1] === "--batch-check").length, 2,
    "Every new revision:path needs immutable object resolution.");
  assert.equal(calls.filter((args) => args[1] === "blob").length, 1,
    "Identical bytes at different revisions must be read and hashed once.");
  const wrongPath = `${first}:other.hpp:1:match`, changedLine = `${changed}:${path}:1:match`;
  const lines = [firstLine, wrongPath, changedLine, secondLine, "unparseable"];
  const expected = [wrongPath, changedLine, "unparseable"];
  assert.deepEqual(filter(lines), expected,
    "Only exact reviewed path/content pairs are exempt; preserve every other line and its order.");
  assert.equal(calls.filter((args) => args[1] === "blob").length, 2,
    "Changed file objects require another complete content hash.");
  const count = calls.length;
  assert.deepEqual(filter(lines), expected);
  assert.equal(calls.length, count, "Already validated immutable references need no duplicate Git reads.");
  const fresh = (reader) => createReviewedUpstreamHistory(fixture, reviewed, reader);
  assert.throws(() => fresh(() => "missing missing\n")([firstLine]), /not a readable blob/u);
  assert.throws(() => fresh(() => `${first} tree 12\n`)([firstLine]), /not a readable blob/u);
  assert.throws(() => fresh(() => `${first} blob 2097153\n`)([firstLine]), /existing read limit/u);
  assert.throws(() => fresh(() => "")([firstLine, secondLine]), /object metadata/u);
  assert.throws(() => fresh(() => { throw new Error("Git failed"); })([firstLine]), /Git failed/u);
  assert.throws(() => fresh(countedGit)([`${"f".repeat(40)}:${path}:1:match`]), /not a readable blob/u);
  process.stdout.write("Reviewed history blobs: reference resolution, byte identity, path isolation and fail-closed errors passed\n");
} finally {
  const finalRoot = realpathSync(temporary), parent = realpathSync(tmpdir());
  const rel = relative(parent, finalRoot);
  assert.equal(finalRoot, ownedRoot);
  assert(!lstatSync(temporary).isSymbolicLink() && rel && !isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`),
    "Cleanup must remain inside the exact owned temporary fixture.");
  rmSync(temporary, { recursive: true, force: true });
}
