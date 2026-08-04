import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { SSE_API_OPERATIONS } from "../dist/api-contract.js";
import {
  SSE_MCP_COMPOSITION_ONLY_OPERATIONS,
  SSE_MCP_TOOL_OPERATIONS,
  SSE_MCP_TOOL_SCHEMAS,
} from "../dist/operation-catalog.js";

const indexSource = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
const mcpSourceFiles = readdirSync(new URL("../src", import.meta.url))
  .filter((name) => /^mcp-[a-z-]+\.ts$/u.test(name))
  .sort();
const mcpSources = [indexSource, ...mcpSourceFiles.map((name) =>
  readFileSync(new URL(`../src/${name}`, import.meta.url), "utf8"))];
const mcpSourceText = mcpSources.join("\n");
const allSourceFiles = readdirSync(new URL("../src", import.meta.url))
  .filter((name) => name.endsWith(".ts"));
const sourceByFile = new Map(allSourceFiles.map((name) => [
  name,
  readFileSync(new URL(`../src/${name}`, import.meta.url), "utf8"),
]));
const reachableSources = new Set(["index.ts", ...mcpSourceFiles]);
const pendingSources = [...reachableSources];
while (pendingSources.length) {
  const sourceFile = pendingSources.pop();
  const source = sourceByFile.get(sourceFile) ?? "";
  for (const match of source.matchAll(/(?:from\s+|import\s*\()\s*["']\.\/([a-z0-9-]+)\.js["']/giu)) {
    const dependency = `${match[1]}.ts`;
    if (!sourceByFile.has(dependency) || reachableSources.has(dependency)) continue;
    reachableSources.add(dependency);
    pendingSources.push(dependency);
  }
}
for (const forbiddenModule of [
  "worker.ts", "api-executor.ts", "checker-executor.ts", "launch-executor.ts",
  "workspace-executor.ts", "ustva-executor.ts", "scenario.ts", "workspace.ts",
  "resources.ts", "setup.ts", "windows-runtime.ts", "product-profiles.ts",
]) {
  assert(!reachableSources.has(forbiddenModule), `MCP erreicht PC-Runtime-Modul '${forbiddenModule}' transitiv.`);
}
const executorSource = ["api-executor.ts", "checker-executor.ts", "ustva-executor.ts"]
  .map((file) => readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8"))
  .join("\n");
const forbidden = [
  /from\s+["']\.\/worker(?:\.js)?["']/,
  /from\s+["']node:(?:fs|path|child_process)["']/,
  /\bcallWorker\b/,
  /\bspawn(?:Sync)?\s*\(/,
  /process\.env\.SSE_(?:CASE_DIR|EXECUTABLE)/,
  /from\s+["']\.\/(?:worker|api-executor|checker-executor|launch-executor|workspace-executor|ustva-executor|scenario|workspace|resources|setup|windows-runtime|product-profiles)(?:\.js)?["']/,
];
for (const pattern of forbidden) {
  for (const sourceFile of reachableSources) {
    const source = sourceByFile.get(sourceFile) ?? "";
    assert(!pattern.test(source), `MCP-Grenze verletzt: ${pattern}`);
  }
}
const reachableSourceText = [...reachableSources]
  .map((sourceFile) => sourceByFile.get(sourceFile) ?? "")
  .join("\n");
const mcpEnvironmentKeys = [...new Set(
  [...reachableSourceText.matchAll(/process\.env(?:\.|\[["'])(SSE_[A-Z0-9_]+)/gu)].map((match) => match[1]),
)].sort();
assert.deepEqual(
  mcpEnvironmentKeys,
  ["SSE_API_TOKEN", "SSE_API_URL"],
  "MCP darf ausschliesslich die lokale API-Adresse und deren Token aus der PC-Umgebung lesen.",
);

const toolNames = Object.keys(SSE_MCP_TOOL_SCHEMAS).sort();
assert.deepEqual(Object.keys(SSE_MCP_TOOL_OPERATIONS).sort(), toolNames, "Jedes MCP-Schema braucht genau ein API-Mapping.");
assert(toolNames.length >= 85, `Zu wenige MCP-Werkzeuge gefunden: ${toolNames.length}`);
const documentedToolReferences = [...new Set(mcpSourceText.match(/\bsse_[a-z_]+\b/g) ?? [])].sort();
assert.deepEqual(
  documentedToolReferences.filter((name) => !toolNames.includes(name)),
  [],
  "MCP-Beschreibungen verweisen auf nicht vorhandene sse_*-Werkzeuge.",
);

const failedSelftest = spawnSync(process.execPath, ["dist/index.js", "--selftest"], {
  cwd: process.cwd(),
  encoding: "utf8",
  windowsHide: true,
  env: {
    ...process.env,
    SSE_API_URL: "https://example.invalid",
    SSE_API_TOKEN: "startup-redaction-token-with-at-least-24-characters",
  },
});
assert.equal(failedSelftest.status, 1);
assert.match(failedSelftest.stderr, /Start fehlgeschlagen/);
assert(!/[A-Za-z]:[\\/]|file:\/\/\//u.test(failedSelftest.stderr), "MCP-Startfehler enthaelt lokalen Installationspfad.");

const directOperations = new Set(Object.values(SSE_MCP_TOOL_OPERATIONS));
for (const operation of SSE_MCP_COMPOSITION_ONLY_OPERATIONS) {
  assert(!directOperations.has(operation), `${operation} ist direkt und als composition-only katalogisiert.`);
  assert(
    new RegExp(`\\b(?:executeOperation|step)\\(\\s*["']${operation}["']`).test(executorSource),
    `Composition-only-Operation '${operation}' wird vom API-Executor nicht aufgerufen.`,
  );
}
const usedOperations = new Set([...directOperations, ...SSE_MCP_COMPOSITION_ONLY_OPERATIONS]);
const allowed = new Set(SSE_API_OPERATIONS);
const outsideAllowlist = [...usedOperations].filter((operation) => !allowed.has(operation));
assert.deepEqual(outsideAllowlist, [], `MCP referenziert nicht freigegebene Operationen: ${outsideAllowlist.join(", ")}`);

const notReachableFromMcp = SSE_API_OPERATIONS.filter((operation) => !usedOperations.has(operation));
assert.deepEqual(
  notReachableFromMcp,
  [],
  `API-Operationen ohne MCP- oder Kompositionspfad: ${notReachableFromMcp.join(", ")}`,
);

process.stdout.write(
  `Wrapper-Grenze: ${mcpSourceFiles.length} MCP-Module/${reachableSources.size} PC-blinde Abhaengigkeiten, ` +
  `${toolNames.length} Werkzeuge, ${usedOperations.size} API-Operationen\n`,
);
