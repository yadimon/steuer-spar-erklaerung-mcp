/**
 * Opt-in Live-Regression gegen die mit SSE ausgelieferten Musterfaelle des
 * per SSE_PROFILE_ID gewaehlten Jahres.
 * Jeder Fall wird in den isolierten Test-API-Fallbereich kopiert, von MCP
 * nochmals bytegleich dupliziert, nur gelesen und ohne Speichern geschlossen.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, readFileSync, unlinkSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { loadProductProfile } from "../dist/product-profiles.js";

const profileId = process.env.SSE_PROFILE_ID ?? "2025";
const profile = loadProductProfile(profileId);
const expectationsPath = join(profile.profileDir, "tests", "expectations.json");
if (!existsSync(expectationsPath)) {
  throw new Error(`Musterfall-Erwartungen fuer SSE-Profil '${profileId}' fehlen: ${expectationsPath}`);
}
const expectations = JSON.parse(readFileSync(expectationsPath, "utf8"));

const steuertippsRoot = "C:\\Program Files\\Steuertipps\\SteuerSparErklaerung";
const defaultMusterDir = join(steuertippsRoot, profile.executable.installationFolderName, expectations.musterDirRelative);
const musterDir = process.env.SSE_MUSTER_DIR ?? defaultMusterDir;
const testCaseDir = process.env.SSE_TEST_CASE_DIR;
if (!testCaseDir) throw new Error("SSE_TEST_CASE_DIR aus dem isolierten Test-API-Wrapper fehlt.");

const allDefinitions = expectations.cases;
const requestedIds = new Set((process.env.SSE_LIVE_MUSTER_CASES ?? "")
  .split(",").map((id) => id.trim()).filter(Boolean));
const knownIds = new Set(allDefinitions.map(({ id }) => id));
for (const id of requestedIds) assert(knownIds.has(id), `Unbekannter Live-Musterfall: ${id}`);
const definitions = requestedIds.size
  ? allDefinitions.filter(({ id }) => requestedIds.has(id))
  : allDefinitions;

for (const definition of definitions) {
  const path = join(musterDir, definition.file);
  assert(existsSync(path), `Offizieller SSE-Musterfall fehlt: ${path}`);
}

const server = join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "index.js");
const transport = new StdioClientTransport({ command: process.execPath, args: [server], env: { ...process.env } });
const client = new Client({ name: "sse-live-muster-cases", version: "1.0.0" });
const fullText = (result) => result?.content?.filter((part) => part.type === "text")
  .map((part) => part.text).join("\n") ?? "";
const parsedText = (result, name) => {
  const text = fullText(result);
  try { return JSON.parse(text); }
  catch { throw new Error(`${name}: Antwort war kein JSON: ${text}`); }
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
let semanticChecks = 0;

function assertSemanticEqual(actual, expected, message) {
  assert.equal(actual, expected, message);
  semanticChecks += 1;
}

function assertExpectedResultRows(definition, result) {
  const { id, expectedRows } = definition;
  assert.equal(result.vollstaendig, true, `${id}: Ergebnisliste ist nicht vollstaendig.`);
  assert.deepEqual(result.unvollstaendigeZeilen, [], `${id}: unvollstaendige Ergebniszeilen.`);
  assert.deepEqual(result.vergleichsInvariantFehler, [], `${id}: Vergleichsinvariante verletzt.`);
  const rows = new Map((result.zeilen ?? []).map((row) => [row.beobachteterWert, row.aktuell]));
  for (const [label, expected] of expectedRows) {
    assertSemanticEqual(rows.get(label), expected, `${id}: ${label}`);
  }
}

function assertExpectedUstva(ustva, erwartet) {
  assert.equal(ustva.ok, true, "UStVA: Snapshot ist nicht erfolgreich.");
  assert.equal(ustva.page, erwartet.page, "UStVA: falsche Seite.");
  assertSemanticEqual(`${ustva.period.frequency}:${ustva.period.key}`, erwartet.period, "UStVA: Zeitraum");
  assertSemanticEqual(ustva.amounts.taxable19.base.cents, erwartet.taxable19BaseCents, "UStVA: 19%-Bemessungsgrundlage");
  assertSemanticEqual(ustva.amounts.taxable19.tax.cents, erwartet.taxable19TaxCents, "UStVA: 19%-Steuer");
  assertSemanticEqual(ustva.amounts.inputTax.cents, erwartet.inputTaxCents, "UStVA: Vorsteuer");
  assertSemanticEqual(
    `${ustva.amounts.settlement.kind}:${ustva.amounts.settlement.cents}`,
    erwartet.settlement,
    "UStVA: Zahllast",
  );
  assert.equal(ustva.transmission.blockedByApi, true, "UStVA: API-Versandsperre fehlt.");
  assert.equal(ustva.effects.savePerformed, false, "UStVA: Leseweg hat gespeichert.");
  assert.equal(ustva.effects.submissionPerformed, false, "UStVA: Leseweg hat uebermittelt.");
}

function assertNoDoubledHelpLines(id, abschnitte) {
  const namen = Object.keys(abschnitte);
  assert(namen.length >= 1, `${id}: sse_help lieferte keinen Abschnitt.`);
  for (const name of namen) {
    const zeilen = abschnitte[name]?.zeilen ?? [];
    for (let i = 1; i < zeilen.length; i++) {
      assert.notEqual(zeilen[i], zeilen[i - 1],
        `${id}: sse_help-Abschnitt '${name}' hat eine doppelte Folgezeile: '${zeilen[i]}'.`);
    }
  }
}

// Lese-Sweep fuer Operationen, die laut Coverage-Audit bisher keine einzige
// funktionale Zusicherung hatten (help, subpages, read_table u. a.). "ok"
// wird bewusst nicht als Feld gelesen: call() wirft bereits bei isError, ein
// zurueckgegebenes Objekt beweist den Erfolg also schon durch sein Dasein.
async function assertReadOnlyOperationSweep(definition, hwnd) {
  const { id } = definition;

  const page = await call("sse_page", { hwnd });
  assert.equal(typeof page.ueberschrift, "string", `${id}: sse_page ohne ueberschrift.`);
  assert(page.ueberschrift.length > 0, `${id}: sse_page lieferte eine leere ueberschrift.`);
  // Kernregressionswaechter: die Strukturbindung muss auf BEIDEN Engines ueber
  // den gebundenen Client-Header lesen, nie ueber den Geometrie-Rueckfall.
  assert.equal(page.ueberschriftQuelle, "clientHeader",
    `${id}: sse_page las die Ueberschrift nicht ueber den gebundenen Client-Header.`);

  await call("sse_read_page", { hwnd });

  const subpages = await call("sse_subpages", { hwnd });
  assert.equal(typeof subpages.anzahl, "number", `${id}: sse_subpages ohne numerische anzahl.`);
  assert(subpages.anzahl >= 0, `${id}: sse_subpages lieferte eine negative anzahl.`);

  const found = await call("sse_find", { hwnd, name: "Steuer", contains: true });
  assert.equal(typeof found.count, "number", `${id}: sse_find ohne numerischen count.`);
  assert.equal(found.incomplete, false, `${id}: sse_find-Baumlauf war abgeschnitten.`);

  // sse_windows kennt kein hwnd - es listet alle Fenster des SSE-Prozesses.
  const windows = await call("sse_windows", {});
  assert(Array.isArray(windows.windows) && windows.windows.length >= 1,
    `${id}: sse_windows lieferte kein Fenster.`);

  const help = await call("sse_help", { hwnd });
  assert.equal(typeof help.abschnitte, "object", `${id}: sse_help ohne abschnitte-Objekt.`);
  assertNoDoubledHelpLines(id, help.abschnitte);

  const readTable = await call("sse_read_table", { hwnd });
  assert(Array.isArray(readTable.ausgeschlosseneFenster),
    `${id}: sse_read_table ohne ausgeschlosseneFenster-Liste.`);

  // sse_read_full sammelt die Seite ueber ihre Rollstufen ein.
  const readFull = await call("sse_read_full", { hwnd });
  assert.equal(typeof readFull.anzahl, "number", `${id}: sse_read_full ohne numerische anzahl.`);
  assert(readFull.anzahl >= 0, `${id}: sse_read_full lieferte eine negative anzahl.`);

  // sse_scroll_page meldet den Rollzustand; kurze Seiten haben scrollbar=false.
  const scrollPage = await call("sse_scroll_page", { hwnd });
  assert.equal(typeof scrollPage.scrollbar, "boolean", `${id}: sse_scroll_page ohne scrollbar-Flag.`);

  // sse_table_read ist der eigenstaendige Tabellenvertrag (nicht sse_read_table).
  await call("sse_table_read", { hwnd });
}

// Steuerpruefer-Sweep: nur fuer Musterfaelle mit definition.checker === true.
// Ein echter Fall kann auf einer beliebigen Seite stehen - sse_goto versucht
// zuerst die globale Suche; nur bei deren nachgewiesenem Fehlschlag greift der
// dokumentierte Ruecksprung auf einen echten Klick im Navigationsbaum. Scheitert
// auch dieser, faellt der Test laut statt den Ausfall stillschweigend zu
// uebergehen.
async function runCheckerSweep(definition, hwnd) {
  const { id } = definition;

  const gotoPruefen = await callRaw("sse_goto", { name: "Prüfen und Abgeben", hwnd }, 300_000);
  if (gotoPruefen?.isError) {
    const clicked = await call("sse_click_point",
      { name: "Prüfen und Abgeben", type: "TreeItem", hwnd }, 60_000);
    assert.equal(clicked.clicked, "Prüfen und Abgeben",
      `${id}: Ruecksprung click_point auf 'Prüfen und Abgeben' schlug ebenfalls fehl.`);
  }

  await call("sse_goto", {
    name: "Steuererklärung prüfen", useSearch: false, direction: "Weiter", maxSteps: 10, hwnd,
  }, 300_000);

  const run = await call("sse_checker_run", { hwnd }, 240_000);
  assert.equal(run.konsistent, true, `${id}: checker_run lieferte einen inkonsistenten Ergebnisbaum.`);
  assert.equal(typeof run.gesamt, "number", `${id}: checker_run ohne numerisches gesamt.`);
  assert(run.gesamt > 0, `${id}: checker_run lieferte gesamt <= 0.`);
  // Engine 30 vermerkt den Prueflauf im Dokument und setzt dabei den
  // Ungespeichert-Zustand; Engine 31 tut das nicht. Die Datei aendert sich in
  // beiden Faellen nicht - der Schlusshash dieses Tests belegt das. Erwartet
  // wird deshalb der im Profil hinterlegte Wert, nicht pauschal "false":
  // so faellt sowohl ein neues Dirty-Verhalten in 31 als auch ein
  // verschwundenes in 30 auf.
  assert.equal(run.ungespeichertEingefuehrt, definition.checkerMarksCaseModified === true,
    `${id}: checker_run verhielt sich beim Ungespeichert-Zustand anders als im Profil erwartet.`);

  const results = await call("sse_checker_results", { hwnd }, 180_000);
  assert.equal(results.gesamt, run.gesamt, `${id}: checker_results.gesamt weicht von checker_run.gesamt ab.`);

  const closed = await call("sse_checker_close", { hwnd }, 90_000);
  assert.equal(closed.ok, true, `${id}: checker_close meldete keinen Erfolg.`);

  return run.gesamt;
}

async function unlinkOwned(path) {
  assert(dirname(path) === testCaseDir && basename(path).startsWith("sse-muster-live-"),
    `Cleanup verweigert fremdes Ziel: ${path}`);
  for (let attempt = 0; attempt < 20; attempt++) {
    if (!existsSync(path)) return;
    try { unlinkSync(path); } catch (error) {
      if (!error || !["EBUSY", "EPERM"].includes(error.code)) throw error;
    }
    await wait(250);
  }
  assert(!existsSync(path), `Testkopie blieb gesperrt: ${path}`);
}

function classifyStartupDialog(dialog) {
  const text = (dialog.texts ?? []).join(" ");
  if (dialog.title === "Steuerprogramm" && text.toLowerCase().includes("wiederherstell") &&
      (dialog.buttons ?? []).some((button) => button.name === "Nein")) return "Nein";
  if (dialog.title === "Aktualisierung fehlgeschlagen!" && text.includes("importierte Steuerfall") &&
      (dialog.buttons ?? []).some((button) => button.name.toLowerCase() === "ok")) return "OK";
  if (dialog.title === "Gewinn aktualisiert!" && /^Der Gewinn des Betriebs ».+« wurde aktualisiert\.$/u.test(text) &&
      (dialog.buttons ?? []).length === 1 && dialog.buttons[0].name === "OK") return "OK";
  return null;
}

async function dismissBoundStartupDialogs(pid) {
  for (let round = 0; round < 4; round++) {
    const listed = await call("sse_dialog_list", { pid });
    const dialogs = (listed.dialogs ?? []).filter((dialog) =>
      dialog.kind === "native-dialog" || dialog.kind === "qt-dialog");
    if (!dialogs.length) return;
    assert.equal(dialogs.length, 1, `Mehrdeutige Startdialoge: ${JSON.stringify(dialogs)}`);
    const button = classifyStartupDialog(dialogs[0]);
    assert(button, `Unerwarteter Startdialog; nichts beantwortet: ${JSON.stringify(dialogs[0])}`);
    await call("sse_dialog_answer", {
      hwnd: dialogs[0].hwnd, fingerprint: dialogs[0].fingerprint, button,
    });
  }
  throw new Error("Startdialog-Kette ueberschritt vier strikt gebundene Antworten.");
}

const observations = [];
const startedAt = Date.now();
await client.connect(transport);
try {
  assert.equal((await call("sse_health")).running, false,
    "Live-Muster-Test startet nur ohne vorhandene SSE-Instanz.");
  for (const definition of definitions) {
    const source = join(musterDir, definition.file);
    const suffix = `${process.pid}-${Date.now()}${extname(source)}`;
    const stagedSource = join(testCaseDir, `sse-muster-live-${definition.id}-source-${suffix}`);
    const target = join(testCaseDir, `sse-muster-live-${definition.id}-working-${suffix}`);
    const sourceRef = `cases:${basename(stagedSource)}`;
    const targetRef = `cases:${basename(target)}`;
    const sourceHash = sha256(source);
    let instance = null;
    let launchedPid = null;
    let primaryError = null;
    try {
      copyFileSync(source, stagedSource);
      const staged = await call("sse_case_hash", { ref: sourceRef });
      assert.equal(staged.sha256, sourceHash, `${definition.id}: staging hash`);
      await call("sse_make_working_copy", { sourceRef, targetRef, expectedSourceHash: sourceHash });
      const working = await call("sse_case_hash", { ref: targetRef });
      assert.equal(working.sha256, sourceHash, `${definition.id}: working-copy hash`);

      const launched = await call("sse_launch", { caseRef: targetRef, mode: definition.mode }, 120_000);
      launchedPid = launched.pid;
      instance = launched.instance ?? null;
      await dismissBoundStartupDialogs(launchedPid);
      const state = await call("sse_ui_state", instance?.hwnd ? { hwnd: instance.hwnd } : {});
      instance = state.instance;
      assert(Number.isInteger(instance?.pid) && Number.isInteger(instance?.hwnd),
        `${definition.id}: SSE-Instanz ist nicht eindeutig gebunden.`);
      const page = await call("sse_page", { hwnd: instance.hwnd });
      const result = await call(definition.operation, { hwnd: instance.hwnd }, 300_000);
      assertExpectedResultRows(definition, result);
      await assertReadOnlyOperationSweep(definition, instance.hwnd);
      const observation = {
        id: definition.id,
        file: definition.file,
        page: page.ueberschrift,
        operation: definition.operation,
        result,
      };
      if (definition.ustva) {
        const ustvaPage = definition.ustva.page;
        const navigation = await call("sse_goto", {
          name: ustvaPage, maxSteps: 200, useSearch: true, hwnd: instance.hwnd,
        }, 300_000);
        assert(navigation.erreicht === true && navigation.ueberschrift === ustvaPage,
          `${definition.id}: UStVA-Uebersicht wurde nicht erreicht: ${JSON.stringify(navigation)}`);
        observation.ustva = await call("sse_ustva_read", { hwnd: instance.hwnd }, 300_000);
        assertExpectedUstva(observation.ustva, definition.ustva);
      }
      if (definition.checker) {
        observation.checkerGesamt = await runCheckerSweep(definition, instance.hwnd);
      }
      observations.push(observation);
      if (process.env.SSE_LIVE_MUSTER_PROBE === "1") {
        process.stdout.write(`${JSON.stringify({ observation }, null, 2)}\n`);
      }
    } catch (error) {
      primaryError = error;
      throw error;
    } finally {
      const cleanupErrors = [];
      if (instance?.pid && instance?.hwnd) {
        try {
          const closed = await callRaw("sse_close", {
            pid: instance.pid, hwnd: instance.hwnd, force: true, discardChanges: true,
          }, 90_000);
          if (closed?.isError) cleanupErrors.push(`sse_close: ${fullText(closed)}`);
        } catch (error) { cleanupErrors.push(`sse_close: ${error.message}`); }
      } else if (launchedPid) {
        try {
          const closed = await callRaw("sse_close", { pid: launchedPid, force: true, discardChanges: true }, 90_000);
          if (closed?.isError) cleanupErrors.push(`sse_close: ${fullText(closed)}`);
        } catch (error) { cleanupErrors.push(`sse_close: ${error.message}`); }
      }
      assert.equal(sha256(source), sourceHash, `${definition.id}: offizieller Musterfall wurde veraendert.`);
      await unlinkOwned(target);
      await unlinkOwned(stagedSource);
      const stillRunning = (await call("sse_health")).running;
      if (stillRunning) cleanupErrors.push(`${definition.id}: eigene SSE-Instanz blieb nach discard-close aktiv.`);
      if (cleanupErrors.length) {
        const cleanupMessage = cleanupErrors.join(" ");
        if (primaryError instanceof Error) primaryError.message += ` Cleanup: ${cleanupMessage}`;
        else throw new Error(cleanupMessage);
      }
    }
  }
} finally {
  try { await client.close(); } catch { }
}

process.stdout.write(`${JSON.stringify({
  ok: true,
  cases: observations.map((observation) => ({
    id: observation.id,
    file: observation.file,
    resultRows: observation.result.anzahl,
    ustvaPage: observation.ustva?.page ?? null,
    checkerGesamt: observation.checkerGesamt ?? null,
  })),
  semanticChecks,
  durationMs: Date.now() - startedAt,
}, null, 2)}\n`);
