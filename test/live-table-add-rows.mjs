/**
 * Mehrzeilenanlage am echten Programm: anlegen, nachlesen, zuruecknehmen,
 * speichern, neu oeffnen.
 *
 * Die Reise legt mehr Zeilen an, als die Tabelle anzeigt. Genau dort trennt
 * sich die Bindung ueber Modellkoordinaten von der ueber sichtbare Geometrie:
 * Die Zeilen jenseits des angezeigten Ausschnitts muessen ohne Scrollen und
 * ohne Cursorlauf entstehen. Jede Aussage der Operation wird gegen einen
 * unabhaengigen Leseweg gehalten - das vollstaendige Grid-Inventar von
 * `sse_table_read` - und am Ende gegen die gespeicherte und neu geoeffnete
 * Datei.
 *
 * Voraussetzung: SSE_ROWS_FIXTURE=<positionierte Wegwerfkopie im Fallbereich>
 */
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fixtureCaseRef } from "./fixture-case-ref.mjs";
import { profiledTablePage } from "./profiled-table-page.mjs";
import { formatCents, parseCents } from "./currency-cents.mjs";

const profileId = process.env.SSE_PROFILE_ID ?? "2025";
const { heading, amountColumn, sumLabel, sumOccurrence } = profiledTablePage(profileId);
const fixture = process.env.SSE_ROWS_FIXTURE;
assert(fixture, "SSE_ROWS_FIXTURE mit einer positionierten Wegwerfkopie ist Pflicht.");
const caseRef = fixtureCaseRef(fixture);
const sha256 = () => createHash("sha256").update(readFileSync(fixture)).digest("hex").toUpperCase();

const here = dirname(fileURLToPath(import.meta.url));
const client = new Client({ name: "sse-live-table-add-rows", version: "1.0.0" });
const transport = new StdioClientTransport({
  command: process.execPath, args: [join(here, "..", "dist", "index.js")], env: { ...process.env },
});
const fullText = (result) => (result?.content ?? [])
  .filter((part) => part.type === "text").map((part) => part.text).join("\n");
const CLIENT_ZUSCHLAG_MS = 90_000;
async function invoke(name, args, budgetMs) {
  const result = await client.callTool({ name, arguments: args }, undefined, {
    timeout: budgetMs + CLIENT_ZUSCHLAG_MS, maxTotalTimeout: budgetMs + CLIENT_ZUSCHLAG_MS,
  });
  return { daten: JSON.parse(fullText(result)), fehler: result?.isError === true };
}
async function call(name, args, budgetMs = 240_000) {
  const { daten, fehler } = await invoke(name, args, budgetMs);
  assert.equal(fehler, false, `${name}: ${JSON.stringify(daten)}`);
  return daten;
}
async function refused(name, args, budgetMs = 240_000) {
  const { daten, fehler } = await invoke(name, args, budgetMs);
  assert.equal(fehler, true, `${name} wurde unerwartet angenommen: ${JSON.stringify(daten)}`);
  return daten;
}

/** Acht Zeilen: mehr, als die Tabelle neben ihrem Bestand anzeigt. */
const BETRAEGE = ["11,11", "22,22", "33,33", "44,44", "55,55", "66,66", "77,77", "88,88"];
const zeilenname = (index) => `Synthetic appended row ${index + 1}`;

await client.connect(transport);
let offen = null;
try {
  const start = async () => {
    const gestartet = await call("sse_launch", { caseRef, mode: "einur" });
    const pid = gestartet.instance?.pid ?? gestartet.pid;
    const hwnd = gestartet.instance?.hwnd ?? 0;
    assert(Number.isInteger(pid) && pid > 0 && Number.isInteger(hwnd) && hwnd > 0,
      `Start lieferte keine bindbare Instanz: ${JSON.stringify(gestartet)}`);
    offen = { pid, hwnd };
    const seite = await call("sse_page", { hwnd });
    assert.equal(seite.ueberschrift, heading,
      "Die Wegwerfkopie steht nicht auf der profilierten Tabellenseite; sie muss vorher positioniert werden.");
    return hwnd;
  };
  const inventar = (hwnd) => call("sse_table_read", { readMode: "grid", sumLabel, sumOccurrence, hwnd });

  let hwnd = await start();
  const vorher = await inventar(hwnd);
  assert.equal(vorher.vollstaendig, true, "Das Grid-Inventar vor der Anlage ist unvollstaendig.");
  const textSpalte = vorher.kopf.indexOf("Bezeichnung");
  const betragSpalte = vorher.kopf.indexOf(amountColumn);
  assert(textSpalte >= 0 && betragSpalte >= 0, `Die Tabelle zeigt nicht beide Spalten: ${JSON.stringify(vorher.kopf)}`);
  const zeile = (text, betrag) => vorher.kopf.map((_, spalte) => spalte === textSpalte ? text : spalte === betragSpalte ? betrag : "");
  const bestand = vorher.zeilen.slice(0, -1);
  const anlegezeile = vorher.zeilen.at(-1);

  const zeilen = BETRAEGE.map((betrag, index) => ({ werte: zeile(zeilenname(index), betrag) }));
  const nachsumme = formatCents(parseCents(vorher.summe) + BETRAEGE.reduce((summe, betrag) => summe + parseCents(betrag), 0));
  const beginn = Date.now();
  const angelegt = await call("sse_table_add_rows", {
    expectedPage: heading, zeilen, sumLabel, sumOccurrence, expectedBefore: vorher.summe, expectedAfter: nachsumme, hwnd,
  });
  const dauerMs = Date.now() - beginn;
  assert.equal(angelegt.verified, true, JSON.stringify(angelegt));
  assert.equal(angelegt.resultingState, "completed-verified");
  assert.equal(angelegt.requestedCount, BETRAEGE.length);
  assert.equal(parseCents(angelegt.sumBefore), parseCents(vorher.summe));
  assert.equal(parseCents(angelegt.sumAfter), parseCents(nachsumme));
  assert.equal(angelegt.physicalInputUsed, false, "Die Mehrzeilenanlage hat physische Eingabe gemeldet.");
  assert.equal(angelegt.mutationPostProof?.outcome, "appended-exact");
  assert.equal(angelegt.mutationPostProof?.rowsBefore, vorher.anzahl);
  assert.equal(angelegt.mutationPostProof?.rowsAfter, vorher.anzahl + BETRAEGE.length);
  assert.deepEqual(angelegt.zeilen.map((eintrag) => eintrag.modelRow), BETRAEGE.map((_, index) => bestand.length + index),
    "Die Zeilen stehen nicht fortlaufend ab der frueheren Anlegezeile.");
  assert.deepEqual(angelegt.newCheckerMessages, []);

  // Unabhaengiger Leseweg: Bestand unveraendert, neue Zeilen in Reihenfolge, Anlegezeile wieder frei.
  const nachher = await inventar(hwnd);
  assert.equal(nachher.vollstaendig, true);
  assert.equal(nachher.anzahl, vorher.anzahl + BETRAEGE.length);
  assert.deepEqual(nachher.zeilen.slice(0, bestand.length), bestand, "Eine fruehere Zeile hat sich geaendert.");
  assert.deepEqual(nachher.zeilen.at(-1), anlegezeile, "Die Anlegezeile ist nicht wieder frei.");
  assert.deepEqual(
    nachher.zeilen.slice(bestand.length, -1).map((werte) => [werte[textSpalte], werte[betragSpalte]]),
    BETRAEGE.map((betrag, index) => [zeilenname(index), betrag]),
    "Die neuen Zeilen stehen nicht vollstaendig und in Auftragsreihenfolge im Modell.");
  assert.equal(parseCents(nachher.summe), parseCents(nachsumme));

  // Die Zeilen sind Daten des Falls: speichern, schliessen, neu oeffnen, nachlesen.
  const hashVorher = sha256();
  const gespeichert = await call("sse_save", { caseRef, expectedHashBefore: hashVorher, hwnd });
  assert.equal(gespeichert.verified, true, `Speichern wurde nicht bestaetigt: ${JSON.stringify(gespeichert)}`);
  assert.notEqual(sha256(), hashVorher, "Speichern hat die Datei nicht veraendert.");
  await call("sse_close", offen, 120_000);
  offen = null;
  hwnd = await start();
  const wiedergeoeffnet = await inventar(hwnd);
  assert.deepEqual(wiedergeoeffnet.zeilen, nachher.zeilen, "Die neu geoeffnete Datei zeigt nicht die angelegten Zeilen.");
  assert.equal(parseCents(wiedergeoeffnet.summe), parseCents(nachsumme));

  // Eine veraltete Vorsumme wird abgelehnt, bevor irgendetwas geschrieben ist.
  const veraltet = await refused("sse_table_add_rows", {
    expectedPage: heading, sumLabel, sumOccurrence, expectedBefore: "0,01", hwnd,
    zeilen: [{ werte: zeile("Synthetic stale row", "3,03") }],
  });
  assert.equal(veraltet.kind, "precondition-failed", JSON.stringify(veraltet));
  assert.equal(veraltet.mutationStarted, false);
  assert.equal(veraltet.resultingState, "unchanged");
  assert.deepEqual((await inventar(hwnd)).zeilen, nachher.zeilen, "Eine abgelehnte Anlage hat das Modell veraendert.");

  // Eine falsche Vorhersage setzt die eigenen Werte zurueck: Summe und fruehere
  // Zeilen stehen wie vorher. Qt gibt eine einmal entstandene Zeile dabei nicht
  // wieder frei - sie bleibt als Leerzeile stehen, und genau das meldet die
  // Operation, statt eine vollstaendige Ruecknahme zu behaupten.
  const verworfen = await refused("sse_table_add_rows", {
    expectedPage: heading, sumLabel, sumOccurrence, expectedBefore: nachher.summe, expectedAfter: "0,01", hwnd,
    zeilen: [{ werte: zeile("Synthetic rejected row 1", "1,01") }, { werte: zeile("Synthetic rejected row 2", "2,02") }],
  });
  assert.equal(verworfen.kind, "postcondition-failed", JSON.stringify(verworfen));
  assert.equal(verworfen.mutationStarted, true);
  assert.equal(verworfen.outcomeUnknown, false, JSON.stringify(verworfen));
  assert.equal(verworfen.resultingState, "values-restored", JSON.stringify(verworfen));
  assert.equal(verworfen.rollback?.werteWiederhergestellt, true, JSON.stringify(verworfen.rollback));
  assert.equal(verworfen.rollback?.strukturEntfernt, false,
    "Die strukturelle Ruecknahme gelingt jetzt - dieser dokumentierte Befund ist ueberholt.");
  assert.equal(verworfen.rollback?.verbliebeneLeerzeilen, 2, JSON.stringify(verworfen.rollback));
  assert.equal(parseCents(verworfen.rollback?.summe), parseCents(nachsumme));
  const geleert = await inventar(hwnd);
  assert.deepEqual(geleert.zeilen, [...nachher.zeilen.slice(0, -1), anlegezeile, anlegezeile, anlegezeile],
    "Nach der Wertruecknahme stehen nicht genau die frueheren Zeilen, zwei Leerzeilen und die Anlegezeile im Modell.");
  assert.equal(parseCents(geleert.summe), parseCents(nachsumme));

  process.stdout.write(
    `OK: ${BETRAEGE.length} Zeilen in einem Auftrag angelegt (${dauerMs} ms), ueber das Grid-Inventar nachgewiesen, ` +
    "gespeichert und neu geoeffnet, veraltete Vorsumme abgelehnt, falsche Vorhersage wertseitig zurueckgenommen.\n");
} finally {
  try {
    for (const instanz of offen ? [offen] : []) await call("sse_close", { ...instanz, discardChanges: true }, 120_000);
  } finally {
    await client.close();
  }
}
