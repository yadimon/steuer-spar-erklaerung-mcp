/**
 * Reale Lebenszykluspruefung fuer den unsichtbaren Windows-Desktop.
 *
 * Aufruf:
 *   $env:SSE_HIDDEN_FIXTURE='G:\\...\\arbeitskopie.Gew2025'
 *   npm run test:hidden
 *
 * Die Datei wird nur geoeffnet und ihr Hash vor/nach dem Test verglichen.
 * Fuer diesen Test trotzdem immer eine entbehrliche Arbeitskopie verwenden.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

const fixture = process.env.SSE_HIDDEN_FIXTURE;
if (!fixture) {
  process.stderr.write("SSE_HIDDEN_FIXTURE mit einer entbehrlichen Falldatei ist Pflicht.\n");
  process.exit(2);
}

const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex").toUpperCase();
const fullText = (result) => result?.content?.filter((c) => c.type === "text").map((c) => c.text).join("\n") ?? "";
const jsonResult = (result, name) => {
  if (result?.isError) throw new Error(`${name}: ${fullText(result)}`);
  return JSON.parse(fullText(result));
};
const errorText = (result, name) => {
  if (!result?.isError) throw new Error(`${name}: erwarteter Fehler blieb aus: ${fullText(result)}`);
  return fullText(result);
};
const jsonErrorResult = (result, name) => {
  if (!result?.isError) throw new Error(`${name}: erwarteter Fehler blieb aus: ${fullText(result)}`);
  try { return JSON.parse(fullText(result)); }
  catch { throw new Error(`${name}: strukturierter Fehler war kein JSON: ${fullText(result)}`); }
};
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const here = dirname(fileURLToPath(import.meta.url));
const server = join(here, "..", "dist", "index.js");
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [server],
  env: { ...process.env },
});
const client = new Client({ name: "sse-hidden-lifecycle", version: "1.0.0" });
const desktopName = `SSEAutoTest${process.pid}${Date.now()}`;
const collectOutput = join(tmpdir(), `sse-collect-${process.pid}-${Date.now()}.json`);
const hashBefore = sha256(fixture);
const ocrArtifacts = () => readdirSync(tmpdir())
  .filter((name) => /^sse-(?:warning|checker-(?:full|detail))-[A-Za-z0-9-]+\.png$/i.test(name))
  .sort();
const ssePids = () => execFileSync(
  "powershell.exe",
  ["-NoLogo", "-NoProfile", "-Command", "@(Get-Process -Name SSE -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id | Sort-Object) -join ','"],
  { encoding: "utf8", windowsHide: true },
).trim();
let started = false;

try {
  await client.connect(transport);
  const t0 = Date.now();
  const initialStatus = jsonResult(await client.callTool({ name: "sse_desktop_status", arguments: {} }), "initial-status");
  assert(initialStatus.aktiv === false && initialStatus.markeVeraltet === false,
    "Test braucht einen freien, markerlosen MCP-Desktop; vorhandene Instanz wird nicht angefasst.");
  const markerPath = join(tmpdir(), "sse-mcp-desktop.txt");
  assert(!existsSync(markerPath), "Test darf keine vorhandene Desktopmarke ueberschreiben.");
  writeFileSync(markerPath, JSON.stringify({ name: `${desktopName}Stale`, pid: 2147483646 }), "utf8");
  try {
    const staleStatus = jsonResult(await client.callTool({ name: "sse_desktop_status", arguments: {} }), "stale-status");
    assert(staleStatus.aktiv === false && staleStatus.markeVeraltet === true && staleStatus.desktopErreichbar === false,
      `Verschwundener markierter Desktop wurde nicht als stale gemeldet: ${JSON.stringify(staleStatus)}`);
  } finally {
    if (existsSync(markerPath)) unlinkSync(markerPath);
  }
  const deniedStop = errorText(
    await client.callTool({ name: "sse_desktop_stop", arguments: { save: false } }),
    "markerless-stop",
  );
  assert(/Marke|ownership|Instanz/i.test(deniedStop), "Markerloser Stop meldet keinen Ownership-Fehler.");

  const baselineSsePids = ssePids();
  const start = jsonResult(await client.callTool({
    name: "sse_desktop_start",
    arguments: { file: fixture, mode: "einur", name: desktopName, timeoutSec: 15 },
  }, undefined, { timeout: 30_000, maxTotalTimeout: 30_000 }), "start");
  started = true;
  assert(start.desktop === desktopName, "Start meldet den falschen Desktop.");
  assert(Number.isInteger(start.pid) && start.pid > 0, "Start meldet keine gueltige PID.");
  assert(Array.isArray(start.fenster) && start.fenster.length > 0, "Start hat kein Fenster auf dem Ziel-Desktop verifiziert.");
  assert(start.product?.supported === true && start.product?.fileMajor === 31,
    `Start hat die SSE-2025-Produktidentitaet nicht verifiziert: ${JSON.stringify(start.product)}`);
  assert(start.case?.taxYear === 2025 && start.case?.documentType?.toLowerCase() === "gew",
    `Start hat Steuerjahr und Modul der Falldatei nicht gebunden: ${JSON.stringify(start.case)}`);
  const oneStartedPidSet = ssePids();
  assert(oneStartedPidSet.split(",").includes(String(start.pid)), "Neu gestartete eigene SSE-PID fehlt in der Prozessliste.");

  const deniedSecondStart = errorText(await client.callTool({
    name: "sse_desktop_start",
    arguments: { file: fixture, mode: "einur", name: desktopName, timeoutSec: 5 },
  }), "second-start");
  assert(/bereits aktiv|zweiter Start|desktop-active/i.test(deniedSecondStart), "Zweiter Start wurde nicht als belegter Desktop verweigert.");
  assert(ssePids() === oneStartedPidSet, "Verweigerter Doppelstart hat trotzdem eine weitere SSE-PID erzeugt.");

  const status = jsonResult(await client.callTool({ name: "sse_desktop_status", arguments: {} }), "status");
  assert(status.aktiv === true, "Status meldet den versteckten Desktop nicht als aktiv.");
  assert(status.desktop === desktopName, "Status meldet einen anderen Desktop.");
  assert(Array.isArray(status.fenster) && status.fenster.some((w) => w.pid === start.pid), "Status sieht das eigene SSE-Fenster nicht.");

  const health = jsonResult(await client.callTool({ name: "sse_health", arguments: {} }), "health");
  assert(health.running === true && health.canaryOk === true, "UIA-Kanarienabfrage auf dem versteckten Desktop ist nicht gesund.");

  const state1 = jsonResult(await client.callTool({ name: "sse_ui_state", arguments: {} }), "ui-state-1");
  assert(state1.running === true && state1.instance?.pid === start.pid,
    `Lage-Snapshot ist nicht an die gestartete PID gebunden: ${JSON.stringify(state1.instance)}`);
  assert(Number.isInteger(state1.instance?.hwnd) && state1.instance.hwnd > 0,
    "Lage-Snapshot meldet kein gueltiges Hauptfenster-HWND.");
  assert(/^[A-F0-9]{64}$/.test(state1.stateFingerprint), "Lage-Snapshot hat keinen stabilen SHA256-Fingerprint.");
  assert(state1.ungespeichert === false, "Rein lesender Startzustand ist unerwartet dirty.");
  assert(state1.warnfensterAnzahl === 0,
    "Harmlose UAC-/Helferfenster wurden faelschlich als Warnfenster eingeordnet.");

  const state2 = jsonResult(await client.callTool({
    name: "sse_ui_state",
    arguments: { previousFingerprint: state1.stateFingerprint },
  }), "ui-state-2");
  assert(state2.stateFingerprint === state1.stateFingerprint && state2.changedSince === false,
    "Zwei unveraenderte Lage-Snapshots haben keinen stabilen Fingerprint.");
  assert(state2.instance?.pid === state1.instance.pid && state2.instance?.hwnd === state1.instance.hwnd,
    "PID/HWND wechselten zwischen unveraenderten Snapshots.");
  const stateExplicit = jsonResult(await client.callTool({
    name: "sse_ui_state",
    arguments: { hwnd: state1.instance.hwnd, previousFingerprint: state2.stateFingerprint },
  }), "ui-state-explicit-hwnd");
  assert(stateExplicit.stateFingerprint === state2.stateFingerprint && stateExplicit.changedSince === false,
    "Explizit gebundenes Hauptfenster liefert einen anderen unveraenderten Zustand.");
  const staleState = errorText(await client.callTool({
    name: "sse_ui_state",
    arguments: { hwnd: 1 },
  }), "ui-state-stale-hwnd");
  assert(/stale|kein aktuelles SSE-2025-Hauptfenster/i.test(staleState),
    "Veraltetes HWND wurde nicht fail-closed abgewiesen.");

  const resultDetails = jsonResult(await client.callTool({
    name: "sse_result_details",
    arguments: { hwnd: state1.instance.hwnd, openIfNeeded: true },
  }), "result-details");
  assert(resultDetails.vollstaendig === true && resultDetails.anzahl > 0,
    "Werte-Info wurde nicht vollstaendig strukturiert gelesen.");
  assert(resultDetails.nichtPositionierteZellenAnzahl === 0 && resultDetails.vertikalUnvollstaendig === false,
    "Nicht positionierte oder vertikal ausgeblendete Ergebniszellen wurden uebersehen.");
  assert(resultDetails.kopfVollstaendig === true && resultDetails.spalten?.uiaKopfzeilen?.length === 4,
    "Qt-Ergebniskopf ist nicht vollstaendig.");
  assert(resultDetails.vergleichsInvariantGeprueft > 0 && resultDetails.vergleichsInvariantFehler.length === 0,
    "Aktuell/Festgehalten/Differenz bestehen die numerische Spalteninvariante nicht.");
  assert(resultDetails.zeilen.length === resultDetails.anzahl && resultDetails.unvollstaendigeZeilen.length === 0,
    "Ergebnisanzahl, Zeilen und unvollstaendige Gruppen widersprechen sich.");
  assert(/^[A-F0-9]{64}$/.test(resultDetails.fingerprint), "Ergebniswerte haben keinen SHA256-Fingerprint.");
  const stateWithResult = jsonResult(await client.callTool({
    name: "sse_ui_state",
    arguments: { previousFingerprint: state2.stateFingerprint },
  }), "ui-state-with-result");
  assert(stateWithResult.changedSince === true && stateWithResult.ergebnis?.verfuegbar === true,
    "Oeffnen der Werte-Info wurde nicht als Zustandswechsel mit Ergebniswerten erkannt.");
  assert(stateWithResult.ergebnis?.fingerprint === resultDetails.fingerprint,
    "Gebundener Lage-Snapshot und separates Ergebniswerkzeug lesen verschiedene Ergebniswerte.");
  assert(stateWithResult.nichtmodaleFenster.some((window) => window.art === "werte-info"),
    "Werte-Info wurde nicht explizit als bekanntes nicht-modales Fenster klassifiziert.");
  assert(Array.isArray(stateWithResult.unsichereFenster) && stateWithResult.unsichereFenster.length === 0,
    "Sauberer Testzustand enthaelt unerwartete unbekannte/unlesbare Fenster.");
  assert(stateWithResult.warnfensterAnzahl === 0,
    "Werte-Info wurde faelschlich als Warnfenster eingeordnet.");

  jsonResult(await client.callTool({ name: "sse_dismiss", arguments: {} }), "dismiss-known-helpers");
  const blockedForward = jsonErrorResult(await client.callTool({
    name: "sse_click",
    arguments: { name: "Weiter", expectedPageBefore: stateWithResult.heading },
  }), "navigate-forward-blocked");
  assert(blockedForward.kind === "navigation-blocked" && blockedForward.navigiert === false,
    `Wirkungsloser Weiter-Klick wurde nicht strukturiert blockiert: ${JSON.stringify(blockedForward)}`);
  assert(blockedForward.ueberschriftVorher === stateWithResult.heading &&
    blockedForward.ueberschriftNachher === stateWithResult.heading,
  "Blockierte Navigation hat keinen exakten Vor-/Nachseiten-Readback.");
  assert(blockedForward.dialoge?.some((dialog) => dialog.title?.startsWith("Die Prüfung hat ergeben")),
    "Blockierte Navigation meldet den neu geoeffneten Pruefhinweis nicht.");
  const blockedBack = jsonErrorResult(await client.callTool({
    name: "sse_click",
    arguments: { name: "Zurück", expectedPageBefore: stateWithResult.heading },
  }), "navigate-back-with-dialog");
  assert(blockedBack.kind === "navigation-blocked" && blockedBack.clicked === null,
    "Navigation bei bereits offenem Dialog wurde trotzdem ausgeloest.");
  const ocrArtifactsBefore = ocrArtifacts();
  const warningResult = await client.callTool({ name: "sse_warning_popup_read", arguments: { includeImage: true } });
  const warning = jsonResult(warningResult, "warning-popup");
  assert(warning.active === true && warning.ocrOk === true, "Automatischer Pruefhinweis wurde nicht vollstaendig gelesen.");
  assert(Array.isArray(warning.warnings) && warning.warnings.length > 0, "Pruefhinweis meldet keinen strukturierten Titel.");
  assert(typeof warning.text === "string" && warning.text.length > 50, "Pruefhinweis-OCR lieferte keinen belastbaren Fliesstext.");
  assert(typeof warning.bodyFingerprint === "string" && warning.bodyFingerprint.length === 64, "OCR-Fliesstext hat keinen Fingerprint.");
  assert(warningResult.content.some((part) => part.type === "image"), "Kontrollbild wurde nicht ueber den MCP-Transport geliefert.");
  assert(JSON.stringify(ocrArtifacts()) === JSON.stringify(ocrArtifactsBefore), "Warn-/Pruefer-OCR hinterliess eine neue temporaere Bilddatei.");
  const answered = jsonResult(await client.callTool({
    name: "sse_dialog_answer",
    arguments: {
      hwnd: warning.hwnd,
      fingerprint: warning.fingerprint,
      bodyFingerprint: warning.bodyFingerprint,
      button: "Jetzt ignorieren",
    },
  }), "warning-answer");
  assert(answered.closed === true && answered.answered === "Jetzt ignorieren", "Pruefhinweis wurde nicht fingerprintgebunden geschlossen.");
  assert(Object.hasOwn(answered, "ungespeichertVorher") && Object.hasOwn(answered, "ungespeichertNachher"),
    "Dialogantwort meldet den Dirty-State nicht vor und nach der Aktion.");
  const afterAnswerState = jsonResult(await client.callTool({
    name: "sse_ui_state",
    arguments: { hwnd: stateWithResult.instance.hwnd, previousFingerprint: stateWithResult.stateFingerprint },
  }), "state-after-answer");
  assert(afterAnswerState.heading && afterAnswerState.heading !== stateWithResult.heading &&
    afterAnswerState.changedSince === true,
  `Der hinter dem Hinweis wartende Seitenwechsel wurde nicht im neuen Zustand sichtbar: ${JSON.stringify(afterAnswerState)}`);
  const back = jsonResult(await client.callTool({
    name: "sse_click",
    arguments: {
      name: "Zurück",
      expectedPageBefore: afterAnswerState.heading,
      expectedPageAfter: stateWithResult.heading,
      waitMs: 1800,
    },
  }), "navigate-back");
  assert(back.navigiert === true && back.verified === true &&
    back.ueberschriftNachher === stateWithResult.heading,
  `Ruecknavigation bestaetigt die erwartete Zielseite nicht: ${JSON.stringify(back)}`);
  const resultBeforeStop = jsonResult(await client.callTool({
    name: "sse_result_details",
    arguments: { hwnd: state1.instance.hwnd, openIfNeeded: true },
  }), "result-before-stop");
  assert(resultBeforeStop.vollstaendig === true, "Werte-Info konnte vor dem sicheren Stop nicht erneut gelesen werden.");
  const partialCollection = jsonErrorResult(await client.callTool({
    name: "sse_collect",
    arguments: { hwnd: state1.instance.hwnd, maxPages: 1, path: collectOutput },
  }, undefined, { timeout: 60_000, maxTotalTimeout: 60_000 }), "partial-collection");
  assert(partialCollection.kind === "collection-incomplete" &&
    partialCollection.vollstaendig === false && partialCollection.anzahl === 1,
  `Begrenzte Gesamterfassung meldet keinen ehrlichen Teilstand: ${JSON.stringify(partialCollection)}`);
  assert(partialCollection.datei === collectOutput && /^[A-F0-9]{64}$/.test(partialCollection.dateiHash) &&
    existsSync(collectOutput) && sha256(collectOutput) === partialCollection.dateiHash,
  "Teilstand wurde nicht atomar mit bestaetigtem Dateihash geschrieben.");
  const partialFile = JSON.parse(readFileSync(collectOutput, "utf8"));
  assert(partialFile.vollstaendig === false && partialFile.anzahl === 1 && partialFile.stopKind,
    "Teilstandsdatei verschweigt Vollstaendigkeit oder Stopgrund.");
  const beforeRejectedOverwrite = jsonResult(await client.callTool({
    name: "sse_ui_state", arguments: { hwnd: state1.instance.hwnd },
  }), "state-before-rejected-collect-overwrite");
  const rejectedOverwrite = errorText(await client.callTool({
    name: "sse_collect",
    arguments: { hwnd: state1.instance.hwnd, maxPages: 1, path: collectOutput },
  }), "collect-overwrite-without-hash");
  assert(/expectedOutputHashBefore|existiert bereits/i.test(rejectedOverwrite),
    "Bestehender Teilstand wurde nicht vor dem Batch hashgebunden geschuetzt.");
  const afterRejectedOverwrite = jsonResult(await client.callTool({
    name: "sse_ui_state",
    arguments: { hwnd: state1.instance.hwnd, previousFingerprint: beforeRejectedOverwrite.stateFingerprint },
  }), "state-after-rejected-collect-overwrite");
  assert(afterRejectedOverwrite.changedSince === false &&
    afterRejectedOverwrite.heading === beforeRejectedOverwrite.heading,
  "Abgewiesenes Ueberschreiben hat trotzdem weiter navigiert oder den UI-Zustand geaendert.");
  const stop = jsonResult(await client.callTool({ name: "sse_desktop_stop", arguments: { discardChanges: true } }), "stop");
  started = false;
  assert(stop.hartBeendet === false, `Nur navigierte Testinstanz musste hart beendet werden: ${JSON.stringify(stop)}`);
  const reportedValuesInfo = stop.hilfsfenster
    .filter((window) => window.title?.startsWith("Werte-Info:"));
  assert(reportedValuesInfo.every((window) => window.closed === true),
    "Eine vom sicheren Stop einzeln gemeldete Werte-Info blieb offen.");
  assert(!stop.hilfsfenster.some((window) => !window.title),
    "Sicherer Stop behandelte titellose UAC-Systemoverlays faelschlich als zu schliessende Hilfsfenster.");
  const stoppedStatus = jsonResult(await client.callTool({ name: "sse_desktop_status", arguments: {} }), "stopped-status");
  assert(stoppedStatus.aktiv === false && stoppedStatus.sseLaeuft === false && stoppedStatus.markeVeraltet === false,
    `Status blieb nach sauberem Stop aktiv oder veraltet: ${JSON.stringify(stoppedStatus)}`);
  assert(ssePids() === baselineSsePids, "Nach Stop blieb eine zusaetzliche SSE-PID aus dem Test zurueck.");

  process.stdout.write(`OK: versteckter Desktop in ${Date.now() - t0} ms gestartet, gelesen, navigiert und sauber beendet.\n`);
} finally {
  if (started) {
    try { await client.callTool({ name: "sse_desktop_stop", arguments: { discardChanges: true } }); } catch { }
  }
  await client.close();
  if (existsSync(collectOutput)) unlinkSync(collectOutput);
  assert(sha256(fixture) === hashBefore, "Falldatei wurde trotz rein lesendem Test veraendert.");
}
