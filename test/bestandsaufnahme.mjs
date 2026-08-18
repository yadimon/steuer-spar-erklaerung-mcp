/**
 * Liest die entscheidenden Seiten des geladenen Steuerfalls und prueft jede.
 * Laeuft vollstaendig im versteckten Modus.
 *
 * Aufruf: node test/bestandsaufnahme.mjs [--out .tmp/bestand.json]
 */
import { callWorker } from "../dist/worker.js";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

mkdirSync(".tmp", { recursive: true });

const ZIEL = process.argv.includes("--out")
  ? process.argv[process.argv.indexOf("--out") + 1]
  : join(".tmp", "bestand.json");

const SEITEN = [
  "Übersicht Betriebseinnahmen",
  "Einnahmen: Freiberufler",
  "Umsatzsteuerzahlungen/-Erstattungen",
  "Betriebsausgaben",
  "Personalkosten",
  "Beiträge, Gebühren und Abgaben",
  "EDV-Kosten",
  "Vorsteuer (Übersicht)",
  "Umsatzsteuererklärung 2025",
];

const gesund = await callWorker("health");
if (gesund.advice !== "gesund") {
  console.error(`Abbruch: ${gesund.advice} (Kanarienvogel ${gesund.canaryMs} ms)`);
  process.exit(1);
}
console.log(`Programm gesund (${gesund.canaryMs} ms)\n`);

const ergebnis = [];
for (const ziel of SEITEN) {
  // goto blaettert seitenweise; bei weit entfernten Zielen dauert das.
  const g = await callWorker("goto", { ziel }, 300_000);
  if (g.ok === false) {
    console.log(`✗ ${ziel}\n    ${String(g.error).split("Abhilfe")[0].trim()}`);
    ergebnis.push({ seite: ziel, erreicht: false, grund: g.error });
    continue;
  }
  const voll = await callWorker("read_full");
  const pruef = await callWorker("check");
  const zeilen = (voll.zeilen ?? []).filter(
    (z) => z && !/^(Formular|Ergebnis|Prüfer|Roter Faden|Steuerwissen|Alma|Zurück|Weiter)$/.test(z),
  );
  console.log(`✓ ${ziel}   (${g.schritte} Schritte, ${zeilen.length} Zeilen${voll.gerollt ? `, ${voll.stufen} Rollstufen` : ""})`);
  if (pruef.ok === false || (pruef.prueferMeldungen ?? []).length) {
    console.log(`    ⚠ ${pruef.urteil}  ${(pruef.prueferMeldungen ?? []).join(" | ")}`);
  }
  ergebnis.push({
    seite: ziel, erreicht: true, schritte: g.schritte,
    gerollt: voll.gerollt, zeilen,
    pruefung: { ok: pruef.ok, urteil: pruef.urteil, meldungen: pruef.prueferMeldungen ?? [] },
  });
}

writeFileSync(ZIEL, JSON.stringify({ erstellt: new Date().toISOString(), seiten: ergebnis }, null, 2), "utf8");
console.log(`\n${ergebnis.filter((e) => e.erreicht).length}/${SEITEN.length} Seiten gelesen -> ${ZIEL}`);
