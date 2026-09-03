/**
 * Erzeugt die lesbare Operationsreferenz aus den maschinenlesbaren Quellen.
 *
 * Der Text wird nirgends von Hand gepflegt: Werkzeugnamen und Beschreibungen
 * kommen vom laufenden MCP-Server selbst, die Einordnung aus den
 * Operationsmerkmalen, der Verifikationsstand aus dem Abdeckungsledger und die
 * HTTP-Oberflaeche aus dem OpenAPI-Dokument. Damit kann die Referenz nicht von
 * der Umsetzung abdriften; `--check` haelt das im Testlauf fest.
 *
 * Der MCP-Server laeuft dabei gegen einen Attrappen-API-Server. Es wird keine
 * SteuerSparErklaerung gestartet und keine Operation ausgefuehrt.
 */
import assert from "node:assert/strict";
import { once } from "node:events";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createSseApiServer } from "../dist/api-server.js";
import { SSE_OPENAPI_DOCUMENT } from "../dist/api-openapi.js";
import {
  SSE_MCP_COMPOSED_TOOL_OPERATIONS,
  SSE_MCP_TOOL_OPERATIONS,
} from "../dist/operation-catalog.js";
import {
  SSE_BUILD_DRIFT_BLOCKED_OPERATIONS,
  SSE_CLEANUP_OPERATIONS,
  SSE_DESTRUCTIVE_OPERATIONS,
  SSE_READ_ONLY_OPERATIONS,
} from "../dist/operation-traits.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const target = join(root, "docs", "API-REFERENZ.md");
const checkOnly = process.argv.includes("--check");

const coverage = JSON.parse(readFileSync(join(root, "test", "operation-coverage.json"), "utf8"));
const readOnly = new Set(SSE_READ_ONLY_OPERATIONS);
const destructive = new Set(SSE_DESTRUCTIVE_OPERATIONS);
const cleanup = new Set(SSE_CLEANUP_OPERATIONS);
const driftBlocked = new Set(SSE_BUILD_DRIFT_BLOCKED_OPERATIONS);

/** Werkzeugnamen und Beschreibungen vom Server selbst holen. */
async function listTools() {
  const api = createSseApiServer({
    execute: async (operation, args) => ({ ok: true, operation, args }),
  });
  api.listen(0, "127.0.0.1");
  await once(api, "listening");
  const address = api.address();
  assert(address && typeof address === "object");

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(root, "dist", "index.js")],
    env: { ...process.env, SSE_API_URL: `http://127.0.0.1:${address.port}` },
  });
  const client = new Client({ name: "sse-api-docs", version: "1.0.0" });
  try {
    await client.connect(transport);
    return { tools: (await client.listTools()).tools, instructions: client.getInstructions() ?? "" };
  } finally {
    await client.close().catch(() => undefined);
    await new Promise((resolve) => api.close(resolve));
  }
}

function art(operation) {
  if (cleanup.has(operation)) return "Aufraeumen";
  if (destructive.has(operation)) return "destruktiv";
  if (readOnly.has(operation)) return "lesend";
  return "zustandsaendernd";
}

function status(operation) {
  const entry = coverage.operations?.[operation];
  if (!entry) return "nicht im Ledger";
  if (entry.live === "functional") return "live belegt";
  if (entry.live === "error-path-only") return "nur Fehlerpfad belegt";
  return `live: ${entry.live}`;
}

/** Eine Zeile Fliesstext aus der mehrzeiligen Werkzeugbeschreibung. */
function firstSentence(text) {
  const flat = String(text ?? "").replace(/\s+/gu, " ").trim();
  const stop = flat.indexOf(". ");
  return stop > 0 ? flat.slice(0, stop + 1) : flat;
}

const { tools, instructions } = await listTools();
const toolByOperation = new Map();
for (const [tool, operation] of Object.entries(SSE_MCP_TOOL_OPERATIONS)) toolByOperation.set(operation, tool);


const operations = Object.keys(coverage.operations ?? {}).sort();

const lines = [];
lines.push("# API-Referenz");
lines.push("");
lines.push("Diese Datei wird erzeugt: `node scripts/build-api-docs.mjs`. Sie von Hand zu");
lines.push("aendern hat keinen Bestand - der Suiteschritt `api-docs` ruft denselben");
lines.push("Generator mit `--check` auf und vergleicht Zeichen fuer Zeichen.");
lines.push("");
lines.push("Quellen sind der MCP-Server selbst (Werkzeugnamen und Beschreibungen), die");
lines.push("Operationsmerkmale in `src/operation-traits.ts`, das Abdeckungsledger");
lines.push("`test/operation-coverage.json` und das OpenAPI-Dokument in `src/api-openapi.ts`.");
lines.push("");

lines.push("## Zahlen");
lines.push("");
const liveOk = operations.filter((op) => coverage.operations[op].live === "functional").length;
lines.push(`- Operationen insgesamt: **${operations.length}**`);
lines.push(`- davon live belegt: **${liveOk}**`);
lines.push(`- davon nur auf dem Fehlerpfad belegt: **${operations.length - liveOk}**`);
lines.push(`- als MCP-Werkzeug veroeffentlicht: **${Object.keys(SSE_MCP_TOOL_OPERATIONS).length}**`);
lines.push(`- zusammengesetzte MCP-Werkzeuge: **${Object.keys(SSE_MCP_COMPOSED_TOOL_OPERATIONS).length}**`);
lines.push(`- nur lesend: **${SSE_READ_ONLY_OPERATIONS.length}**, destruktiv: **${SSE_DESTRUCTIVE_OPERATIONS.length}**, Aufraeumen: **${SSE_CLEANUP_OPERATIONS.length}**`);
lines.push(`- nach einem Produktupdate gesperrt, bis der Build neu verifiziert ist: **${SSE_BUILD_DRIFT_BLOCKED_OPERATIONS.length}**`);
lines.push("");

lines.push("## HTTP-Oberflaeche");
lines.push("");
lines.push(`OpenAPI ${SSE_OPENAPI_DOCUMENT.openapi}, Titel „${SSE_OPENAPI_DOCUMENT.info.title}“.`);
lines.push("");
lines.push("| Pfad | Methode | Zweck |");
lines.push("| --- | --- | --- |");
// Die Pfade je Operation folgen alle demselben Muster; einzeln aufgezaehlt
// waeren es zweihundert nahezu gleiche Zeilen. Sie stehen zusammengefasst
// unten, die Operationen selbst in der naechsten Tabelle.
let perOperationPaths = 0;
for (const [path, methods] of Object.entries(SSE_OPENAPI_DOCUMENT.paths)) {
  if (path.includes("/operations/")) {
    perOperationPaths += Object.keys(methods).length;
    continue;
  }
  for (const [method, definition] of Object.entries(methods)) {
    lines.push(`| \`${path}\` | ${method.toUpperCase()} | ${definition.summary ?? ""} |`);
  }
}
lines.push(
  `| \`/${SSE_OPENAPI_DOCUMENT.info.version}/operations/{operation}\` | GET, POST | ` +
    `Schema und Sicherheitsmerkmale lesen beziehungsweise die Operation ausfuehren ` +
    `(${perOperationPaths} Pfadeintraege fuer ${operations.length} Operationen) |`,
);
lines.push("");

lines.push("## Operationen");
lines.push("");
lines.push("`Art` unterscheidet lesende, zustandsaendernde, destruktive und aufraeumende");
lines.push("Operationen. `Drift` markiert die Operationen, die nach einem Produktupdate");
lines.push("gesperrt sind, bis der neue Build live nachverifiziert wurde.");
lines.push("");
lines.push("| Operation | MCP-Werkzeug | Art | Drift | Stand |");
lines.push("| --- | --- | --- | --- | --- |");
for (const operation of operations) {
  const tool = toolByOperation.get(operation);
  lines.push(
    `| \`${operation}\` | ${tool ? `\`${tool}\`` : "–"} | ${art(operation)} | ` +
      `${driftBlocked.has(operation) ? "ja" : "–"} | ${status(operation)} |`,
  );
}
lines.push("");

lines.push("## MCP-Werkzeuge");
lines.push("");
lines.push(`Der Server meldet ${tools.length} Werkzeuge.`);
lines.push("");
for (const tool of [...tools].sort((a, b) => a.name.localeCompare(b.name))) {
  const operation = SSE_MCP_TOOL_OPERATIONS[tool.name] ?? SSE_MCP_COMPOSED_TOOL_OPERATIONS[tool.name];
  lines.push(`### \`${tool.name}\``);
  lines.push("");
  if (tool.title) lines.push(`**${tool.title}**`);
  lines.push("");
  lines.push(firstSentence(tool.description));
  lines.push("");
  if (Array.isArray(operation)) {
    lines.push(`Setzt sich zusammen aus: ${operation.map((entry) => `\`${entry}\``).join(", ")}.`);
  } else if (typeof operation === "string") {
    lines.push(`Operation: \`${operation}\` (${art(operation)}${driftBlocked.has(operation) ? ", drift-gesperrt" : ""}).`);
  }
  lines.push("");
}

lines.push("## Serveranweisung");
lines.push("");
lines.push("Der MCP-Server gibt Clients diese Anweisung mit:");
lines.push("");
for (const line of instructions.split("\n")) lines.push(`> ${line}`.trimEnd());
lines.push("");

const rendered = lines.join("\n");

if (checkOnly) {
  const current = readFileSync(target, "utf8");
  assert.equal(
    current.replace(/\r\n/gu, "\n"),
    rendered,
    "docs/API-REFERENZ.md weicht von den Quellen ab. Mit `node scripts/build-api-docs.mjs` neu erzeugen.",
  );
  process.stdout.write(`API-Referenz ohne Drift: ${operations.length} Operationen, ${tools.length} Werkzeuge.\n`);
} else {
  writeFileSync(target, rendered, "utf8");
  process.stdout.write(`docs/API-REFERENZ.md erzeugt: ${operations.length} Operationen, ${tools.length} Werkzeuge.\n`);
}
