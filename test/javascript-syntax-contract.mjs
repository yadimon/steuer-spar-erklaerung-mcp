import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import { availableParallelism } from "node:os";
import { join, relative } from "node:path";

const roots = ["scripts", "test"];

function collectModules(directory) {
  const modules = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) modules.push(...collectModules(path));
    else if (entry.isFile() && entry.name.endsWith(".mjs")) modules.push(path);
  }
  return modules;
}

function checkSyntax(path) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--check", path], {
      cwd: process.cwd(),
      windowsHide: true,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      if (stderr.length < 16_384) stderr += chunk.slice(0, 16_384 - stderr.length);
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0 && !signal) resolve();
      else reject(new Error(`${relative(process.cwd(), path)}: Exit ${code ?? "-"}, Signal ${signal ?? "-"}\n${stderr}`));
    });
  });
}

const modules = roots.flatMap(collectModules).sort();
const requiredDormantEntries = [
  "multi-instance-binding.mjs",
  "search-set-transaction.mjs",
  "table-add-transaction.mjs",
  "table-delete-transaction.mjs",
  "table-update-transaction.mjs",
  "toggle-transaction.mjs",
  "visible-input-guard.mjs",
].map((name) => join("test", name));
for (const path of requiredDormantEntries) {
  assert(modules.includes(path), `Fixturegebundener Regressionseinstieg fehlt im Syntaxvertrag: ${path}`);
}

let nextIndex = 0;
const concurrency = Math.min(8, availableParallelism(), modules.length);
await Promise.all(Array.from({ length: concurrency }, async () => {
  while (nextIndex < modules.length) {
    const path = modules[nextIndex++];
    await checkSyntax(path);
  }
}));

process.stdout.write(`JavaScript-Syntax: ${modules.length} Module inklusive Fixture-Regressionen geprueft\n`);
