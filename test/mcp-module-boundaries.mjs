import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { SSE_MCP_ANALYSIS_SCHEMAS } from "../dist/mcp-schemas-analysis.js";
import { SSE_MCP_DESKTOP_SCHEMAS } from "../dist/mcp-schemas-desktop.js";
import { SSE_MCP_DIAGNOSTIC_SCHEMAS } from "../dist/mcp-schemas-diagnostics.js";
import { SSE_MCP_INTERACTION_SCHEMAS } from "../dist/mcp-schemas-interaction.js";
import { SSE_MCP_LIFECYCLE_SCHEMAS } from "../dist/mcp-schemas-lifecycle.js";
import { SSE_MCP_UI_SCHEMAS } from "../dist/mcp-schemas-ui.js";
import { SSE_MCP_TOOL_OPERATIONS } from "../dist/operation-catalog.js";

const groups = [
  ["analysis", SSE_MCP_ANALYSIS_SCHEMAS],
  ["desktop", SSE_MCP_DESKTOP_SCHEMAS],
  ["diagnostics", SSE_MCP_DIAGNOSTIC_SCHEMAS],
  ["interaction", SSE_MCP_INTERACTION_SCHEMAS],
  ["lifecycle", SSE_MCP_LIFECYCLE_SCHEMAS],
  ["ui", SSE_MCP_UI_SCHEMAS],
];
const registrationPattern = /register(?:ApiTool|ShapedApiTool|StrictTool)\(\s*"(sse_[a-z0-9_]+)"/g;
const registered = [];

for (const [group, schemas] of groups) {
  const toolFile = `src/mcp-tools-${group}.ts`;
  const schemaFile = `src/mcp-schemas-${group}.ts`;
  const [toolStats, schemaStats, source] = await Promise.all([
    stat(toolFile), stat(schemaFile), readFile(toolFile, "utf8"),
  ]);
  assert(toolStats.size <= 24 * 1024, `${toolFile} ist groesser als die wartbare Modulgrenze von 24 KiB.`);
  assert(schemaStats.size <= 24 * 1024, `${schemaFile} ist groesser als die wartbare Modulgrenze von 24 KiB.`);
  const names = [...source.matchAll(registrationPattern)].map((match) => match[1]);
  assert.deepEqual(
    [...names].sort(),
    Object.keys(schemas).sort(),
    `Werkzeuge und Eingabeschemas der Gruppe ${group} muessen exakt uebereinstimmen.`,
  );
  registered.push(...names);
}

for (const file of ["src/operation-catalog.ts", "src/operation-schema-primitives.ts"]) {
  assert((await stat(file)).size <= 24 * 1024, `${file} ist groesser als die wartbare Modulgrenze von 24 KiB.`);
}

assert.equal(new Set(registered).size, registered.length, "Jedes MCP-Werkzeug darf nur einmal registriert werden.");
assert.deepEqual(
  [...registered].sort(),
  Object.keys(SSE_MCP_TOOL_OPERATIONS).sort(),
  "Die fachlichen MCP-Module muessen den gesamten Katalog exakt abdecken.",
);

for (const entry of ["src/index.ts", "src/mcp-tools.ts"]) {
  const source = await readFile(entry, "utf8");
  registrationPattern.lastIndex = 0;
  assert(!registrationPattern.test(source), `${entry} darf keine fachliche Werkzeugdefinition enthalten.`);
}

process.stdout.write(`MCP-Modulgrenzen: ${registered.length} Werkzeuge und Schemas in ${groups.length} wartbaren Gruppen\n`);
