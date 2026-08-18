/**
 * Grosse zusammenhaengende Live-Reise ueber die Schreib- und Dateiwege.
 *
 * Genau ein Szenario, streng linear: lesen, Kontrollsumme pruefen, schreiben,
 * Kontrollsumme erneut pruefen - und fuer jede Speicheroperation der Beweis
 * auf der Platte (Hash vorher/nachher) plus der Persistenzbeweis ueber einen
 * echten Neustart der Anwendung. Alles laeuft auf einer Wegwerfkopie des
 * offiziellen Musterfalls; der Musterfall selbst bleibt byteidentisch.
 *
 * Abgedeckte Wege in einer Reise:
 *   launch/close x2        Persistenz der gespeicherten Aenderung
 *   table_add/-delete      mit Kontrollsummen-Readback aus der Anwendung
 *   save                   hashgebunden, Datei aendert sich nachweislich
 *   UStVA-Quartett         select_period/set_flag/change_value/open_section,
 *                          jeweils mit Zahllast als fachlicher Kontrollsumme
 *   combo_select           direkt am Zeitraumwaehler der UStVA-Uebersicht
 *   export_csv             kompletter Dialogweg bis zur CSV-Datei auf der Platte
 *   dialog_answer          Export ausloesen und Exportfenster schliessen
 *   file_dialog_select     nativer Ordnerdialog des Exports
 *   menu/menu_click        Datei-Menue, Exporteintrag, danach sauber schliessen
 *   windows/window_close   Werte-Info als bekanntes Nebenfenster
 *   window_restore         nach echtem Minimieren des Hauptfensters
 *   save_as                zweite Falldatei samt Fensterumbindung
 *   list_cases/case_hash   Bestandskontrolle nach dem Schliessen
 *   archive_cases          verschiebt die Zweitdatei hashgebunden ins Archiv
 *
 * Voraussetzung:
 *   SSE_JOURNEY_FIXTURE=<positionierte Wegwerfkopie im Fallbereich der Test-API>
 *
 * Die Kopie muss bereits auf der profilierten Tabellenseite stehen (das
 * erledigt test/position-case.mjs im Live-Gate). Dieses Skript SPEICHERT die
 * Kopie bewusst; der Aufrufer darf danach keinen unveraenderten Hash erwarten,
 * sondern bekommt die exakte Hash-Abfolge hier zugesichert.
 */
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fixtureCaseRef } from "./fixture-case-ref.mjs";
import { profiledTablePage } from "./profiled-table-page.mjs";

const fixture = process.env.SSE_JOURNEY_FIXTURE;
assert(fixture, "SSE_JOURNEY_FIXTURE mit einer positionierten Wegwerfkopie ist Pflicht.");
const caseRef = fixtureCaseRef(fixture);
const resultDir = process.env.SSE_TEST_RESULT_DIR;
assert(resultDir, "SSE_TEST_RESULT_DIR aus dem isolierten Test-API-Wrapper fehlt.");

const { heading, amountColumn, sumLabel, sumOccurrence } = profiledTablePage();

const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex").toUpperCase();
const fullText = (result) => result?.content?.filter((part) => part.type === "text")
  .map((part) => part.text).join("\n") ?? "";
const ssePids = () => execFileSync(
  "powershell.exe",
  ["-NoLogo", "-NoProfile", "-Command", "@(Get-Process -Name SSE -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id | Sort-Object) -join ','"],
  { encoding: "utf8", windowsHide: true },
).trim();
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

/** SSE formatiert Betraege deutsch. Beide Richtungen bleiben exakt und ohne Gleitkomma. */
const parseCents = (text) => {
  assert.match(String(text), /^-?\d{1,3}(?:\.\d{3})*,\d{2}$|^-?\d+,\d{2}$/u,
    `Kein eindeutiger deutscher Waehrungswert: ${JSON.stringify(text)}`);
  const [euro, cent] = String(text).replace(/\./gu, "").split(",");
  const sign = euro.startsWith("-") ? -1 : 1;
  return sign * (Math.abs(Number(euro)) * 100 + Number(cent));
};
const formatCents = (cents) => {
  const euro = String(Math.floor(Math.abs(cents) / 100)).replace(/\B(?=(?:\d{3})+(?!\d))/gu, ".");
  return `${cents < 0 ? "-" : ""}${euro},${String(Math.abs(cents) % 100).padStart(2, "0")}`;
};

const here = dirname(fileURLToPath(import.meta.url));
const client = new Client({ name: "sse-live-write-journey", version: "1.0.0" });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(here, "..", "dist", "index.js")],
  env: { ...process.env },
});
const callRaw = (name, args, timeout = 180_000) => client.callTool(
  { name, arguments: args }, undefined, { timeout, maxTotalTimeout: timeout },
);
const call = async (name, args, timeout = 180_000) => {
  const result = await callRaw(name, args, timeout);
  assert.notEqual(result?.isError, true, `${name}: ${fullText(result)}`);
  return JSON.parse(fullText(result));
};

const readTable = async (hwnd, step) => {
  const read = await call("sse_table_read", { sumLabel, sumOccurrence, noKeys: true, hwnd });
  assert(Array.isArray(read.kopf) && read.kopf.includes(amountColumn),
    `${step}: profilierte Betragsspalte '${amountColumn}' fehlt im Kopf ${JSON.stringify(read.kopf)}.`);
  assert(typeof read.summe === "string" && read.summe,
    `${step}: sse_table_read meldet die gebundene Kontrollsumme nicht.`);
  return read;
};

/**
 * Startet die Wegwerfkopie sichtbar und bindet Instanz samt Hauptfenster.
 * Die Reise braucht diesen Start zweimal: der zweite beweist die Persistenz.
 */
const launchBound = async (step) => {
  const launched = await call("sse_launch", { caseRef, mode: "einur" }, 180_000);
  const hwnd = launched.instance?.hwnd;
  const pid = launched.pid;
  assert(Number.isInteger(hwnd) && hwnd > 0, `${step}: Start lieferte kein Hauptfenster: ${JSON.stringify(launched)}`);
  assert(Number.isInteger(pid) && pid > 0, `${step}: Start lieferte keine PID: ${JSON.stringify(launched)}`);
  const state = await call("sse_ui_state", { hwnd });
  assert.equal(state.running, true, `${step}: gestartete Instanz ist nicht lesbar.`);
  assert.equal(state.instance?.hwnd, hwnd, `${step}: Lage-Snapshot ist nicht an das Start-HWND gebunden.`);
  return { pid, hwnd };
};

/**
 * Wartet den PID-gebundenen Schliessvorgang zu Ende. Da die Reise nur ohne
 * fremde SSE-Instanz laeuft, beweist running=false das Ende der eigenen.
 */
const awaitShutdown = async (step) => {
  let lastError = null;
  for (let attempt = 0; attempt < 24; attempt++) {
    try {
      if (!(await call("sse_health", {})).running) return;
    } catch (error) {
      lastError = error;
    }
    await wait(500);
  }
  assert.fail(`${step}: eigene SSE-Instanz blieb nach dem Schliessen aktiv.` +
    (lastError ? ` Letzter Fehler: ${lastError.message}` : ""));
};

/**
 * Raeumt eine Dialogkette von oben nach unten ab.
 *
 * `sse_dialog_list` nennt keinen obersten Dialog, aber `sse_dialog_answer`
 * weist jede Antwort auf einen verdeckten Dialog strukturiert mit
 * `non-topmost-dialog` ab. Genau dieses Urteil des Workers ist hier die
 * Reihenfolgequelle: Es wird der Reihe nach probiert, und nur der tatsaechlich
 * oberste Dialog laesst sich beantworten. Geraten wird nichts - jede Meldung
 * wird vorher gelesen, muss einen sicheren Schliessschalter tragen und wird
 * protokolliert, damit der Test die reale Kette festhaelt statt sie zu
 * verschweigen.
 */
const SAFE_DIALOG_BUTTONS = ["OK", "Schließen", "Schliessen", "Abbrechen"];
const drainDialogs = async (pid, step) => {
  const chain = [];
  for (let round = 0; round < 8; round++) {
    const listed = await call("sse_dialog_list", { pid });
    const dialogs = listed.dialogs ?? [];
    if (!dialogs.length) return chain;
    let answered = null;
    for (const dialog of dialogs) {
      const button = (dialog.buttons ?? []).map((entry) => entry.name)
        .find((name) => SAFE_DIALOG_BUTTONS.includes(name));
      assert(button,
        `${step}: Dialog '${dialog.title}' bietet keinen sicheren Schliessschalter: ${JSON.stringify(dialog.buttons)}`);
      const outcome = await callRaw("sse_dialog_answer", {
        hwnd: dialog.hwnd, fingerprint: dialog.fingerprint, button, waitMs: 2000,
      }, 120_000);
      const parsed = JSON.parse(fullText(outcome));
      if (outcome?.isError) {
        assert.equal(parsed.kind, "non-topmost-dialog",
          `${step}: '${dialog.title}' scheiterte unerwartet: ${JSON.stringify(parsed)}`);
        continue;
      }
      answered = { titel: String(dialog.title ?? ""), schalter: button };
      break;
    }
    assert(answered,
      `${step}: keiner der offenen Dialoge war der oberste: ${JSON.stringify(dialogs.map((d) => d.title))}`);
    chain.push(answered);
  }
  assert.fail(`${step}: Die Dialogkette war nach acht Antworten immer noch nicht leer.`);
};

/** UStVA-Lesung mit gebundener Uebersichtsseite. */
const readUstva = async (hwnd, step) => {
  const read = await call("sse_ustva_read", { hwnd }, 300_000);
  assert.equal(read.ok, true, `${step}: ustva_read scheiterte: ${JSON.stringify(read).slice(0, 300)}`);
  assert.equal(read.pageKind, "overview", `${step}: ustva_read fand nicht die Uebersicht.`);
  return read;
};

const pidsBefore = ssePids();
assert.equal(pidsBefore, "", "Die Schreibreise startet nur ohne vorhandene SSE-Instanz.");

const hashStart = sha256(fixture);
const markerAmount = "0,11";
const startedInstances = [];
let summary = null;

try {
  await client.connect(transport);

  // ================================================== Phase 1: Schreiben und
  // hashgebunden speichern. Die Kontrollsumme kommt aus der Anwendung selbst.
  const first = await launchBound("Erststart");
  startedInstances.push(first);

  const before = await readTable(first.hwnd, "Ausgangslage");
  const sumStart = before.summe;
  const startCents = parseCents(sumStart);
  assert.equal(formatCents(startCents), sumStart,
    `Die gelesene Kontrollsumme ueberlebt den Formatvergleich nicht: ${sumStart}`);
  const existing = before.zeilen.flat().map((cell) => String(cell ?? ""));
  assert(!existing.includes(markerAmount),
    `Der Markerbetrag ${markerAmount} existiert bereits; die Zeilenbindung waere mehrdeutig.`);
  const sumWithMarker = formatCents(startCents + parseCents(markerAmount));

  const added = await call("sse_table_add", {
    expectedPage: heading,
    werte: before.kopf.map((column) => (column === amountColumn ? markerAmount : "")),
    sumLabel,
    sumOccurrence,
    expectedBefore: sumStart,
    expectedAfter: sumWithMarker,
    hwnd: first.hwnd,
  }, 300_000);
  assert.equal(added.verified, true, `Anlegen wurde nicht verifiziert: ${JSON.stringify(added)}`);
  assert.equal(added.sumAfter, sumWithMarker, `Anlegen erzeugte eine andere Summe: ${JSON.stringify(added)}`);

  const dirtyAfterAdd = await call("sse_ui_state", { hwnd: first.hwnd });
  assert.equal(dirtyAfterAdd.ungespeichert, true, "Die angelegte Zeile machte den Fall nicht ungespeichert.");

  const savedFirst = await call("sse_save", {
    caseRef, expectedHashBefore: hashStart, hwnd: first.hwnd,
  }, 300_000);
  assert.equal(savedFirst.verified, true, `Speichern wurde nicht bestaetigt: ${JSON.stringify(savedFirst)}`);
  assert.equal(savedFirst.transmitted, false, "Die Wegwerfkopie gilt als uebermittelt.");
  const hashAfterAdd = sha256(fixture);
  assert.notEqual(hashAfterAdd, hashStart, "Speichern hat die Datei nicht veraendert.");
  const cleanAfterSave = await call("sse_ui_state", { hwnd: first.hwnd });
  assert.equal(cleanAfterSave.ungespeichert, false, "Nach dem Speichern blieb der Fall ungespeichert.");

  await call("sse_close", { pid: first.pid, hwnd: first.hwnd, force: true, discardChanges: true }, 120_000);
  startedInstances.pop();
  await awaitShutdown("Nach dem ersten Speichern");
  assert.equal(sha256(fixture), hashAfterAdd, "Das Schliessen veraenderte die gespeicherte Datei.");

  // ============================================= Phase 2: Persistenzbeweis und
  // Rueckbau. Erst der Neustart beweist, dass die Zeile wirklich in der Datei
  // liegt und nicht nur im Fenster stand.
  const second = await launchBound("Zweitstart");
  startedInstances.push(second);

  const persisted = await readTable(second.hwnd, "Persistenz");
  assert.equal(persisted.summe, sumWithMarker,
    "Die gespeicherte Zeile hat den Neustart nicht ueberlebt - save hat die Aenderung nicht persistiert.");
  const persistedCells = persisted.zeilen.flat().map((cell) => String(cell ?? ""));
  assert(persistedCells.includes(markerAmount), "Der gespeicherte Markerbetrag fehlt nach dem Neustart.");

  // Gemessen an der profilierten Gebuehrentabelle: Sie spiegelt den Betrag in
  // eine zweite, berechnete Spalte derselben Zeile. Eine Zeilenbindung allein
  // ueber den Text ist dort deshalb grundsaetzlich mehrdeutig, und
  // sse_table_delete weist genau das fail-closed ab. Nach dem Neustart gibt es
  // keine Runtime-ID aus der Mutation mehr - sie wird hier aus der laufenden
  // Anwendung neu hergeleitet und gegen zwei unabhaengige Sichten geprueft.
  const markerColumns = persisted.zeilen.flatMap((row) => row
    .map((cell, columnIndex) => ({ columnIndex, cell: String(cell ?? "") }))
    .filter((entry) => entry.cell === markerAmount)
    .map((entry) => entry.columnIndex));
  const amountColumnIndex = persisted.kopf.indexOf(amountColumn);
  assert(markerColumns.includes(amountColumnIndex),
    `Der Markerbetrag steht nicht in der profilierten Betragsspalte ${amountColumnIndex}: ${JSON.stringify(markerColumns)}`);
  const markerHits = await call("sse_find", { name: markerAmount, hwnd: second.hwnd });
  const orderedHits = [...(markerHits.hits ?? [])].sort((left, right) => left.x - right.x);
  assert.equal(orderedHits.length, markerColumns.length,
    `Strukturelle und geometrische Sicht auf den Markerbetrag widersprechen sich: ` +
    `${markerColumns.length} Tabellenzellen, ${orderedHits.length} Elementtreffer.`);
  const targetRid = orderedHits[[...markerColumns].sort((a, b) => a - b).indexOf(amountColumnIndex)]?.rid;
  assert.equal(typeof targetRid, "string",
    `Keine Runtime-ID fuer die Betragszelle gebunden: ${JSON.stringify(orderedHits)}`);

  const deleted = await call("sse_table_delete", {
    expectedPage: heading,
    text: markerAmount,
    targetRid,
    sumLabel,
    sumOccurrence,
    expectedBefore: sumWithMarker,
    expectedAfter: sumStart,
    hwnd: second.hwnd,
  }, 300_000);
  assert.equal(deleted.verified, true, `Loeschen wurde nicht verifiziert: ${JSON.stringify(deleted)}`);
  assert.equal(deleted.after, sumStart, `Loeschen fuehrte nicht auf die Ausgangssumme: ${JSON.stringify(deleted)}`);

  const savedSecond = await call("sse_save", {
    caseRef, expectedHashBefore: hashAfterAdd, hwnd: second.hwnd,
  }, 300_000);
  assert.equal(savedSecond.verified, true, `Zweites Speichern wurde nicht bestaetigt: ${JSON.stringify(savedSecond)}`);
  const hashClean = sha256(fixture);
  assert.notEqual(hashClean, hashAfterAdd, "Das zweite Speichern hat die Datei nicht veraendert.");

  // ==================================================== Phase 3: UStVA-Quartett.
  // Zahllast und Zeitraum sind die fachlichen Kontrollsummen; jede Aenderung
  // wird sofort zurueckgenommen und die Datei bleibt unangetastet (kein save).
  const ustvaPage = "Umsatzsteuer-Voranmeldungen 2025";
  const navigation = await call("sse_goto", {
    name: ustvaPage, maxSteps: 200, useSearch: true, hwnd: second.hwnd,
  }, 300_000);
  assert.equal(navigation.erreicht, true, `UStVA-Uebersicht nicht erreicht: ${JSON.stringify(navigation)}`);

  const ustvaStart = await readUstva(second.hwnd, "UStVA-Ausgangslage");
  assert.equal(`${ustvaStart.period.frequency}:${ustvaStart.period.key}`, "quarterly:q1",
    `UStVA startet nicht im erwarteten Zeitraum: ${JSON.stringify(ustvaStart.period)}`);
  assert.equal(ustvaStart.amounts.settlement.kind, "payment",
    `UStVA-Zahllast ist keine Zahlung: ${JSON.stringify(ustvaStart.amounts.settlement)}`);
  const settlementStartCents = ustvaStart.amounts.settlement.cents;
  assert.equal(settlementStartCents, 178810,
    `Die Muster-Zahllast weicht vom Profil ab: ${JSON.stringify(ustvaStart.amounts.settlement)}`);
  assert.equal(ustvaStart.flags.documents, false, "Das Belege-Kennzeichen ist unerwartet gesetzt.");
  const specialBefore = ustvaStart.amounts.specialAdvancePayment;
  assert.equal(specialBefore.cents, 0,
    `Die Sondervorauszahlung des Musterfalls ist nicht 0: ${JSON.stringify(specialBefore)}`);
  assert.equal(typeof specialBefore.display, "string",
    "Die Sondervorauszahlung liefert keinen exakten Anzeigetext fuer den Vorwert.");

  // Direkter combo_select am Zeitraumwaehler: q1 -> q2. Der Rueckweg laeuft
  // ueber die fachliche Komposition ustva_select_period; so sind beide Wege
  // einzeln bewiesen.
  const quarterAid = ".AuswahlAnmeldezeitraum.AuswahlQuartal.Combobox";
  const comboForward = await call("sse_combo_select", {
    expectedPage: ustvaPage,
    aid: quarterAid,
    expectedCurrent: "1. Vierteljahr",
    value: "2. Vierteljahr",
    expectedAfter: "2. Vierteljahr",
    hwnd: second.hwnd,
    expectedCaseRef: caseRef,
    expectedCaseHash: hashClean,
  }, 300_000);
  assert.equal(comboForward.verified, true, `combo_select q1->q2 unbestaetigt: ${JSON.stringify(comboForward)}`);
  const ustvaQ2 = await readUstva(second.hwnd, "Nach combo_select");
  assert.equal(ustvaQ2.period.key, "q2", `Zeitraumwechsel kam nicht an: ${JSON.stringify(ustvaQ2.period)}`);

  const periodBack = await call("sse_ustva_select_period", {
    selector: "quarter",
    expectedCurrent: "q2",
    value: "q1",
    hwnd: second.hwnd,
    expectedCaseRef: caseRef,
    expectedCaseHash: hashClean,
  }, 300_000);
  assert.equal(periodBack.verified, true, `ustva_select_period q2->q1 unbestaetigt: ${JSON.stringify(periodBack)}`);
  const ustvaBackToQ1 = await readUstva(second.hwnd, "Nach Zeitraumruecknahme");
  assert.equal(ustvaBackToQ1.period.key, "q1", "Der Zeitraum steht nicht wieder auf q1.");
  assert.equal(ustvaBackToQ1.amounts.settlement.cents, settlementStartCents,
    "Die Zahllast hat den Zeitraum-Hin-und-Rueckweg nicht unveraendert ueberstanden.");

  const flagOn = await call("sse_ustva_set_flag", {
    flag: "documents",
    expectedBefore: false,
    value: true,
    expectedAfter: true,
    hwnd: second.hwnd,
    expectedCaseRef: caseRef,
    expectedCaseHash: hashClean,
  }, 300_000);
  assert.equal(flagOn.verified, true, `Belege-Kennzeichen setzen unbestaetigt: ${JSON.stringify(flagOn)}`);
  assert.equal((await readUstva(second.hwnd, "Flag gesetzt")).flags.documents, true,
    "Das gesetzte Belege-Kennzeichen ist im Readback nicht sichtbar.");
  const flagOff = await call("sse_ustva_set_flag", {
    flag: "documents",
    expectedBefore: true,
    value: false,
    expectedAfter: false,
    hwnd: second.hwnd,
    expectedCaseRef: caseRef,
    expectedCaseHash: hashClean,
  }, 300_000);
  assert.equal(flagOff.verified, true, `Belege-Kennzeichen zuruecknehmen unbestaetigt: ${JSON.stringify(flagOff)}`);
  assert.equal((await readUstva(second.hwnd, "Flag zurueck")).flags.documents, false,
    "Das Belege-Kennzeichen steht nicht wieder auf aus.");

  // Sondervorauszahlung 100,00: die Zahllast muss exakt um 10.000 Cent sinken -
  // das ist die fachliche Kontrollsumme dieses Schreibwegs.
  const specialSet = await call("sse_ustva_change_value", {
    field: "special_advance_payment",
    expectedBefore: specialBefore.display,
    value: "100,00",
    expectedAfter: "100,00",
    hwnd: second.hwnd,
    expectedCaseRef: caseRef,
    expectedCaseHash: hashClean,
  }, 300_000);
  assert.equal(specialSet.verified, true, `Sondervorauszahlung setzen unbestaetigt: ${JSON.stringify(specialSet)}`);
  const ustvaWithSpecial = await readUstva(second.hwnd, "Sondervorauszahlung gesetzt");
  assert.equal(ustvaWithSpecial.amounts.specialAdvancePayment.cents, 10000,
    "Die Sondervorauszahlung kam nicht als 100,00 an.");
  assert.equal(ustvaWithSpecial.amounts.settlement.cents, settlementStartCents - 10000,
    `Die Zahllast sank nicht exakt um die Sondervorauszahlung: ${JSON.stringify(ustvaWithSpecial.amounts.settlement)}`);
  const specialRevert = await call("sse_ustva_change_value", {
    field: "special_advance_payment",
    expectedBefore: "100,00",
    value: specialBefore.display,
    expectedAfter: specialBefore.display,
    hwnd: second.hwnd,
    expectedCaseRef: caseRef,
    expectedCaseHash: hashClean,
  }, 300_000);
  assert.equal(specialRevert.verified, true, `Sondervorauszahlung zuruecknehmen unbestaetigt: ${JSON.stringify(specialRevert)}`);
  const ustvaReverted = await readUstva(second.hwnd, "Sondervorauszahlung zurueck");
  assert.equal(ustvaReverted.amounts.specialAdvancePayment.cents, 0,
    "Die Sondervorauszahlung steht nicht wieder auf 0.");
  assert.equal(ustvaReverted.amounts.settlement.cents, settlementStartCents,
    "Die Zahllast steht nach der Ruecknahme nicht wieder auf dem Ausgangswert.");

  const sectionOpened = await call("sse_ustva_open_section", {
    section: "input_tax", hwnd: second.hwnd,
  }, 300_000);
  assert.equal(sectionOpened.ustva?.targetPage, "Abziehbare Vorsteuer",
    `ustva_open_section nennt eine andere Zielseite: ${JSON.stringify(sectionOpened.ustva)}`);
  const inputTaxRead = await call("sse_ustva_read", { hwnd: second.hwnd }, 300_000);
  assert.equal(inputTaxRead.pageKind, "input_tax", "Der Vorsteuerbereich wurde nicht geoeffnet.");
  const sectionBack = await call("sse_click", {
    name: "Zurück",
    expectedPageBefore: "Abziehbare Vorsteuer",
    expectedPageAfter: ustvaPage,
    waitMs: 3000,
    hwnd: second.hwnd,
  }, 120_000);
  assert.equal(sectionBack.verified, true, `Rueckweg aus dem Vorsteuerbereich unbestaetigt: ${JSON.stringify(sectionBack)}`);

  // Alle UI-Aenderungen waren fluechtig oder zurueckgenommen; auf der Platte
  // liegt weiterhin exakt der Stand des zweiten Speicherns.
  assert.equal(sha256(fixture), hashClean, "Die UStVA-Schritte veraenderten die Datei, obwohl nie gespeichert wurde.");

  // ============================================ Phase 4: CSV-Export samt Datei-
  // beweis. export_csv oeffnet den Dialog, dialog_answer loest den Export aus,
  // file_dialog_select bedient den nativen Ordnerdialog.
  const exportDirName = `journey-csv-${process.pid}`;
  const exportDir = join(resultDir, exportDirName);
  mkdirSync(exportDir);
  const exportOpened = await call("sse_export_csv", { hwnd: second.hwnd }, 300_000);
  assert.equal(exportOpened.offeneDialoge, 1, `CSV-Export oeffnete nicht genau einen Dialog: ${JSON.stringify(exportOpened)}`);
  const exportDialog = exportOpened.dialog;
  const exportButton = "Klicken Sie hier, um Ihre Daten zu exportieren";
  assert((exportDialog.buttons ?? []).some((button) => button.name === exportButton),
    `Der Exportdialog traegt den erwarteten Exportschalter nicht: ${JSON.stringify(exportDialog.buttons)}`);
  await call("sse_dialog_answer", {
    hwnd: exportDialog.hwnd,
    fingerprint: exportDialog.fingerprint,
    button: exportButton,
    waitMs: 3000,
  }, 120_000);
  const folderSelected = await call("sse_file_dialog_select", {
    expectedDialogTitle: "Ausgabe-Verzeichnis wählen",
    resourceRef: `results:${exportDirName}`,
    waitMs: 5000,
  }, 120_000);
  assert.equal(folderSelected.dialogClosed, true, `Der Ordnerdialog blieb offen: ${JSON.stringify(folderSelected)}`);

  // Der Export schreibt asynchron und legt eine Datei je Ausgabekategorie an.
  // Gemessen am offiziellen Musterfall: Kategorien ohne Daten ergeben eine
  // LEERE Datei (dort `GWGVerzeichnis.csv` - der Fall hat keine geringwertigen
  // Wirtschaftsgueter). Eine leere Datei ist deshalb korrektes Verhalten und
  // kein Fehler; beweiskraeftig ist, dass ueberhaupt Inhalt geschrieben wurde.
  let csvFiles = [];
  let filled = [];
  for (let attempt = 0; attempt < 40; attempt++) {
    csvFiles = readdirSync(exportDir).filter((name) => name.toLowerCase().endsWith(".csv"));
    filled = csvFiles.filter((name) => statSync(join(exportDir, name)).size > 0);
    if (filled.length > 0) break;
    await wait(500);
  }
  assert(csvFiles.length > 0, "Der CSV-Export hat keine Datei in das gewaehlte Verzeichnis geschrieben.");
  assert(filled.length > 0,
    `Der CSV-Export schrieb ausschliesslich leere Dateien: ${JSON.stringify(csvFiles)}`);
  const exportedBytes = csvFiles.reduce((total, name) => total + statSync(join(exportDir, name)).size, 0);
  assert(exportedBytes > 0, "Der CSV-Export hat keinen einzigen Datenbyte geschrieben.");

  // Der abgeschlossene Export legt eine weitere Meldung ueber das Exportfenster.
  // Gemessen: sse_dialog_answer weist die Antwort auf einen nicht obersten
  // Dialog mit 'non-topmost-dialog' ab - zu Recht, denn ein verdeckter Dialog
  // laesst sich nicht sicher bedienen. Die Kette wird deshalb von oben nach
  // unten abgeraeumt.
  const exportChain = await drainDialogs(second.pid, "Nach dem CSV-Export");
  assert(exportChain.some((entry) => entry.titel.startsWith("Export für das Finanzamt")),
    `Das Exportfenster war nicht Teil der abgeraeumten Dialogkette: ${JSON.stringify(exportChain)}`);

  // ====================================== Phase 5: Menue- und Fensterverwaltung.
  // menu_click oeffnet denselben Exportdialog ueber den echten Menueweg und
  // beweist damit den Klickpfad; der Dialog wird sofort wieder geschlossen.
  const menu = await call("sse_menu", { name: "Datei", hwnd: second.hwnd });
  const menuEntries = JSON.stringify(menu);
  assert(menuEntries.includes("Export für das Finanzamt"),
    `Das Datei-Menue nennt den Exporteintrag nicht: ${menuEntries.slice(0, 500)}`);
  const menuClicked = await call("sse_menu_click", {
    name: "Export für das Finanzamt (CSV-Dateien)",
    waitMs: 2500,
    hwnd: second.hwnd,
  }, 120_000);
  assert.equal(menuClicked.ausgeloest, "Export für das Finanzamt (CSV-Dateien)",
    `menu_click loeste einen anderen Eintrag aus: ${JSON.stringify(menuClicked)}`);
  const menuChain = await drainDialogs(second.pid, "Nach dem Menueweg");
  assert(menuChain.some((entry) => entry.titel.startsWith("Export für das Finanzamt")),
    `Der Menueweg oeffnete keinen Exportdialog: ${JSON.stringify(menuChain)}`);
  const menuClosed = await call("sse_menu_close", { hwnd: second.hwnd });
  assert.equal(menuClosed.popupCountAfter, 0, "Nach menu_close ist noch ein Menuepopup offen.");

  // Werte-Info als bekanntes Nebenfenster oeffnen und exakt gebunden schliessen.
  const details = await call("sse_result_details", { hwnd: second.hwnd, openIfNeeded: true }, 300_000);
  assert.equal(details.vollstaendig, true, "Werte-Info konnte nicht vollstaendig gelesen werden.");
  const windowsWithDetails = await call("sse_windows", {});
  const valuesWindow = (windowsWithDetails.windows ?? [])
    .find((window) => String(window.title ?? "").startsWith("Werte-Info:"));
  assert(valuesWindow, `Kein Werte-Info-Fenster gelistet: ${JSON.stringify(windowsWithDetails.windows)}`);
  const valuesClosed = await call("sse_window_close", {
    pid: valuesWindow.pid,
    hwnd: valuesWindow.hwnd,
    titleFingerprint: valuesWindow.titleFingerprint,
    waitMs: 2000,
  }, 120_000);
  assert.equal(valuesClosed.closed, true, `Werte-Info wurde nicht geschlossen: ${JSON.stringify(valuesClosed)}`);

  // Hauptfenster echt minimieren (Win32, ausserhalb der API) und per
  // window_restore verifiziert zurueckholen.
  const windowsBeforeMinimize = await call("sse_windows", {});
  const mainWindow = (windowsBeforeMinimize.windows ?? [])
    .find((window) => window.hwnd === second.hwnd);
  assert(mainWindow, "Das gebundene Hauptfenster fehlt in der Fensterliste.");
  execFileSync("powershell.exe", [
    "-NoLogo", "-NoProfile", "-Command",
    "Add-Type -Namespace W -Name U -MemberDefinition '[DllImport(\"user32.dll\")] public static extern bool ShowWindow(IntPtr h, int n);'; " +
    `[void][W.U]::ShowWindow([IntPtr]${second.hwnd}, 6)`,
  ], { windowsHide: true });
  await wait(800);
  const windowsMinimized = await call("sse_windows", {});
  const minimizedMain = (windowsMinimized.windows ?? []).find((window) => window.hwnd === second.hwnd);
  assert.equal(minimizedMain?.minimiert, true, "Das Hauptfenster liess sich nicht minimieren.");
  const restored = await call("sse_window_restore", {
    pid: second.pid,
    hwnd: second.hwnd,
    titleFingerprint: minimizedMain.titleFingerprint,
    waitMs: 1500,
  }, 120_000);
  assert.equal(restored.restored, true, `window_restore blieb unbestaetigt: ${JSON.stringify(restored)}`);
  assert.equal(restored.minimizedAfter, false, "Das Hauptfenster ist nach dem Restore weiterhin minimiert.");

  // ================================== Phase 6: Speichern unter, Schliessen und
  // Archiv. save_as bindet das Fenster nachweislich an die Zweitdatei um; die
  // Ursprungskopie bleibt auf dem Stand des zweiten Speicherns.
  const secondCopyName = `journey-zweitkopie-${process.pid}.Gew2025`;
  const secondCopyRef = `cases:${secondCopyName}`;
  const savedAs = await call("sse_save_as", {
    sourceRef: caseRef,
    expectedSourceHash: hashClean,
    targetRef: secondCopyRef,
    waitMs: 4000,
  }, 300_000);
  assert.equal(savedAs.verified, true, `Speichern unter wurde nicht verifiziert: ${JSON.stringify(savedAs)}`);
  assert.equal(savedAs.transmitted, false, "Die Zweitkopie gilt als uebermittelt.");
  const secondCopyHash = savedAs.targetHash;
  assert.match(String(secondCopyHash), /^[A-F0-9]{64}$/u, "save_as lieferte keinen Zielhash.");
  assert.equal(sha256(fixture), hashClean, "save_as veraenderte die Quelldatei.");

  await call("sse_close", { pid: second.pid, hwnd: second.hwnd, force: true, discardChanges: true }, 120_000);
  startedInstances.pop();
  await awaitShutdown("Nach Speichern unter");
  assert.equal(sha256(fixture), hashClean, "Das Schliessen veraenderte die Ursprungskopie.");
  assert.equal(sha256(join(dirname(fixture), secondCopyName)), secondCopyHash,
    "Die Zweitkopie hat nach dem Schliessen einen anderen Hash als von save_as bestaetigt.");

  const listed = await call("sse_list_cases", {});
  const listedNames = (listed.faelle ?? listed.cases ?? []).map((entry) => entry.datei ?? entry.name ?? entry.file);
  assert(listedNames.some((name) => String(name).includes(basename(fixture))),
    `list_cases nennt die Ursprungskopie nicht: ${JSON.stringify(listedNames)}`);
  assert(listedNames.some((name) => String(name).includes(secondCopyName)),
    `list_cases nennt die Zweitkopie nicht: ${JSON.stringify(listedNames)}`);
  const hashedCopy = await call("sse_case_hash", { ref: secondCopyRef });
  assert.equal(hashedCopy.sha256, secondCopyHash, "case_hash bestaetigt den Zielhash der Zweitkopie nicht.");

  // archive_cases verlangt neben dem Verschiebeauftrag den VOLLSTAENDIGEN
  // erwarteten Restbestand. Das ist die eigentliche Sicherung: Wer archiviert,
  // muss belegen, dass er den ganzen Fallordner kennt - sonst koennte ein
  // uebersehener Fall unbemerkt mitwandern.
  //
  // Gemessen: SSE legt beim Speichern eine eigene Sicherungsdatei
  // '<Fallname>_Backup' daneben, und der Archivbestand zaehlt sie mit. Genau
  // daran ist der erste Lauf fail-closed gescheitert - zu Recht. Der Bestand
  // wird deshalb erst explizit als die drei erwarteten Dateien festgeschrieben
  // und dann hashgebunden uebergeben.
  const backupName = `${basename(fixture)}_Backup`;
  const backupPath = join(dirname(fixture), backupName);
  assert(existsSync(backupPath),
    `SSE legte beim Speichern keine erwartete Sicherungsdatei an: ${backupName}`);
  const inventory = await call("sse_list_cases", { includeBackups: true });
  const inventoryNames = (inventory.cases ?? []).map((entry) => String(entry.name)).sort();
  assert.deepEqual(inventoryNames, [basename(fixture), backupName, secondCopyName].sort(),
    `Der Fallbestand entspricht nicht den drei erwarteten Dateien: ${JSON.stringify(inventoryNames)}`);

  const archived = await call("sse_archive_cases", {
    destinationRef: `backups:journey-archiv-${process.pid}`,
    cases: [{ name: secondCopyName, expectedSha256: secondCopyHash }],
    expectedRemaining: [
      { name: basename(fixture), expectedSha256: sha256(fixture) },
      { name: backupName, expectedSha256: sha256(backupPath) },
    ],
  }, 300_000);
  assert.equal(archived.ok, true, `Archivieren scheiterte: ${JSON.stringify(archived)}`);
  const listedAfterArchive = await call("sse_list_cases", {});
  const remainingNames = (listedAfterArchive.faelle ?? listedAfterArchive.cases ?? [])
    .map((entry) => entry.datei ?? entry.name ?? entry.file);
  assert(!remainingNames.some((name) => String(name).includes(secondCopyName)),
    "Die archivierte Zweitkopie liegt weiterhin im Fallbereich.");
  assert(remainingNames.some((name) => String(name).includes(basename(fixture))),
    "Das Archivieren entfernte faelschlich die Ursprungskopie.");

  summary = {
    ok: true,
    tabelle: { start: sumStart, mitMarker: sumWithMarker, endstand: sumStart },
    hashes: { start: hashStart, nachAnlegen: hashAfterAdd, nachRueckbau: hashClean },
    ustva: { zahllastCents: settlementStartCents, sondervorauszahlungGeprueft: true },
    export: {
      dateien: csvFiles,
      mitInhalt: filled,
      leereKategorien: csvFiles.filter((name) => !filled.includes(name)),
      bytes: exportedBytes,
    },
    zweitkopie: { name: secondCopyName, hash: secondCopyHash, archiviert: true },
    fallbestand: { vorDemArchiv: inventoryNames, sicherungsdatei: backupName },
    dialogketten: { nachExport: exportChain, nachMenue: menuChain },
  };
} finally {
  try {
    for (const instance of [...startedInstances].reverse()) {
      await call("sse_close", { pid: instance.pid, hwnd: instance.hwnd, force: true, discardChanges: true }, 120_000);
    }
  } finally {
    await client.close();
  }
}

assert.equal(ssePids(), pidsBefore, "Die Schreibreise hat eine SSE-PID erzeugt, beendet oder hinterlassen.");
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
