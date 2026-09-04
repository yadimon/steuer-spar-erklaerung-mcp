/**
 * Haelt die handgepflegte Dokumentation an der Operationsliste fest.
 *
 * `build-api-docs.mjs` erzeugt die Referenz und kann deshalb nicht abdriften.
 * Statustafel, Roadmap, Aktionsinventar und Funktionskatalog werden dagegen von
 * Hand geschrieben - dort entsteht die stille Luecke: Eine Operation wird
 * gebaut und live belegt, aber kein Dokument sagt, dass wir das koennen. Oder
 * ein Name wandert und bleibt als Leiche im Text stehen.
 *
 * Die Pruefung ist bewusst grob. Seiten- und Menuenamen des Produkts lassen
 * sich nicht auf Operationsnamen abbilden; das ist auch nicht das Ziel. Geprueft
 * wird nur, was maschinell entscheidbar ist:
 *
 *   1. Die erzeugte Referenz nennt jede Operation und jedes MCP-Werkzeug.
 *   2. Kein Dokument nennt einen Operationsnamen, den es nicht mehr gibt.
 *   3. Jede live belegte Operation kommt in mindestens einem Handdokument vor.
 *   4. Zeilen der Statustafel tragen einen gueltigen Stand, und was dort als
 *      `fertig` steht, ist nicht in Wahrheit nur auf dem Fehlerpfad belegt.
 *
 * Eine Gruppe darf als `praefix_*` genannt werden; das zaehlt fuer alle
 * Operationen mit diesem Praefix. Es laeuft nichts an, es wird keine
 * SteuerSparErklaerung gestartet.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const catalogPath = join(root, "dist", "operation-catalog.js");
assert(
  existsSync(catalogPath),
  "dist/operation-catalog.js fehlt. Erst `npx tsc` laufen lassen, dann diese Pruefung.",
);
const { SSE_MCP_COMPOSED_TOOL_OPERATIONS, SSE_MCP_TOOL_OPERATIONS } = await import(
  "../dist/operation-catalog.js"
);

const coverage = JSON.parse(
  readFileSync(join(root, "test", "operation-coverage.json"), "utf8"),
).operations;
const operations = new Set(Object.keys(coverage));
const liveOperations = new Set(
  Object.entries(coverage)
    .filter(([, entry]) => entry.live === "functional")
    .map(([name]) => name),
);
const toolNames = new Set([
  ...Object.keys(SSE_MCP_TOOL_OPERATIONS),
  ...Object.keys(SSE_MCP_COMPOSED_TOOL_OPERATIONS),
]);

/** Die Referenz wird erzeugt; hier zaehlt nur, dass sie da und vollstaendig ist. */
const generatedPath = join(root, "docs", "API-REFERENZ.md");
assert(
  existsSync(generatedPath),
  "docs/API-REFERENZ.md fehlt. `node scripts/build-api-docs.mjs` erzeugt sie.",
);
const generated = readFileSync(generatedPath, "utf8");
const generatedTokens = new Set([...generated.matchAll(/`([^`\n]+)`/gu)].map((match) => match[1]));
const missingFromReference = [...operations].filter((name) => !generatedTokens.has(name));
assert.deepEqual(
  missingFromReference,
  [],
  `Die erzeugte Referenz nennt diese Operationen nicht - bitte \`node scripts/build-api-docs.mjs\` laufen lassen: ${missingFromReference.join(", ")}`,
);
const missingTools = [...toolNames].filter((name) => !generatedTokens.has(name));
assert.deepEqual(
  missingTools,
  [],
  `Die erzeugte Referenz nennt diese MCP-Werkzeuge nicht: ${missingTools.join(", ")}`,
);

/** Handgepflegte Dokumente - nur diese koennen abdriften. */
const handwrittenPaths = [
  "README.md",
  "docs/README.md",
  "docs/ROADMAP.md",
  "docs/ARCHITEKTUR.md",
  "docs/API-MCP-VERTRAG.md",
  "docs/VERIFIKATION.md",
  "docs/INSTALLATION.md",
  "docs/UMSATZSTEUER-VORANMELDUNG.md",
  "health-check.md",
  "docs/entwicklung/README.md",
  "docs/entwicklung/status.md",
  "docs/entwicklung/aktionsinventar.md",
  "docs/entwicklung/funktionskatalog.md",
  "docs/entwicklung/seitenlandkarte.md",
];
const handwritten = handwrittenPaths.map((path) => ({
  path,
  text: readFileSync(join(root, path), "utf8"),
}));

/** Praefixe, unter denen es wirklich Operationen gibt - nur die tragen `*`. */
const namespaces = new Set();
for (const name of operations) {
  const cut = name.lastIndexOf("_");
  if (cut > 0) namespaces.add(name.slice(0, cut + 1));
}

function editDistanceAtMostTwo(left, right) {
  if (Math.abs(left.length - right.length) > 2) return false;
  const previous = Array.from({ length: right.length + 1 }, (unused, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    let diagonal = previous[0];
    previous[0] = row;
    let best = row;
    for (let column = 1; column <= right.length; column += 1) {
      const candidate = Math.min(
        previous[column] + 1,
        previous[column - 1] + 1,
        diagonal + (left[row - 1] === right[column - 1] ? 0 : 1),
      );
      diagonal = previous[column];
      previous[column] = candidate;
      best = Math.min(best, candidate);
    }
    if (best > 2) return false;
  }
  return previous[right.length] <= 2;
}

/**
 * Ein Token ist verdaechtig, wenn es wie ein Operationsname aussieht, keiner
 * ist und entweder einen echten Operationspraefix traegt oder sich nur um zwei
 * Zeichen von einer Operation unterscheidet. Feldkennungen und Dateinamen aus
 * der Installation (`abgabe_normal`, `anlagen_aus`) fallen so nicht auf.
 */
function isSuspectedOperation(token) {
  if (!/^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/u.test(token)) return false;
  if (operations.has(token) || toolNames.has(token)) return false;
  if ([...namespaces].some((prefix) => token.startsWith(prefix))) return true;
  return [...operations].some((name) => editDistanceAtMostTwo(token, name));
}

const mentioned = new Set();
const stale = [];
for (const { path, text } of handwritten) {
  for (const [index, line] of text.split(/\r?\n/u).entries()) {
    for (const match of line.matchAll(/`([^`\n]+)`/gu)) {
      const token = match[1];
      if (operations.has(token)) {
        mentioned.add(token);
        continue;
      }
      const wildcard = /^([a-z][a-z0-9_]*_)\*$/u.exec(token);
      if (wildcard && namespaces.has(wildcard[1])) {
        for (const name of operations) if (name.startsWith(wildcard[1])) mentioned.add(name);
        continue;
      }
      if (isSuspectedOperation(token)) stale.push(`${path}:${index + 1} nennt \`${token}\``);
    }
  }
}
assert.deepEqual(
  stale,
  [],
  `Diese Dokumentstellen nennen einen Namen, der wie eine Operation aussieht, aber keine ist:\n  ${stale.join("\n  ")}`,
);

const undocumented = [...liveOperations].filter((name) => !mentioned.has(name)).sort();
assert.deepEqual(
  undocumented,
  [],
  `Diese Operationen sind live belegt, aber in keinem handgepflegten Dokument genannt. Was die API kann, muss auch dort stehen:\n  ${undocumented.join(", ")}`,
);

/**
 * Gesamtzahlen im Fliesstext. Eine Formulierung mit „alle" ist eine
 * Vollstaendigkeitsaussage und muss stimmen; als eine Operation dazukam, blieben
 * drei solcher Saetze auf 99 stehen. Zeilenumbrueche werden vorher geglaettet,
 * damit „alle 100\nOperationen" nicht durch die Maschen faellt.
 */
const directToolCount = Object.keys(SSE_MCP_TOOL_OPERATIONS).length;
const totals = [
  [/alle\s+(\d+)\s+Operationen/gu, operations.size, "Operationen"],
  [/(\d+)\s+Operationen\s+sind\s+katalogisiert/gu, operations.size, "katalogisierte Operationen"],
  [/Operationskatalog\s+bleibt\s+bei\s+(\d+)/gu, operations.size, "direkter Operationskatalog"],
  [/alle\s+(\d+)\s+MCP-Werkzeuge/gu, toolNames.size, "MCP-Werkzeugnamen"],
  [/(\d+)\s+direkten?\s+(?:MCP-)?Werkzeuge(?:n|namen)?/gu, directToolCount, "direkte Werkzeuge"],
];
const wrongTotals = [];
for (const { path, text } of handwritten) {
  const prose = text.replace(/\s+/gu, " ");
  for (const [pattern, expected, label] of totals) {
    for (const match of prose.matchAll(pattern)) {
      if (Number(match[1]) === expected) continue;
      wrongTotals.push(`${path}: „${match[0]}" - es sind ${expected} ${label}`);
    }
  }
}
assert.deepEqual(
  wrongTotals,
  [],
  `Diese Gesamtzahlen stimmen nicht mehr mit dem Katalog ueberein:\n  ${wrongTotals.join("\n  ")}`,
);

/** Statustafel: gueltiger Stand je Zeile, und `fertig` muss halten. */
const statusPath = "docs/entwicklung/status.md";
const statusLines = readFileSync(join(root, statusPath), "utf8").split(/\r?\n/u);
const legend = /^\|\s*\*\*(?:fertig|teils|offen|zu)\*\*\s*\|/u;
const overstated = [];
let ratedRows = 0;
for (const [index, line] of statusLines.entries()) {
  if (!line.startsWith("|") || legend.test(line)) continue;
  const rating = /\*\*(fertig|teils|offen|zu)\*\*/u.exec(line);
  if (!rating) continue;
  ratedRows += 1;
  const named = [];
  for (const match of line.matchAll(/`([^`\n]+)`/gu)) {
    const token = match[1];
    if (operations.has(token)) {
      named.push(token);
      continue;
    }
    const wildcard = /^([a-z][a-z0-9_]*_)\*$/u.exec(token);
    if (wildcard && namespaces.has(wildcard[1])) {
      for (const name of operations) if (name.startsWith(wildcard[1])) named.push(name);
    }
  }
  if (rating[1] !== "fertig" || named.length === 0) continue;
  if (named.some((name) => liveOperations.has(name))) continue;
  overstated.push(`${statusPath}:${index + 1} steht auf fertig, nennt aber nur Fehlerpfad-Belege: ${named.join(", ")}`);
}
assert.deepEqual(
  overstated,
  [],
  `Statustafel ueberzeichnet den Stand:\n  ${overstated.join("\n  ")}`,
);
assert(ratedRows > 50, `Statustafel hat nur ${ratedRows} bewertete Zeilen - die Pruefung greift ins Leere.`);

process.stdout.write(
  `Doku-Abgleich: ${operations.size} Operationen, ${liveOperations.size} live belegt und alle benannt, ` +
    `${handwritten.length} Handdokumente, ${ratedRows} bewertete Zeilen bestanden\n`,
);
