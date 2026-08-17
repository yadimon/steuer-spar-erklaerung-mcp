/**
 * Opt-in live experiment: change one populated Gew2025 currency cell on a
 * disposable copy on a private Win32 desktop. The visible-desktop watcher
 * proves that SSE never becomes the user's foreground process.
 *
 * The target is not hard-coded. The test reads the focusless allowlist from the
 * public page-object catalogue, binds whichever profiled page the fixture
 * actually shows, and derives the cell, the dependent total and the expected
 * values from the live page. That keeps the proof reproducible when a fixture
 * opens on a different profiled page, and it exercises every catalogued profile
 * with the same evidence instead of only the first one.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  copyFileSync, existsSync, readFileSync, unlinkSync, writeFileSync,
} from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const source = process.env.SSE_FOCUSLESS_FIXTURE;
assert(source && existsSync(source) && extname(source).toLowerCase() === ".gew2025",
  "SSE_FOCUSLESS_FIXTURE muss auf einen vorhandenen Gew2025-Testfall zeigen.");
const testCaseDir = process.env.SSE_TEST_CASE_DIR;
const testResultDir = process.env.SSE_TEST_RESULT_DIR;
assert(testCaseDir && testResultDir, "Isolierte API-Testverzeichnisse fehlen.");
const trackResults = process.env.SSE_FOCUSLESS_TRACK_RESULTS === "1";

const here = dirname(fileURLToPath(import.meta.url));
const server = join(here, "..", "dist", "index.js");
const watcherScript = join(here, "visible-foreground-watch.ps1");
const catalog = JSON.parse(readFileSync(join(here, "..", "profiles", "2025", "page-objects.json"), "utf8"));
const profiles = Object.entries(catalog.focuslessCommits ?? {});
assert(profiles.length > 0, "Der Focusless-Katalog ist leer.");

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [server],
  env: { ...process.env },
});
const client = new Client({ name: "sse-hidden-focusless-transaction", version: "1.0.0" });
const fullText = (result) => result?.content?.filter((part) => part.type === "text")
  .map((part) => part.text).join("\n") ?? "";
const parsedText = (result, name) => {
  const body = fullText(result);
  try { return JSON.parse(body); }
  catch { throw new Error(`${name}: Antwort war kein JSON: ${body}`); }
};
const callRaw = (name, args = {}, timeout = 180_000) => client.callTool(
  { name, arguments: args }, undefined, { timeout, maxTotalTimeout: timeout },
);
const call = async (name, args = {}, timeout = 180_000) => {
  const result = await callRaw(name, args, timeout);
  if (result?.isError) throw new Error(`${name}: ${fullText(result)}`);
  return parsedText(result, name);
};
const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex").toUpperCase();
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

// The UI formats currency German-style. Parsing and re-formatting keeps the
// expected values derived from the live page instead of hard-coded amounts.
const parseAmount = (text) => {
  assert.match(String(text), /^-?\d{1,3}(\.\d{3})*(,\d{2})?$|^-?\d+(,\d{2})?$/u,
    `Kein eindeutiger Waehrungswert: ${text}`);
  return Number(String(text).replace(/\./gu, "").replace(",", "."));
};
const formatAmount = (value) => value.toFixed(2).replace(".", ",");

async function unlinkOwned(path) {
  assert(dirname(path) === testCaseDir && basename(path).startsWith("sse-hidden-focusless-"),
    `Cleanup verweigert fremdes Ziel: ${path}`);
  for (let attempt = 0; attempt < 20; attempt++) {
    if (!existsSync(path)) return;
    try { unlinkSync(path); }
    catch (error) {
      if (!error || !["EBUSY", "EPERM"].includes(error.code)) throw error;
    }
    await wait(250);
  }
  assert(!existsSync(path), `Testkopie blieb gesperrt: ${path}`);
}

async function dismissBoundStartupDialogs(pid) {
  for (let round = 0; round < 4; round++) {
    const listed = await call("sse_dialog_list", { pid });
    const dialogs = (listed.dialogs ?? []).filter((dialog) =>
      dialog.kind === "native-dialog" || dialog.kind === "qt-dialog");
    if (!dialogs.length) return;
    assert.equal(dialogs.length, 1, `Mehrdeutige Startdialoge: ${JSON.stringify(dialogs)}`);
    const dialog = dialogs[0];
    const texts = (dialog.texts ?? []).join(" ");
    let button = null;
    if (dialog.title === "Steuerprogramm" && texts.toLowerCase().includes("wiederherstell") &&
        (dialog.buttons ?? []).some((candidate) => candidate.name === "Nein")) button = "Nein";
    if (dialog.title === "Aktualisierung fehlgeschlagen!" && texts.includes("importierte Steuerfall") &&
        (dialog.buttons ?? []).some((candidate) => candidate.name.toLowerCase() === "ok")) button = "OK";
    if (dialog.title === "Gewinn aktualisiert!" && /^Der Gewinn des Betriebs ».+« wurde aktualisiert\.$/u.test(texts) &&
        (dialog.buttons ?? []).length === 1 && dialog.buttons[0].name === "OK") button = "OK";
    assert(button, `Unerwarteter Startdialog; nichts beantwortet: ${JSON.stringify(dialog)}`);
    await call("sse_dialog_answer", { hwnd: dialog.hwnd, fingerprint: dialog.fingerprint, button });
  }
  throw new Error("Startdialog-Kette ueberschritt vier strikt gebundene Antworten.");
}

async function startForegroundWatcher(targetProcessId, forbiddenDesktopName) {
  const nonce = `${process.pid}-${Date.now()}`;
  const readyPath = join(testResultDir, `focusless-watch-${nonce}.ready`);
  const stopPath = join(testResultDir, `focusless-watch-${nonce}.stop`);
  const child = spawn("powershell.exe", [
    "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
    "-File", watcherScript,
    "-TargetProcessId", String(targetProcessId),
    "-ReadyPath", readyPath,
    "-StopPath", stopPath,
    "-ForbiddenDesktopName", forbiddenDesktopName,
    "-TimeoutMs", "240000",
    "-SampleMs", "10",
  ], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  for (let attempt = 0; attempt < 500 && !existsSync(readyPath); attempt++) {
    assert.equal(child.exitCode, null, `Foreground-Watcher endete vor Bereitschaft: ${stderr || stdout}`);
    await wait(20);
  }
  assert(existsSync(readyPath), "Foreground-Watcher wurde nicht rechtzeitig bereit.");
  return async () => {
    writeFileSync(stopPath, "stop", "utf8");
    const [code, signal] = await once(child, "exit");
    try {
      assert.equal(signal, null, `Foreground-Watcher wurde durch ${signal} beendet.`);
      assert.equal(code, 0, `Foreground-Watcher Exit ${code}: ${stderr}`);
      return JSON.parse(stdout);
    } finally {
      for (const path of [readyPath, stopPath]) if (existsSync(path)) unlinkSync(path);
    }
  };
}

/**
 * Reach a profiled page without ever showing SSE. Linear paging is the only
 * navigation that works on a private desktop, and Qt can interrupt it with the
 * automatic "Die Prüfung hat ergeben ..." checker popup. That popup is answered
 * strictly bound to both its UIA fingerprint and the OCR body fingerprint, and
 * only after it has been read; the loop never confirms a chain blindly.
 */
async function navigateFocuslessTo(hwnd, heading) {
  for (let round = 0; round < 4; round++) {
    const attempt = await callRaw("sse_goto", {
      name: heading, useSearch: false, maxSteps: 30, direction: "Weiter", hwnd,
    }, 300_000);
    if (!attempt?.isError) return parsedText(attempt, "sse_goto");
    const failure = parsedText(attempt, "sse_goto");
    assert.equal(failure.kind, "warning-dialog",
      `Focusless-Navigation scheiterte ohne beantwortbaren Pruefhinweis: ${JSON.stringify(failure)}`);
    const warningWindows = failure.warnfenster ?? [];
    assert.equal(warningWindows.length, 1,
      `Mehrdeutige Pruefhinweise; nichts beantwortet: ${JSON.stringify(warningWindows)}`);
    const popup = await call("sse_warning_popup_read", { hwnd: warningWindows[0].hwnd, ocr: true });
    assert.equal(popup.ocrOk, true, `Pruefhinweis war nicht vollstaendig lesbar: ${JSON.stringify(popup)}`);
    assert(popup.bodyFingerprint, "Pruefhinweis lieferte keinen bodyFingerprint.");
    assert(popup.actions?.includes("Jetzt ignorieren"),
      `Erwartete Aktion fehlt: ${JSON.stringify(popup.actions)}`);
    const answered = await call("sse_dialog_answer", {
      hwnd: warningWindows[0].hwnd,
      fingerprint: popup.fingerprint,
      bodyFingerprint: popup.bodyFingerprint,
      button: "Jetzt ignorieren",
    });
    assert.equal(answered.ungespeichertNachher, answered.ungespeichertVorher,
      `Das Wegklicken des Pruefhinweises veraenderte den Speicherzustand: ${JSON.stringify(answered)}`);
  }
  throw new Error(`Seite '${heading}' war in vier gebundenen Runden focusless nicht erreichbar.`);
}

/**
 * Resolve the profiled column cell of a populated row: group the table cells by
 * row, order each row by x and read the column index from the live header row.
 * The nearest-header rule that the worker applies is mirrored here, so the test
 * would notice if the two ever disagreed about which column is "Betrag".
 */
function resolveTargetCell(cells, columns, columnHeader, region) {
  const columnIndex = columns.indexOf(columnHeader);
  assert(columnIndex >= 0, `Spalte '${columnHeader}' fehlt im Tabellenkopf ${JSON.stringify(columns)}.`);
  const nettoIndex = columns.indexOf("Netto");
  // One automation-ID section can carry several sub-tables, each closed by its
  // own Summe row. Only cells between the bound total and the previous one may
  // influence that total, so everything else is out of scope for this proof.
  assert(Number.isFinite(region?.sumY), `Tabellenregion ohne Summenposition: ${JSON.stringify(region)}`);
  const upperBound = Number.isFinite(region.previousSummaryY) ? region.previousSummaryY : -Infinity;
  const rows = new Map();
  for (const cell of cells) {
    if (!(cell.y > upperBound && cell.y < region.sumY)) continue;
    if (!rows.has(cell.y)) rows.set(cell.y, []);
    rows.get(cell.y).push(cell);
  }
  const candidates = [];
  for (const [y, rowCells] of rows) {
    if (rowCells.length !== columns.length) continue;
    const ordered = [...rowCells].sort((left, right) => left.x - right.x);
    const cell = ordered[columnIndex];
    if (!cell?.name || !/\d/u.test(cell.name)) continue;
    // Qt keeps a trailing free row materialised; its currency cells read 0,00.
    // Only a genuinely populated amount is a valid mutation target.
    if (parseAmount(cell.name) === 0) continue;
    // The total is computed from the net column. Picking a row taxed at 0 %
    // keeps the dependent total a strict +1,00, so a wrong dependent result
    // cannot hide behind a rounded VAT share.
    if (nettoIndex >= 0) {
      const netto = ordered[nettoIndex]?.name;
      if (!netto || parseAmount(netto) !== parseAmount(cell.name)) continue;
    }
    candidates.push({ y, cell, row: ordered });
  }
  assert(candidates.length > 0,
    `Keine unbesteuerte befuellte Zeile in der Summenregion ${JSON.stringify(region)} gefunden.`);
  candidates.sort((left, right) => left.y - right.y);
  return candidates[0];
}

const sourceHash = sha256(source);
const target = join(testCaseDir, `sse-hidden-focusless-${process.pid}-${Date.now()}.Gew2025`);
const targetRef = `cases:${basename(target)}`;
const desktopName = `SSEFocusless${process.pid}`;
let started = false;
let stopWatcher = null;
let watcher = null;
const startedAt = Date.now();

await client.connect(transport);
try {
  assert.equal((await call("sse_health")).running, false,
    "Hidden-Commit-Test startet nur ohne vorhandene SSE-Instanz.");
  assert.equal((await call("sse_desktop_status")).aktiv, false,
    "Vorhandener MCP-Desktop wird nicht angefasst.");

  copyFileSync(source, target);
  assert.equal(sha256(target), sourceHash, "Testkopie ist nicht bytegleich.");
  assert.equal((await call("sse_case_hash", { ref: targetRef })).sha256, sourceHash,
    "API-Hash der Testkopie weicht ab.");

  const launch = await call("sse_desktop_start", {
    caseRef: targetRef, mode: "einur", name: desktopName, timeoutSec: 20,
  }, 120_000);
  started = true;
  await dismissBoundStartupDialogs(launch.pid);
  const ui = await call("sse_ui_state");
  assert.equal(ui.instance?.pid, launch.pid, "Hidden-Instanz ist nicht an die Start-PID gebunden.");
  assert(Number.isInteger(ui.instance?.hwnd), "Hidden-Instanz meldet kein HWND.");
  const hwnd = ui.instance.hwnd;

  const startPage = await call("sse_page", { hwnd });
  // A case remembers its own last page, so the fixture may open anywhere. Bind
  // the profile that is already visible, otherwise page to the first catalogued
  // one; either way the transaction below runs against a profiled page.
  const alreadyOpen = profiles.filter(([, policy]) => policy.heading === startPage.ueberschrift);
  assert(alreadyOpen.length <= 1, "Mehrere Profile beanspruchen dieselbe Seitenueberschrift.");
  const [policyId, policy] = alreadyOpen[0] ?? profiles[0];
  let navigation = null;
  if (startPage.ueberschrift !== policy.heading) {
    navigation = await navigateFocuslessTo(hwnd, policy.heading);
  }
  const page = await call("sse_page", { hwnd });
  assert.equal(page.ueberschrift, policy.heading,
    `Profilierte Seite wurde nicht erreicht: '${page.ueberschrift}'.`);
  assert.equal(policy.controlType, "DataItem", `Dieses Live-Muster deckt nur Tabellenzellen ab: ${policyId}.`);
  assert.equal(policy.valueKind, "currency", `Dieses Live-Muster deckt nur Waehrungszellen ab: ${policyId}.`);
  assert.equal(policy.requiredSumChecks?.length, 1, `Genau eine Pflichtsumme wird erwartet: ${policyId}.`);
  const sumRule = policy.requiredSumChecks[0];

  const sumField = page.felder.find((field) => field.label === sumRule.label);
  assert(sumField?.wert, `Pflichtsumme '${sumRule.label}' fehlt auf der Seite.`);
  const sumBefore = parseAmount(sumField.wert);

  const table = await call("sse_table_read", {
    hwnd, sumLabel: sumRule.label, sumOccurrence: sumRule.occurrence ?? 1, noKeys: true,
  });
  const columns = table.kopf ?? [];
  assert(columns.includes(policy.columnHeader),
    `Tabellenkopf ${JSON.stringify(columns)} enthaelt '${policy.columnHeader}' nicht.`);

  const found = await call("sse_find", { hwnd, aid: policy.automationIdSuffix, type: "DataItem" });
  assert.notEqual(found.incomplete, true, "UIA-Baum fuer die Zieltabelle ist unvollstaendig.");
  assert(found.count > 0, `Keine Zellen unter '${policy.automationIdSuffix}' gefunden.`);
  const { cell: targetCell, row } = resolveTargetCell(found.hits, columns, policy.columnHeader, table.bindung);

  const valueBefore = targetCell.name;
  const amountBefore = parseAmount(valueBefore);
  const valueAfter = formatAmount(amountBefore + 1);
  const sumAfterExpected = formatAmount(sumBefore + 1);
  const sumChecks = [{
    label: sumRule.label, occurrence: sumRule.occurrence ?? 1,
    before: sumField.wert, after: sumAfterExpected,
  }];

  stopWatcher = await startForegroundWatcher(launch.pid, desktopName);
  const commonArgs = {
    rid: targetCell.rid,
    expectedPage: policy.heading,
    expectedBefore: valueBefore,
    value: valueAfter,
    expectedAfter: valueAfter,
    valueKind: policy.valueKind,
    sumChecks,
    hwnd,
    pid: launch.pid,
    expectedCaseRef: targetRef,
    expectedCaseHash: sourceHash,
  };
  const rejectedTracking = await callRaw("sse_change_field", {
    ...commonArgs, trackResults: true,
  }, 300_000);
  assert.equal(rejectedTracking?.isError, true, "Hidden trackResults=true muss vor der Mutation scheitern.");
  assert.match(fullText(rejectedTracking), /trackResults=true/u);
  const stillBefore = await call("sse_page", { hwnd });
  assert.equal(stillBefore.felder.find((field) => field.label === sumRule.label)?.wert, sumField.wert,
    "Abgewiesenes Result-Tracking hat den Seitenwert veraendert.");

  const transactionStartedAt = Date.now();
  const changedRaw = await callRaw("sse_change_field", { ...commonArgs, trackResults }, 300_000);
  const transactionMs = Date.now() - transactionStartedAt;
  watcher = await stopWatcher();
  stopWatcher = null;
  if (changedRaw?.isError) {
    // A refused commit is still a safety statement: prove the fail-closed
    // contract before reporting the failure, so the run distinguishes "could
    // not bind focus" from "mutated without proof".
    const refused = parsedText(changedRaw, "sse_change_field");
    assert.equal(watcher.targetSeen, false,
      `Abgewiesener Commit holte SSE trotzdem in den Vordergrund: ${JSON.stringify(watcher)}`);
    assert.equal(watcher.forbiddenDesktopSeen, false,
      `Abgewiesener Commit machte den privaten Desktop zum Input-Desktop: ${JSON.stringify(watcher)}`);
    assert.equal(refused.feld?.nachher, valueBefore,
      `Abgewiesener Commit veraenderte den Feldwert: ${JSON.stringify(refused.feld)}`);
    assert.notEqual(refused.rollback?.versucht, true,
      `Abgewiesener Commit rollte blind zurueck: ${JSON.stringify(refused.rollback)}`);
    assert.equal(sha256(target), sourceHash, "Abgewiesener Commit schrieb auf Disk.");
    throw new Error(
      `sse_change_field wurde fail-closed abgewiesen (commit=${refused.commit}, kind=${refused.kind}); ` +
      `Feld, Datei, Vordergrund und Input-Desktop blieben nachweislich unveraendert. ` +
      `Details: ${fullText(changedRaw)}`);
  }
  const changed = parsedText(changedRaw, "sse_change_field");

  assert.equal(watcher.targetSeen, false,
    `SSE wurde auf dem sichtbaren Desktop foreground: ${JSON.stringify(watcher)}`);
  assert(watcher.samples >= 10, `Foreground-Watcher sammelte zu wenige Samples: ${JSON.stringify(watcher)}`);
  assert.equal(watcher.forbiddenDesktopSeen, false,
    `Privater SSE-Desktop wurde zum Input-Desktop: ${JSON.stringify(watcher)}`);
  assert.notEqual(watcher.inputDesktopBefore, desktopName);
  assert.notEqual(watcher.inputDesktopAfter, desktopName);
  assert.equal(changed.verified, true, `Transaktion ist nicht verifiziert: ${JSON.stringify(changed)}`);
  assert.equal(changed.commit, "verified-focusless-value-pattern-tab",
    `Falscher Commitpfad: ${JSON.stringify(changed)}`);
  assert.equal(changed.focuslessPolicy, policyId);
  assert.equal(changed.commitDetails?.foregroundLeaseUsed, false, "Commit verwendete eine Foreground-Lease.");
  assert.equal(changed.commitDetails?.physicalInputUsed, false, "Commit verwendete physische Eingabe.");
  assert.equal(Object.hasOwn(changed, "focusTelemetry"), false, "Commit erzeugte sichtbare Fokus-Telemetrie.");
  assert.equal(changed.feld?.nachher, valueAfter, `Feld-Readback stimmt nicht: ${JSON.stringify(changed.feld)}`);
  assert.equal(changed.summen?.[0]?.nachher, sumAfterExpected,
    `Summen-Readback stimmt nicht: ${JSON.stringify(changed.summen)}`);
  assert.equal(changed.ungespeichert, true, "Aenderung wurde nicht als ungespeichert markiert.");
  assert(Array.isArray(changed.zeitmessung?.phasen) && changed.zeitmessung.phasen.length > 0,
    `Phasenmessung fehlt: ${JSON.stringify(changed.zeitmessung)}`);
  if (trackResults) {
    assert.equal(changed.ergebnisVollstaendig, true, "Ergebnis-Readback ist unvollstaendig.");
    assert((changed.ergebnisDiff ?? []).length > 0,
      `Steuerberechnung reagierte nicht: ${JSON.stringify(changed.ergebnisDiff)}`);
  }

  const pageAfter = await call("sse_page", { hwnd });
  assert.equal(pageAfter.felder.find((field) => field.label === sumRule.label)?.wert, sumAfterExpected,
    "Separater lesender API-Aufruf bestaetigt die neue Summe nicht.");
  const changedCell = await call("sse_find", { hwnd, aid: policy.automationIdSuffix, type: "DataItem" });
  assert(changedCell.hits.some((cell) =>
    cell.x === targetCell.x && cell.y === targetCell.y && cell.name === valueAfter),
  "Separater lesender API-Aufruf bestaetigt die Zielzelle nicht.");
  assert.equal(sha256(target), sourceHash, "Ungespeicherte Transaktion schrieb auf Disk.");

  const stopped = await call("sse_desktop_stop", { discardChanges: true }, 120_000);
  started = false;
  assert.equal(stopped.hartBeendet, false, `Hidden-SSE musste hart beendet werden: ${JSON.stringify(stopped)}`);
  assert.equal(sha256(target), sourceHash, "Discard-Stop veraenderte die Testkopie auf Disk.");
  assert.equal(sha256(source), sourceHash, "Fixture wurde veraendert.");

  process.stdout.write(`${JSON.stringify({
    ok: true,
    policy: policyId,
    page: policy.heading,
    startPage: startPage.ueberschrift,
    navigation: navigation ? { steps: navigation.schritte, ms: navigation.ms } : "not-needed",
    column: policy.columnHeader,
    columns,
    rowCells: row.length,
    method: changed.commit,
    commitDetails: changed.commitDetails,
    field: { before: valueBefore, after: valueAfter },
    sum: { label: sumRule.label, before: sumField.wert, after: sumAfterExpected },
    resultChanges: changed.ergebnisDiff,
    phases: changed.zeitmessung,
    transactionMs,
    foreground: watcher,
    totalMs: Date.now() - startedAt,
  }, null, 2)}\n`);
} finally {
  if (stopWatcher) {
    try { watcher = await stopWatcher(); } catch { }
  }
  if (started) {
    try { await callRaw("sse_desktop_stop", { discardChanges: true }, 120_000); } catch { }
  }
  try { await client.close(); } catch { }
  assert.equal(sha256(source), sourceHash, "Fixture wurde im Cleanup veraendert.");
  await unlinkOwned(target);
}
