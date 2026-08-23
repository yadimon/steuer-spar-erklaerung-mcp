/**
 * Kalter Lese-/Aenderungs-/Lese-Zyklus auf einem gewoehnlichen Steuerfeld.
 *
 * Diese Reise deckt genau die Luecke ab, durch die in beta.21 gleich mehrere
 * Fehler in die Veroeffentlichung kamen:
 *
 *   - `sse_change_field` (`tracked_set_value`) - der einzige erlaubte Weg,
 *     ein Steuerfeld zu aendern - kam in keinem einzigen Livetest vor. Die
 *     grosse Schreibreise deckt Tabellen, UStVA und Dateiwege ab, aber nie
 *     ein schlichtes beschriftetes Feld.
 *   - `sse_collect` lief live ausschliesslich mit `resultRef`. Dann liegen die
 *     Seiten in einer Datei und das Antwortfeld ist leer - genau der Zweig, in
 *     dem der Vertragsbruch bei einer einzigen Seite nicht auftreten konnte.
 *   - Alles lief auf einer vorpositionierten Kopie in einer laengst warmen
 *     Anwendung. Die Werte-Info zum ersten Mal auf einer kalten Instanz zu
 *     oeffnen war nie Teil eines Tests, und genau dort brach der Schreibweg.
 *
 * Deshalb: frisch starten, sofort lesen, aendern, erneut lesen, zurueckdrehen,
 * erneut lesen. Es wird nichts gespeichert; der Aufrufer darf die Kopie danach
 * byteidentisch erwarten.
 *
 * Voraussetzung: SSE_COLD_FIXTURE=<Wegwerfkopie im Fallbereich der Test-API>
 */
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadProductProfile } from "../dist/product-profiles.js";
import { fixtureCaseRef } from "./fixture-case-ref.mjs";

const profileId = process.env.SSE_PROFILE_ID ?? "2025";
const profile = loadProductProfile(profileId);
const expectations = JSON.parse(
  readFileSync(join(profile.profileDir, "tests", "expectations.json"), "utf8"),
);
const definition = expectations.cases.find((entry) => entry.coldFieldCycle);
assert(definition,
  `Profil '${profileId}' nennt keinen Musterfall mit coldFieldCycle; ein stiller SKIP ist ausgeschlossen.`);
const cycle = definition.coldFieldCycle;
for (const key of ["headingAtLaunch", "field", "valueKind"]) {
  assert(cycle[key], `coldFieldCycle.${key} fehlt im Profil '${profileId}'.`);
}
assert.equal(cycle.valueKind, "date",
  "Der kalte Feldzyklus rechnet den Ersatzwert aus einem Datum; ein anderer Typ braucht eigene Arithmetik.");

const fixture = process.env.SSE_COLD_FIXTURE;
assert(fixture, "SSE_COLD_FIXTURE mit einer frischen Wegwerfkopie ist Pflicht.");
const caseRef = fixtureCaseRef(fixture);

const here = dirname(fileURLToPath(import.meta.url));
const client = new Client({ name: "sse-live-cold-field-cycle", version: "1.0.0" });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(here, "..", "dist", "index.js")],
  env: { ...process.env },
});
const fullText = (result) => result?.content?.filter((part) => part.type === "text")
  .map((part) => part.text).join("\n") ?? "";
// Der Client muss laenger warten als das Werkzeug selbst rechnen darf, sonst
// verliert er das Rennen gegen einen launch, der sein Budget ausschoepft.
const CLIENT_ZUSCHLAG_MS = 90_000;
const schrittProtokoll = [];
const callRaw = async (name, args, budgetMs = 240_000) => {
  const t0 = Date.now();
  try {
    const result = await client.callTool(
      { name, arguments: args },
      undefined,
      { timeout: budgetMs + CLIENT_ZUSCHLAG_MS, maxTotalTimeout: budgetMs + CLIENT_ZUSCHLAG_MS },
    );
    schrittProtokoll.push(`${name} ${Date.now() - t0} ms`);
    return { istFehler: result?.isError === true, daten: JSON.parse(fullText(result)) };
  } catch (fehler) {
    // Ohne diese Zeile sagt ein Timeout nicht, welcher Schritt haengen blieb.
    schrittProtokoll.push(`${name} ${Date.now() - t0} ms ABBRUCH`);
    process.stdout.write(`Schritte bis zum Abbruch: ${schrittProtokoll.join(' | ')}
`);
    throw fehler;
  }
};
const call = async (name, args, budgetMs) => {
  const { istFehler, daten } = await callRaw(name, args, budgetMs);
  assert.equal(istFehler, false, `${name}: ${JSON.stringify(daten)}`);
  return daten;
};

/** Aus einem deutschen Datum ein garantiert anderes, gueltiges Datum machen. */
function anderesDatum(wert) {
  const treffer = /^(\d{2})\.(\d{2})\.(\d{4})$/u.exec(String(wert));
  assert(treffer, `Feld '${cycle.field}' liefert kein Datum TT.MM.JJJJ: ${JSON.stringify(wert)}`);
  const [, tag, monat, jahr] = treffer;
  return `${tag}.${monat}.${String(Number(jahr) + 1).padStart(4, "0")}`;
}

await client.connect(transport);
let hwnd = 0;
try {
  const launched = await call("sse_launch", { caseRef, mode: definition.mode });
  hwnd = launched.instance?.hwnd ?? 0;
  assert(Number.isInteger(hwnd) && hwnd > 0, `Start lieferte kein Hauptfenster: ${JSON.stringify(launched)}`);
  assert.equal(launched.ready, true, "Start meldete das Fenster nicht als bedienbar.");

  const seite = await call("sse_page", { hwnd });
  assert.equal(seite.ueberschrift, cycle.headingAtLaunch,
    "Die Startseite der Wegwerfkopie ist nicht die profilierte Seite des kalten Zyklus.");

  // collect OHNE resultRef: die Seiten muessen in der Antwort stehen, und zwar
  // als Liste. Genau ein erfasstes Segment darf kein Objekt daraus machen.
  // MCP projiziert die kompakte Form ohne den Transportwert `ok`; ein
  // Fehlschlag kommt bereits als isError durch `call`.
  const gesammelt = await call("sse_collect", { maxPages: 5, hwnd }, 300_000);
  assert.equal(gesammelt.vollstaendig, true,
    `collect ohne resultRef blieb unvollstaendig: ${JSON.stringify(gesammelt)}`);
  assert(Array.isArray(gesammelt.seiten),
    `collect ohne resultRef muss die Seiten als Liste liefern, lieferte ${typeof gesammelt.seiten}.`);
  assert.equal(gesammelt.seiten.length, gesammelt.anzahl,
    "collect meldet eine andere Seitenzahl als es Seiten liefert.");
  assert(gesammelt.anzahl >= 1, "collect erfasste keine einzige Seite.");

  // Werte-Info zum ersten Mal auf einer kalten Instanz oeffnen und lesen.
  const ergebnis = await call("sse_result_details", { openIfNeeded: true, hwnd });
  assert.equal(ergebnis.vollstaendig, true,
    `Die Werte-Info war auf der kalten Instanz nicht vollstaendig lesbar: ${JSON.stringify(ergebnis)}`);
  assert(Array.isArray(ergebnis.zeilen) && ergebnis.zeilen.length > 0,
    "Die Werte-Info lieferte auf der kalten Instanz keine einzige Zeile.");

  const gelesen = async (schritt) => {
    const wert = await call("sse_get_value", { name: cycle.field, hwnd });
    assert.equal(wert.ok, true, `${schritt}: get_value scheiterte.`);
    assert(typeof wert.value === "string" && wert.value,
      `${schritt}: get_value lieferte fuer '${cycle.field}' keinen Wert; aufgeloest ueber '${wert.aufgeloestUeber}'.`);
    return wert.value;
  };

  const vorher = await gelesen("erstes Lesen");
  const ersatz = anderesDatum(vorher);

  const schreiben = async (schritt, von, nach) => {
    const geschrieben = await call("sse_change_field", {
      expectedPage: cycle.headingAtLaunch,
      name: cycle.field,
      expectedBefore: von,
      value: nach,
      expectedAfter: nach,
      valueKind: cycle.valueKind,
      hwnd,
    });
    assert.equal(geschrieben.ok, true, `${schritt}: ${JSON.stringify(geschrieben)}`);
    assert.equal(geschrieben.verified, true, `${schritt}: die Aenderung wurde nicht verifiziert.`);
    assert.equal(geschrieben.ergebnisVerfolgt, true, `${schritt}: der Ergebnisvergleich fand nicht statt.`);
    assert.equal(geschrieben.feld?.nachher, nach, `${schritt}: Readback meldet '${geschrieben.feld?.nachher}'.`);
    return geschrieben;
  };

  await schreiben("Aendern", vorher, ersatz);
  assert.equal(await gelesen("zweites Lesen"), ersatz,
    "Nach der Aenderung liest get_value nicht den neuen Wert.");

  // Ein falscher Vorwert muss die Aenderung verhindern, nicht bloss melden.
  const { istFehler: abgelehnt, daten: abgewiesen } = await callRaw("sse_change_field", {
    expectedPage: cycle.headingAtLaunch,
    name: cycle.field,
    expectedBefore: vorher,
    value: ersatz,
    expectedAfter: ersatz,
    valueKind: cycle.valueKind,
    hwnd,
  });
  assert.equal(abgelehnt, true, "Ein falscher erwarteter Vorwert wurde nicht abgewiesen.");
  assert.equal(abgewiesen.ok, false, "Die Ablehnung kam nicht als Fehlerergebnis zurueck.");
  assert.equal(abgewiesen.kind, "precondition-failed", `Unerwartete Ablehnungsart: ${abgewiesen.kind}`);
  assert.equal(await gelesen("Lesen nach Ablehnung"), ersatz,
    "Die abgewiesene Aenderung hat den Wert trotzdem angefasst.");

  await schreiben("Zuruecksetzen", ersatz, vorher);
  assert.equal(await gelesen("drittes Lesen"), vorher,
    "Nach dem Zuruecksetzen liest get_value nicht wieder den Ausgangswert.");

  const zustand = await call("sse_ui_state", { hwnd });
  assert.equal(zustand.running, true, "Die Instanz laeuft nach dem Zyklus nicht mehr.");
  assert.deepEqual(zustand.dialoge ?? [], [], "Nach dem Zyklus steht ein Dialog offen.");

  const geschlossen = await call("sse_close", { discardChanges: true, hwnd });
  assert.equal(geschlossen.ok, true, `Schliessen scheiterte: ${JSON.stringify(geschlossen)}`);
  assert.equal(geschlossen.stillRunning, false, "Nach dem Schliessen laeuft das Programm noch.");
  assert.equal(geschlossen.killed, false, "Das Programm musste hart beendet werden.");

  process.stdout.write(`Schritte: ${schrittProtokoll.join(' | ')}
`);
  process.stdout.write(
    `Kalter Feldzyklus (${profileId}): '${cycle.field}' ${vorher} -> ${ersatz} -> ${vorher}, ` +
    `collect inline mit ${gesammelt.anzahl} Seite(n), Werte-Info kalt mit ${ergebnis.zeilen.length} Zeilen, ` +
    "falscher Vorwert abgewiesen, nichts gespeichert.\n",
  );
} finally {
  await client.close().catch(() => {});
}
