/**
 * Jahresabhaengiges Verhalten gehoert ins Profil, nicht in den gemeinsamen Code.
 *
 * Verboten sind Engine-Literale und Verzweigungen ueber die Profil-ID im
 * geteilten Worker- und API-Code. Reine Zahlen ohne Kontrollfluss - etwa
 * Wertebereiche in Schemata - sind erlaubt und stehen in der Ausnahmeliste.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const roots = ["powershell", "src"];
const forbidden = [
  { pattern: /AAV4GLEngineWindow\d+/gu, why: "Engine-Literal statt Profilangabe" },
  { pattern: /Steuerjahr\s+20\d\d/gu, why: "Installationsordner statt Profilangabe" },
  { pattern: /\bprofileId\s*(===?|-eq|!==?|-ne)\s*['"]20\d\d['"]/gu, why: "Verzweigung ueber die Profil-ID" },
  { pattern: /SSE_PROFILE_ID\s*(===?|-eq|!==?|-ne)\s*['"]20\d\d['"]/gu, why: "Verzweigung ueber die Profil-ID" },
  { pattern: /engineFileMajor\s*(===?|-eq|!==?|-ne)\s*\d+/gu, why: "Verzweigung ueber die Engine-Hauptversion" },
];

// Kurz und begruendet. Jeder weitere Eintrag ist eine bewusste Entscheidung.
// Aktuell leer: src/product-profiles.ts nutzt "id" statt "profileId" und
// vergleicht engineFileMajor nie gegen ein Zahlenliteral, daher greift kein
// Muster. Eine pauschale Dateiausnahme ohne echten Treffer wuerde den
// Vertrag nur schwaechen.
const exceptions = new Map([]);

const files = [];
for (const root of roots) {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (!/\.(ps1|ts)$/u.test(entry.name)) continue;
    files.push(`${root}/${entry.name}`);
  }
}
assert.ok(files.length > 0, "Keine gemeinsamen Quelldateien gefunden.");

const violations = [];
for (const file of files) {
  if (exceptions.has(file)) continue;
  const text = readFileSync(file, "utf8");
  for (const { pattern, why } of forbidden) {
    for (const match of text.matchAll(pattern)) {
      const line = text.slice(0, match.index).split("\n").length;
      violations.push(`${file}:${line}: ${why} -> ${match[0]}`);
    }
  }
}

assert.deepEqual(
  violations,
  [],
  `Jahresabhaengiges Verhalten im gemeinsamen Code:\n${violations.join("\n")}`,
);
process.stdout.write(`Jahresbedingungen: ${files.length} gemeinsame Dateien sauber\n`);
