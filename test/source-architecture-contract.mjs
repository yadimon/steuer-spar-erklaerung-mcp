import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";

const sourceDirectory = "src";
const sourceFiles = readdirSync(sourceDirectory)
  .filter((name) => name.endsWith(".ts"))
  .sort();
const sourceFileSet = new Set(sourceFiles);
const maximumModuleBytes = 24 * 1024;
const maximumSourceLineCharacters = 200;
const graph = new Map();

function normalizedUtf8Bytes(source) {
  return Buffer.byteLength(source.replace(/\r\n/gu, "\n"), "utf8");
}

assert.equal(
  normalizedUtf8Bytes("erste\nzweite\n"),
  normalizedUtf8Bytes("erste\r\nzweite\r\n"),
  "Die Modulgroesse muss fuer LF- und CRLF-Checkouts identisch sein.",
);

for (const sourceFile of sourceFiles) {
  const path = join(sourceDirectory, sourceFile);
  const source = readFileSync(path, "utf8");
  const size = normalizedUtf8Bytes(source);
  assert(
    size <= maximumModuleBytes,
    `${sourceFile} ist mit ${size} normalisierten UTF-8-Bytes groesser als die wartbare Modulgrenze ` +
      `${maximumModuleBytes}.`,
  );

  if (source.includes("@modelcontextprotocol/sdk")) {
    assert(sourceFile.startsWith("mcp-"), `${sourceFile} koppelt den API-Kern an das MCP-SDK.`);
  }
  for (const [lineIndex, line] of source.split(/\r?\n/u).entries()) {
    assert(
      line.length <= maximumSourceLineCharacters,
      `${sourceFile}:${lineIndex + 1} hat ${line.length} Zeichen; Maximum ist ${maximumSourceLineCharacters}.`,
    );
  }
  const dependencies = [...source.matchAll(
    /(?:import|export)\s+(?:type\s+)?(?:[^"']*?\s+from\s+)?["'](\.\.?\/[^"']+)["']/g,
  )]
    .map((match) => basename(match[1]).replace(/\.js$/u, ".ts"))
    .filter((dependency) => sourceFileSet.has(dependency));
  graph.set(sourceFile, [...new Set(dependencies)].sort());
}

const visited = new Set();
const active = new Set();
const stack = [];

function visit(sourceFile) {
  if (active.has(sourceFile)) {
    const cycleStart = stack.indexOf(sourceFile);
    assert.fail(`Zirkulaerer Source-Import: ${[...stack.slice(cycleStart), sourceFile].join(" -> ")}`);
  }
  if (visited.has(sourceFile)) return;
  active.add(sourceFile);
  stack.push(sourceFile);
  for (const dependency of graph.get(sourceFile) ?? []) visit(dependency);
  stack.pop();
  active.delete(sourceFile);
  visited.add(sourceFile);
}

for (const sourceFile of sourceFiles) visit(sourceFile);

process.stdout.write(
  `Source-Architektur: ${sourceFiles.length} TS-Module <= ${maximumModuleBytes} Bytes, ` +
  `Zeilen <= ${maximumSourceLineCharacters} Zeichen und ohne Importzyklen\n`,
);
