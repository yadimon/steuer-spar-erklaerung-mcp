/**
 * Zustandsreise: schreiben, wegnavigieren, wiederkommen, nachlesen.
 *
 * Alle bisherigen Livetests pruefen **eine Operation gegen ihre eigene
 * Antwort**. Keiner prueft, ob ein spaeter gelesener Zustand noch zu dem passt,
 * was vorher geschrieben wurde - ueber Seitenwechsel, Suche und Pruefer hinweg.
 * Genau dort faellt auf, wenn Lesen oder Schreiben auseinanderlaufen.
 *
 * Diese Reise fuehrt ein Erwartungsmodell mit und vergleicht es nach **jeder**
 * Mutation und nach **jedem** Ortswechsel gegen einen frischen Readback. Ein
 * Ortswechsel ohne Mutation darf nichts aendern; tut er es doch, ist die
 * Bindung kaputt.
 *
 * Zwei unabhaengige Lesewege werden gegeneinander gehalten: die strukturierte
 * Tabellensicht (`sse_table_read`) und sichtbare Inventur (`sse_read_table`)
 * mit geometrischer Suche (`sse_find`). Nur sichtbare Betraege muessen in der
 * Suche vorkommen; Offscreen-Zeilen prueft das vollstaendige Tabellenmodell.
 *
 * Es wird **nie gespeichert**: der Aufrufer darf die Wegwerfkopie danach
 * byteidentisch erwarten.
 *
 * Voraussetzung: SSE_STATE_FIXTURE=<positionierte Wegwerfkopie im Fallbereich>
 */
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadProductProfile } from "../dist/product-profiles.js";
import { fixtureCaseRef } from "./fixture-case-ref.mjs";
import { profiledTablePage } from "./profiled-table-page.mjs";
import { formatCents, parseCents } from "./currency-cents.mjs";
import { assertStateMutation, assertStateRowsUnchanged, stateJourneyDestination,
  stateJourneyInventory, stateJourneyVisibility } from "./state-journey-contract.mjs";

const profileId = process.env.SSE_PROFILE_ID ?? "2025";
const { heading, amountColumn, sumLabel, sumOccurrence } = profiledTablePage(profileId);

const fixture = process.env.SSE_STATE_FIXTURE;
assert(fixture, "SSE_STATE_FIXTURE mit einer positionierten Wegwerfkopie ist Pflicht.");
const caseRef = fixtureCaseRef(fixture);

/** Zweite Seite fuer den Ortswechsel - aus dem Profil, nicht festgeschrieben. */
const profile = loadProductProfile(profileId);
const katalog = JSON.parse(readFileSync(profile.pageObjectsPath, "utf8"));
const zielseite = stateJourneyDestination(katalog, fixture, heading);
const andereSeite = zielseite.heading;

const here = dirname(fileURLToPath(import.meta.url));
const client = new Client({ name: "sse-live-state-journey", version: "1.0.0" });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(here, "..", "dist", "index.js")],
  env: { ...process.env },
});
const fullText = (result) => (result?.content ?? [])
  .filter((part) => part.type === "text").map((part) => part.text).join("\n");

const CLIENT_ZUSCHLAG_MS = 90_000;
const protokoll = [];
async function call(name, args, budgetMs = 240_000) {
  const t0 = Date.now();
  try {
    const result = await client.callTool({ name, arguments: args }, undefined, {
      timeout: budgetMs + CLIENT_ZUSCHLAG_MS, maxTotalTimeout: budgetMs + CLIENT_ZUSCHLAG_MS,
    });
    protokoll.push(`${name} ${Date.now() - t0}ms`);
    const daten = JSON.parse(fullText(result));
    assert.notEqual(result?.isError, true, `${name}: ${JSON.stringify(daten)}`);
    return daten;
  } catch (fehler) {
    protokoll.push(`${name} ${Date.now() - t0}ms ABBRUCH`);
    process.stdout.write(`Schritte bis zum Abbruch: ${protokoll.join(" | ")}\n`);
    throw fehler;
  }
}

/** Fuenf plus eine Reservezeile, jede mit einem eigenen unverwechselbaren Betrag. */
const MARKER = ["11,11", "22,22", "33,33", "44,44", "55,55", "66,66"];
const GEAENDERT = "77,77";
const ALLE_MARKER = [...MARKER, GEAENDERT];
const zeilenname = (betrag) => `Synthetic state row ${MARKER.indexOf(betrag) + 1}`;

await client.connect(transport);
let hwnd = 0;
let ownedInstance = null;
let primaryError = null;
try {
  const gestartet = await call("sse_launch", { caseRef, mode: "einur" });
  const pid = gestartet.instance?.pid ?? gestartet.pid;
  assert(Number.isInteger(pid) && pid > 0, "Start lieferte keine bindbare Prozessidentitaet.");
  ownedInstance = { pid };
  hwnd = gestartet.instance?.hwnd ?? 0;
  assert(Number.isInteger(hwnd) && hwnd > 0, `Start lieferte kein Hauptfenster: ${JSON.stringify(gestartet)}`);
  ownedInstance.hwnd = hwnd;

  const seite = await call("sse_page", { hwnd });
  assert.equal(seite.ueberschrift, heading,
    "Die Wegwerfkopie steht nicht auf der profilierten Tabellenseite; sie muss vorher positioniert werden.");

  let erwartetesInventar;
  /** Liest die Tabelle und haelt sie gegen das vollstaendige Modell. */
  async function pruefeModell(schritt, erwarteteMarker, erwarteteSumme) {
    const gelesen = await call("sse_table_read", { sumLabel, sumOccurrence, hwnd });
    const zellen = gelesen.zeilen.flat().map((zelle) => String(zelle ?? ""));
    const gefunden = ALLE_MARKER.filter((betrag) => zellen.includes(betrag));
    // Summe und Zeilenzahl gehoeren in dieselbe Meldung: stimmt die Summe und
    // fehlen trotzdem Zeilen, ist der Leseweg unvollstaendig und nicht der
    // Datenbestand kaputt. Getrennte Zusicherungen verschweigen genau das.
    const befund = `${schritt}: Marker ${JSON.stringify(gefunden)} statt ${JSON.stringify(erwarteteMarker)}, ` +
      `Summe '${gelesen.summe}' erwartet '${erwarteteSumme}', ${gelesen.zeilen.length} Zeilen, ` +
      `vollstaendig=${gelesen.vollstaendig} stopKind=${gelesen.stopKind} schritte=${gelesen.schritte}
` +
      `hinweis: ${gelesen.hinweis}
Zeilen: ${JSON.stringify(gelesen.zeilen)}`;
    // Zuerst die Vollstaendigkeit: eine Teilansicht darf nie als Zustand
    // durchgehen. Sonst prueft die Reise gegen das, was gerade sichtbar war.
    assert.equal(gelesen.vollstaendig, true, befund);
    assert.deepEqual(gefunden, erwarteteMarker, befund);
    assert.equal(gelesen.summe, erwarteteSumme, befund);
    assertStateRowsUnchanged(erwartetesInventar, stateJourneyInventory(gelesen, schritt), schritt);

    // Die geometrischen Wege versprechen nur den aktuellen Viewport. Ein
    // Marker ausserhalb davon bleibt im vollstaendigen Modell verpflichtend.
    const sichtbar = await call("sse_read_table", { hwnd });
    const sichtbarkeit = stateJourneyVisibility(gelesen, sichtbar,
      erwarteteMarker, amountColumn, schritt);
    for (const betrag of sichtbarkeit.visible) {
      const treffer = await call("sse_find", { name: betrag, hwnd });
      assert.equal(treffer.incomplete, false, `${schritt}: sse_find war abgeschnitten.`);
      assert(Array.isArray(treffer.hits) && treffer.hits.length > 0,
        `${schritt}: sse_find sieht den sichtbar inventarisierten Betrag '${betrag}' nicht.`);
    }
    protokoll.push(`${schritt}: ${sichtbarkeit.visible.length} sichtbare, ` +
      `${sichtbarkeit.offscreen.length} nur im vollstaendigen Modell gepruefte Marker`);
    return gelesen;
  }

  const start = await call("sse_table_read", { sumLabel, sumOccurrence, hwnd });
  erwartetesInventar = stateJourneyInventory(start, "Ausgangszustand");
  const startSumme = start.summe;
  let cents = parseCents(startSumme);
  const vorhandene = start.zeilen.flat().map((zelle) => String(zelle ?? ""));
  for (const betrag of ALLE_MARKER) {
    assert(!vorhandene.includes(betrag),
      `Markerbetrag ${betrag} existiert bereits; die Zeilenbindung waere mehrdeutig.`);
  }
  for (const betrag of MARKER) assert(!vorhandene.includes(zeilenname(betrag)),
    `Die synthetische Zeilenbezeichnung '${zeilenname(betrag)}' existiert bereits.`);
  const spalten = start.kopf;
  assert(spalten.includes(amountColumn), `Betragsspalte '${amountColumn}' fehlt im Kopf.`);
  assert(spalten.includes("Bezeichnung"), "Die Tabelle braucht eindeutige synthetische Zeilenbezeichnungen.");

  async function mutationsReadback(mutation, schritt) {
    const gelesen = await call("sse_table_read", { sumLabel, sumOccurrence, hwnd });
    const inventar = stateJourneyInventory(gelesen, schritt);
    assertStateMutation(erwartetesInventar, inventar, mutation, amountColumn, schritt);
    assert.equal(gelesen.summe, formatCents(cents), `${schritt}: falsche Nachher-Summe.`);
    erwartetesInventar = inventar;
  }

  async function zeileAnlegen(betrag, schritt) {
    const vorher = formatCents(cents);
    cents += parseCents(betrag);
    const nachher = formatCents(cents);
    const angelegt = await call("sse_table_add", {
      expectedPage: heading,
      werte: spalten.map((spalte) => spalte === amountColumn ? betrag :
        spalte === "Bezeichnung" ? zeilenname(betrag) : ""),
      sumLabel, sumOccurrence, expectedBefore: vorher, expectedAfter: nachher, hwnd,
    }, 300_000);
    assert.equal(angelegt.verified, true, `${schritt}: nicht verifiziert: ${JSON.stringify(angelegt)}`);
    assert.equal(angelegt.sumAfter, nachher, `${schritt}: falsche Summe: ${JSON.stringify(angelegt)}`);
    await mutationsReadback({ kind: "append", value: betrag, label: zeilenname(betrag) }, schritt);
  }

  async function zeileLoeschen(betrag, schritt) {
    const gelesen = await call("sse_table_read", { sumLabel, sumOccurrence, hwnd });
    const spaltenIndex = gelesen.kopf.indexOf(amountColumn);
    assertStateRowsUnchanged(erwartetesInventar, stateJourneyInventory(gelesen, schritt), schritt);
    const zeilen = gelesen.zeilen.filter(zeile => zeile[spaltenIndex] === betrag);
    assert.equal(zeilen.length, 1, `${schritt}: Betrag bindet keine eindeutige Modellzeile.`);
    const zieltext = zeilen[0][gelesen.kopf.indexOf("Bezeichnung")];
    assert.equal(zieltext, zeilenname(betrag), `${schritt}: falsche synthetische Zeilenidentitaet.`);

    const vorher = formatCents(cents);
    cents -= parseCents(betrag);
    const nachher = formatCents(cents);
    const geloescht = await call("sse_table_delete", {
      expectedPage: heading, text: zieltext,
      sumLabel, sumOccurrence, expectedBefore: vorher, expectedAfter: nachher, hwnd,
    }, 300_000);
    assert.equal(geloescht.verified, true, `${schritt}: nicht verifiziert: ${JSON.stringify(geloescht)}`);
    // geloescht ist ein Wahrheitswert, target der Zeilentext. Der Worker hat
    // die beiden Felder vertauscht, und weil kein Livetest je geloescht hat,
    // fiel es nicht auf - die API wies jedes Loeschen als vertragswidrig ab.
    assert.equal(geloescht.geloescht, true, `${schritt}: geloescht ist kein true: ${JSON.stringify(geloescht.geloescht)}`);
    assert.equal(geloescht.target, zieltext, `${schritt}: target nennt nicht die geloeschte Zeile.`);
    assert.equal(geloescht.nochVorhanden, false, `${schritt}: die Zeile gilt weiterhin als vorhanden.`);
    await mutationsReadback({ kind: "delete", before: betrag }, schritt);
  }

  /** Aendert den Betrag einer vorhandenen Zeile und fuehrt das Modell nach. */
  async function zeileAendern(vonBetrag, nachBetrag, schritt) {
    const gelesen = await call("sse_table_read", { sumLabel, sumOccurrence, hwnd });
    const spaltenIndex = gelesen.kopf.indexOf(amountColumn);
    assertStateRowsUnchanged(erwartetesInventar, stateJourneyInventory(gelesen, schritt), schritt);
    const zeilen = gelesen.zeilen.filter(zeile => zeile[spaltenIndex] === vonBetrag);
    assert.equal(zeilen.length, 1, `${schritt}: Betrag bindet keine eindeutige Modellzeile.`);
    const zieltext = zeilen[0][gelesen.kopf.indexOf("Bezeichnung")];
    assert.match(zieltext, /^Synthetic state row [1-6]$/u, `${schritt}: keine synthetische Zeilenidentitaet.`);

    const vorher = formatCents(cents);
    cents += parseCents(nachBetrag) - parseCents(vonBetrag);
    const nachher = formatCents(cents);
    const geaendert = await call("sse_table_update", {
      expectedPage: heading, text: zieltext,
      werte: gelesen.kopf.map((spalte) => (spalte === amountColumn ? nachBetrag : null)),
      sumLabel, sumOccurrence, expectedBefore: vorher, expectedAfter: nachher, hwnd,
    }, 300_000);
    assert.equal(geaendert.verified, true, `${schritt}: nicht verifiziert: ${JSON.stringify(geaendert)}`);
    await mutationsReadback({ kind: "update", before: vonBetrag, value: nachBetrag }, schritt);
  }

  /** Wechselt die Seite und kommt zurueck. Danach muss alles unveraendert sein. */
  async function ortswechsel(schritt) {
    const hin = await call("sse_goto", { pageId: zielseite.pageId, hwnd }, 300_000);
    assert.equal(hin.ueberschrift ?? hin.heading, andereSeite,
      `${schritt}: '${andereSeite}' wurde nicht erreicht: ${JSON.stringify(hin)}`);
    const fremd = await call("sse_page", { hwnd });
    assert.equal(fremd.ueberschrift, andereSeite, `${schritt}: falsche Seite nach dem Wechsel.`);
    const zurueck = await call("sse_goto", { name: heading, hwnd }, 300_000);
    assert(zurueck, `${schritt}: Rueckweg lieferte kein Ergebnis.`);
    const daheim = await call("sse_page", { hwnd });
    assert.equal(daheim.ueberschrift, heading, `${schritt}: Rueckweg landete nicht auf der Tabellenseite.`);
  }

  // ---- fuenf Zeilen anlegen, dann wegnavigieren und nachsehen
  for (const [index, betrag] of MARKER.slice(0, 5).entries()) {
    await zeileAnlegen(betrag, `Anlegen ${index + 1}`);
  }
  await pruefeModell("nach fuenf Zeilen", MARKER.slice(0, 5), formatCents(cents));

  await ortswechsel("Ortswechsel nach fuenf Zeilen");
  await pruefeModell("nach dem Ortswechsel", MARKER.slice(0, 5), formatCents(cents));

  // ---- sechste Zeile, dann Pruefer und Suche als Stoerung dazwischen
  await zeileAnlegen(MARKER[5], "Anlegen 6");
  await pruefeModell("nach sechs Zeilen", MARKER, formatCents(cents));

  // Fensterwechsel als Stoerung: die Werte-Info legt sich ueber die Seite und
  // wird selbst gelesen. Danach muss die Tabelle unveraendert lesbar bleiben.
  const ergebnis = await call("sse_result_details", { openIfNeeded: true, hwnd }, 300_000);
  assert.equal(ergebnis.vollstaendig, true,
    `Die Werte-Info war nicht vollstaendig lesbar: ${JSON.stringify(ergebnis).slice(0, 400)}`);
  assert(Array.isArray(ergebnis.zeilen) && ergebnis.zeilen.length > 0, "Die Werte-Info lieferte keine Zeile.");
  await pruefeModell("nach dem Blick in die Werte-Info", MARKER, formatCents(cents));

  const hilfe = await call("sse_help", { hwnd });
  assert(hilfe, "Die Hilfespalte lieferte kein Ergebnis.");
  await pruefeModell("nach dem Lesen der Hilfespalte", MARKER, formatCents(cents));

  // ---- eine vorhandene Zeile aendern, danach wieder von aussen nachlesen
  await zeileAendern(MARKER[2], GEAENDERT, "Aendern der dritten Zeile");
  await pruefeModell("nach dem Aendern", [MARKER[0], MARKER[1], MARKER[3], MARKER[4], MARKER[5], GEAENDERT], formatCents(cents));
  await ortswechsel("Ortswechsel nach dem Aendern");
  await pruefeModell("nach dem Ortswechsel", [MARKER[0], MARKER[1], MARKER[3], MARKER[4], MARKER[5], GEAENDERT], formatCents(cents));
  await zeileAendern(GEAENDERT, MARKER[2], "Aenderung zuruecknehmen");
  await pruefeModell("nach der Ruecknahme", MARKER, formatCents(cents));

  // ---- eine loeschen, wieder wegnavigieren
  await zeileLoeschen(MARKER[5], "Loeschen 6");
  await pruefeModell("nach dem Loeschen", MARKER.slice(0, 5), formatCents(cents));

  await ortswechsel("Ortswechsel nach dem Loeschen");
  await pruefeModell("nach dem zweiten Ortswechsel", MARKER.slice(0, 5), formatCents(cents));

  // ---- Rueckbau auf den Ausgangszustand
  for (const betrag of [...MARKER.slice(0, 5)].reverse()) {
    await zeileLoeschen(betrag, `Rueckbau ${betrag}`);
  }
  const ende = await call("sse_table_read", { sumLabel, sumOccurrence, hwnd });
  assertStateRowsUnchanged(stateJourneyInventory(start, "Ausgangszustand"),
    stateJourneyInventory(ende, "Rueckbau"), "Rueckbau");
  assert.equal(ende.summe, startSumme,
    `Der Rueckbau fuehrte nicht auf die Ausgangssumme: '${ende.summe}' statt '${startSumme}'.`);
  assert.equal(formatCents(cents), startSumme, "Das Modell und die Ausgangssumme laufen auseinander.");

  const zustand = await call("sse_ui_state", { hwnd });
  assert.equal(zustand.ungespeichert, true,
    "Nach vierzehn Mutationen meldet die Anwendung keinen ungespeicherten Stand.");
  assert.deepEqual(zustand.dialoge ?? [], [], "Am Ende der Reise steht ein Dialog offen.");

  const geschlossen = await call("sse_close", { ...ownedInstance, discardChanges: true }, 300_000);
  assert.equal(geschlossen.stillRunning, false, "Nach dem Schliessen laeuft das Programm noch.");
  ownedInstance = null;

  process.stdout.write(`Schritte: ${protokoll.join(" | ")}\n`);
  process.stdout.write(
    `Zustandsreise (${profileId}): 6 Zeilen angelegt, 6 geloescht, drei Ortswechsel nach ` +
    `'${andereSeite}', Werte-Info, Hilfespalte und eine Betragsaenderung dazwischen, vollstaendige Werte und sichtbare Suche ` +
    `in jedem Schritt geprueft, Summe zurueck auf ${startSumme}, nichts gespeichert.\n`,
  );
} catch (error) {
  primaryError = error;
  throw error;
} finally {
  const cleanupErrors = [];
  if (ownedInstance) {
    try {
      const cleanup = { ...ownedInstance, discardChanges: true };
      if (!ownedInstance.hwnd) cleanup.force = true;
      const closed = await call("sse_close", cleanup, 120_000);
      assert.equal(closed.stillRunning, false, "Die eigene SSE-Instanz blieb nach dem Abbruch offen.");
    } catch (error) { cleanupErrors.push(error); }
  }
  try { await client.close(); } catch (error) { cleanupErrors.push(error); }
  if (cleanupErrors.length) {
    const message = cleanupErrors.map(error => error.message).join(" ");
    if (primaryError instanceof Error) primaryError.message += ` Cleanup: ${message}`;
    else throw new AggregateError(cleanupErrors, "Zustandsreise konnte nicht vollstaendig aufraeumen.");
  }
}
