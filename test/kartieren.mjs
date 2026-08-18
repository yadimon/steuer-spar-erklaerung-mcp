/**
 * Laeuft mit "Weiter" durch alle Eingabeseiten des geladenen Steuerfalls und
 * schreibt Ueberschrift, Zeilen und Tabellen nur nach .tmp/.
 *
 * Aufruf:  node test/kartieren.mjs [--max 120] [--von "Name des Startdialogs"]
 *
 * Beendet sich, wenn "Weiter" fehlt, sich Ueberschriften wiederholen oder
 * das Programm traege wird (Kanarienvogel).
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { writeFileSync, mkdirSync } from "node:fs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER = join(HERE, "..", "dist", "index.js");
const TEMP = join(HERE, "..", ".tmp");
mkdirSync(TEMP, { recursive: true });

const argv = process.argv.slice(2);
const opt = (flag, def) => {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};
const MAX = Number(opt("--max", "150"));
const VON = opt("--von", null);
// Rueckwaerts ist oft der einzige Weg, den Anfang zu erreichen: der
// Vorwaertslauf endet auf "Gewinnermittlung beginnen", und von dort fuehrt
// weder "Weiter" noch "Jetzt beginnen" zurueck an den Anfang.
const RUECK = argv.includes("--rueckwaerts");
const DATEI = opt("--datei", RUECK ? "seiten-rueckwaerts.json" : "seiten.json");

const txt = (r) => r?.content?.map((c) => (c.type === "text" ? c.text : "")).join("") ?? "";
const obj = (r) => { try { return JSON.parse(txt(r)); } catch { return null; } };

const client = new Client({ name: "kartieren", version: "1.0.0" });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [SERVER], env: { ...process.env } }));
const call = (n, a = {}) => client.callTool({ name: n, arguments: a });

// Gesundheit zuerst - sonst kartiert man Luegen.
const health = obj(await call("sse_health"));
if (health?.advice !== "gesund") {
  console.error(`Abbruch: Programm nicht gesund (${health?.advice}, Kanarienvogel ${health?.canaryMs} ms).`);
  console.error("sse_close + sse_launch, dann erneut.");
  process.exit(1);
}
console.log(`Programm gesund (Kanarienvogel ${health.canaryMs} ms), Titel: ${health.title}`);

// Offene Suche schliessen, sie ueberlagert den Arbeitsbereich.
const zu = await call("sse_click", { name: "Suche schließen" });
if (!zu.isError) console.log("Trefferliste der Suche geschlossen.");

if (VON) {
  // Navigationsbaum braucht einen ECHTEN Klick - UIA-Patterns melden dort
  // Erfolg, ohne zu navigieren.
  const r = await call("sse_click_point", { name: VON, type: "TreeItem" });
  const nun = await (async () => (obj(await call("sse_read_page")) ?? {}).heading)();
  console.log(`Startdialog '${VON}': ${r.isError ? "FEHLER " + txt(r).slice(0, 100) : `angesprungen -> '${nun}'`}`);
}

const seiten = [];
const gesehen = new Map();     // Ueberschrift -> wie oft
let wiederholt = 0;

for (let i = 1; i <= MAX; i++) {
  const page = obj(await call("sse_read_page"));
  if (!page) { console.error(`Seite ${i}: unlesbar, Abbruch.`); break; }
  const head = page.heading || `(ohne Ueberschrift ${i})`;

  const n = (gesehen.get(head) ?? 0) + 1;
  gesehen.set(head, n);

  const tabelle = obj(await call("sse_read_table"));
  const eintrag = {
    nr: i,
    ueberschrift: head,
    zeilen: page.lines ?? [],
    tabelle: tabelle?.rowCount ? { kopf: tabelle.headers, zeilen: tabelle.rows } : null,
  };
  seiten.push(eintrag);

  const tabInfo = eintrag.tabelle ? ` [Tabelle: ${tabelle.rowCount} Zeilen]` : "";
  console.log(`${String(i).padStart(3)}. ${head}${tabInfo}  (${eintrag.zeilen.length} Zeilen)`);

  // Abbruch, wenn dieselbe Ueberschrift dreimal in Folge kommt
  if (n > 1) {
    wiederholt++;
    if (wiederholt >= 3) { console.log("   -> Ueberschriften wiederholen sich, Ende."); break; }
  } else {
    wiederholt = 0;
  }

  // Nicht jede Seite hat "Weiter": die Startseite fuehrt ueber
  // "Jetzt beginnen" hinein, Abschlussseiten ueber andere Schalter.
  const knoepfe = RUECK ? ["Zurück"] : ["Weiter", "Jetzt beginnen"];
  let vor = null;
  for (const knopf of knoepfe) {
    const r = await call("sse_click", { name: knopf, waitMs: 1100 });
    if (!r.isError) { vor = knopf; break; }
  }
  if (!vor) { console.log("   -> kein Blaetterschalter gefunden, Ende."); break; }
  if (vor !== "Weiter" && vor !== "Zurück") console.log(`   (weiter ueber '${vor}')`);

  if (i % 15 === 0) {
    const h = obj(await call("sse_health"));
    if (h?.advice !== "gesund") {
      console.error(`   -> Programm wurde traege (${h?.canaryMs} ms) nach ${i} Seiten. Abbruch, Teilergebnis wird gespeichert.`);
      break;
    }
  }
}

const ziel = join(TEMP, DATEI);
writeFileSync(
  ziel,
  JSON.stringify({ erstellt: new Date().toISOString(), richtung: RUECK ? "rueckwaerts" : "vorwaerts", anzahl: seiten.length, seiten }, null, 2),
  "utf8",
);
console.log(`\n${seiten.length} Seiten -> ${ziel}`);
console.log(`Verschiedene Ueberschriften: ${gesehen.size}`);

await client.close();
