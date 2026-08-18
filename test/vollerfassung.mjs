/**
 * Vollstaendige Erfassung im SICHTBAREN Modus.
 *
 * Nutzt aus, was nur dort geht: Navigationsbaum per echtem Klick (springt an
 * den Anfang, den man rueckwaerts nicht erreicht) und sse_table_read, das
 * virtualisierte Tabellen ueber die Pfeiltaste vollstaendig liest.
 *
 * Aufruf: node test/vollerfassung.mjs [--max 90] [--out .tmp/voll.json]
 */
import { callWorker } from "../dist/worker.js";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

mkdirSync(".tmp", { recursive: true });

const argv = process.argv.slice(2);
const opt = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const MAX = Number(opt("--max", "90"));
const ZIEL = opt("--out", join(".tmp", "voll.json"));

const RAUSCHEN = /^(Formular|Ergebnis|Prüfer|Roter Faden|Steuerwissen|Alma|Zurück|Weiter|Sichern|Drucken|ELSTER|Anlage|Eingabehilfe|Steuertipps|Mehr Details|Steuer-Spar-Tipp zum Einfügen in ein Feld der Tabelle ziehen)$/;

const gesund = await callWorker("health");
if (gesund.advice !== "gesund") { console.error(`Abbruch: ${gesund.advice}`); process.exit(1); }
console.log(`gesund (${gesund.canaryMs} ms)\n`);

// An den Anfang springen - nur ueber den Baum moeglich (echter Klick).
const sprung = await callWorker("click_point", { name: "Einnahmen/Ausgaben", type: "TreeItem", waitMs: 1800 }, 120_000);
console.log(`Baumsprung: ${sprung.ok === false ? "FEHLER " + String(sprung.error).slice(0, 80) : "ok"}`);

const seiten = [];
const gesehen = new Map();
let wiederholt = 0;

for (let i = 1; i <= MAX; i++) {
  let voll, pruef, unter;
  try {
    voll  = await callWorker("read_full", {}, 180_000);
    pruef = await callWorker("check", {}, 120_000);
    unter = await callWorker("subpages", {}, 120_000);
  } catch (e) { console.error(`  Seite ${i}: ${e.message}`); break; }

  const kopf = voll.ueberschrift || `(ohne Überschrift ${i})`;
  const n = (gesehen.get(kopf) ?? 0) + 1;
  gesehen.set(kopf, n);
  const zeilen = (voll.zeilen ?? []).filter((z) => z && !RAUSCHEN.test(z.trim()));

  // Tabelle vollstaendig lesen, wenn eine da ist (nur sichtbar moeglich)
  let tabelle = null;
  if (zeilen.some((z) => /Nr\.\s*::\s*Datum/.test(z))) {
    try {
      const t = await callWorker("table_read", { maxRows: 80 }, 300_000);
      if ((t.anzahl ?? 0) > 0) tabelle = { kopf: t.kopf, zeilen: t.zeilen, vollstaendig: t.vollstaendig };
    } catch (e) { /* Tabelle bleibt null */ }
  }

  seiten.push({
    nr: i, ueberschrift: kopf, zeilen, tabelle,
    unterseiten: (unter.unterseiten ?? []).filter((u) => !/^(Formular|Ergebnis|Steuerwissen|Alma|Zurück|Weiter)$/.test(u.schalter)),
    pruefung: { ok: pruef.ok, meldungen: pruef.prueferMeldungen ?? [] },
  });

  const tInfo = tabelle ? `, Tabelle ${tabelle.zeilen.length}${tabelle.vollstaendig ? "" : " (unvollständig)"}` : "";
  const warn = (pruef.prueferMeldungen ?? []).length ? `  ⚠ ${pruef.prueferMeldungen.join(" | ")}` : "";
  console.log(`${String(i).padStart(3)}. ${kopf}  (${zeilen.length} Z${tInfo})${warn}`);

  if (kopf === "Gewinnermittlung beginnen") { console.log("     → Ende."); break; }
  if (n > 1 && ++wiederholt >= 3) { console.log("     → wiederholt sich, Ende."); break; }
  if (n === 1) wiederholt = 0;

  const w = await callWorker("click", { name: "Weiter", waitMs: 900 }, 60_000);
  if (w.ok === false) { console.log("     → 'Weiter' nicht möglich, Ende."); break; }
  if (i % 15 === 0) {
    const h = await callWorker("health");
    if (h.advice !== "gesund") { console.error(`     !! träge (${h.canaryMs} ms)`); break; }
  }
}

writeFileSync(ZIEL, JSON.stringify({ erstellt: new Date().toISOString(), anzahl: seiten.length, seiten }, null, 2), "utf8");
console.log(`\n${seiten.length} Seiten → ${ZIEL}`);
const mitTab = seiten.filter((s) => s.tabelle);
console.log(`davon ${mitTab.length} mit Tabelle, ${seiten.filter((s) => s.pruefung.meldungen.length).length} mit Beanstandung`);
