import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SSE_API_OPERATIONS } from "../dist/api-contract.js";

const source = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
const executorSource = readFileSync(new URL("../src/api-executor.ts", import.meta.url), "utf8");
const forbidden = [
  /from\s+["']\.\/worker(?:\.js)?["']/,
  /from\s+["']node:(?:fs|path|child_process)["']/,
  /\bcallWorker\b/,
  /\bspawn(?:Sync)?\s*\(/,
  /process\.env\.SSE_(?:CASE_DIR|EXECUTABLE)/,
];
for (const pattern of forbidden) {
  assert(!pattern.test(source), `MCP-Grenze verletzt: ${pattern}`);
}

const toolMatches = [...source.matchAll(/registerStrictTool\(\s*\n?\s*"(sse_[a-z0-9_]+)"/g)];
assert(toolMatches.length >= 80, `Zu wenige MCP-Werkzeuge gefunden: ${toolMatches.length}`);
for (let index = 0; index < toolMatches.length; index += 1) {
  const start = toolMatches[index].index;
  const end = toolMatches[index + 1]?.index ?? source.length;
  const block = source.slice(start, end);
  assert(
    /\brun\s*\(|\bcallApiOperation\s*\(/.test(block),
    `${toolMatches[index][1]} besitzt keinen API-Aufruf`,
  );
}

const usedOperations = new Set(
  [...source.matchAll(/\b(?:run|callApiOperation)\(\s*"([a-z_]+)"/g)].map((match) => match[1]),
);
for (const match of executorSource.matchAll(/\b(?:execute|step)\(\s*"([a-z_]+)"/g)) {
  usedOperations.add(match[1]);
}
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
  `Wrapper-Grenze: ${toolMatches.length} MCP-Werkzeuge, ${usedOperations.size} API-Operationen, keine lokale PC-Ausfuehrung\n`,
);
