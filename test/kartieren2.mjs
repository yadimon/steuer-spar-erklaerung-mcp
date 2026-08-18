/**
 * Kartiert alle Eingabeseiten durch Durchquerung des NAVIGATIONSBAUMS.
 *
 * Warum nicht einfach mit "Weiter" durchblaettern: der Blaetterpfad deckt nur
 * den Haupterfassungsfluss ab. Nebenseiten (ELSTER-Anmeldeinformation,
 * Grunddaten, Schreiben ans Finanzamt) haben gar keinen Weiter-Schalter, und
 * die Startseite "Gewinnermittlung beginnen" ist eine Sackgasse.
 *
 * Der Baum klappt beim Anklicken Unterpunkte auf. Deshalb: nach jedem Klick
 * neu aufzaehlen und noch nicht besuchte Eintraege einreihen, bis nichts
 * Neues mehr auftaucht.
 *
 * Aufruf:  node test/kartieren2.mjs [--max 200]
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
const MAX = Number((argv[argv.indexOf("--max") + 1] ?? "").match(/^\d+$/) ? argv[argv.indexOf("--max") + 1] : 200);

const txt = (r) => r?.content?.map((c) => (c.type === "text" ? c.text : "")).join("") ?? "";
const obj = (r) => { try { return JSON.parse(txt(r)); } catch { return null; } };

// Diese Eintraege NICHT anklicken: der Server sperrt sie ohnehin, und sie
// gehoeren zum Versandweg. Ihre Seiten wurden im Vorwaertslauf bereits erfasst.
const TABU = new Set([
  "Anmeldungen versenden",
  "Jahreserklärungen abschließen",
  "Belege nachreichen",
  "Kommunikation mit dem Finanzamt per ELSTER",
]);

const client = new Client({ name: "kartieren2", version: "1.0.0" });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [SERVER], env: { ...process.env } }));
const call = (n, a = {}) => client.callTool({ name: n, arguments: a });

const health = obj(await call("sse_health"));
if (health?.advice !== "gesund") {
  console.error(`Abbruch: Programm nicht gesund (${health?.advice}, ${health?.canaryMs} ms).`);
  process.exit(1);
}
console.log(`Programm gesund (${health.canaryMs} ms)\n`);

const besucht = new Map();      // Navigationsname -> Seiteneintrag
const gescheitert = [];
let runde = 0;

async function baumEintraege() {
  const s = obj(await call("sse_snapshot", { types: ["TreeItem"], namedOnly: true }));
  return (s?.nodes ?? [])
    .filter((n) => n.name && n.x >= 0 && n.w > 0)
    .sort((a, b) => a.y - b.y)
    .map((n) => n.name);
}

while (besucht.size + gescheitert.length < MAX) {
  runde++;
  const alle = await baumEintraege();
  const offen = alle.filter((n) => !besucht.has(n) && !gescheitert.includes(n) && !TABU.has(n));
  if (!offen.length) {
    console.log(`\nRunde ${runde}: nichts Neues im Baum - fertig.`);
    break;
  }
  console.log(`Runde ${runde}: ${alle.length} Eintraege sichtbar, ${offen.length} noch offen`);

  for (const name of offen) {
    if (besucht.size + gescheitert.length >= MAX) break;
    const klick = await call("sse_click_point", { name, type: "TreeItem", waitMs: 1300 });
    if (klick.isError) {
      gescheitert.push(name);
      console.log(`   ✗ ${name} — ${txt(klick).slice(0, 90)}`);
      continue;
    }
    const page = obj(await call("sse_read_page"));
    const head = page?.heading ?? "(ohne Ueberschrift)";
    const tab = obj(await call("sse_read_table"));
    besucht.set(name, {
      navName: name,
      ueberschrift: head,
      zeilen: page?.lines ?? [],
      tabelle: tab?.rowCount ? { kopf: tab.headers, zeilen: tab.rows } : null,
    });
    const tabInfo = tab?.rowCount ? ` [Tabelle ${tab.rowCount}]` : "";
    console.log(`   ✓ ${name}  ->  "${head}"${tabInfo} (${page?.lines?.length ?? 0} Zeilen)`);

    if (besucht.size % 12 === 0) {
      const h = obj(await call("sse_health"));
      if (h?.advice !== "gesund") {
        console.error(`   !! Programm traege (${h?.canaryMs} ms) nach ${besucht.size} Seiten - Abbruch.`);
        break;
      }
    }
  }
}

// Navigationsausgaben koennen Fallwerte enthalten und gehoeren nie in docs/.
const ziel = join(TEMP, "navigation.json");
writeFileSync(
  ziel,
  JSON.stringify(
    { erstellt: new Date().toISOString(), besucht: besucht.size, uebersprungen: [...TABU], gescheitert, seiten: [...besucht.values()] },
    null, 2,
  ),
  "utf8",
);
console.log(`\n${besucht.size} Seiten besucht, ${gescheitert.length} gescheitert -> ${ziel}`);
if (gescheitert.length) console.log("Gescheitert: " + gescheitert.join(", "));

await client.close();
