/**
 * Opt-in Live-Regression gegen die mit SSE 2025 ausgelieferten Musterfaelle.
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

const defaultMusterDir = "C:\\Program Files\\Steuertipps\\SteuerSparErklaerung\\Steuerjahr 2025\\musterfaelle";
const musterDir = process.env.SSE_MUSTER_DIR ?? defaultMusterDir;
const testCaseDir = process.env.SSE_TEST_CASE_DIR;
if (!testCaseDir) throw new Error("SSE_TEST_CASE_DIR aus dem isolierten Test-API-Wrapper fehlt.");

const allDefinitions = [
  { id: "est", file: "MusterSteuer1.ESt2025", mode: "normal", operation: "sse_result_details" },
  { id: "gew", file: "MusterGewinnermittlung.Gew2025", mode: "einur", operation: "sse_result_details" },
];
const requestedIds = new Set((process.env.SSE_LIVE_MUSTER_CASES ?? "")
  .split(",").map((id) => id.trim()).filter(Boolean));
const knownIds = new Set(allDefinitions.map(({ id }) => id));
for (const id of requestedIds) assert(knownIds.has(id), `Unbekannter Live-Musterfall: ${id}`);
const definitions = requestedIds.size
  ? allDefinitions.filter(({ id }) => requestedIds.has(id))
  : allDefinitions;

const expectedResultRows = {
  est: [
    ["Erstattung", "3.540,63 €"],
    ["Werbungskosten Heinz", "2.140,00 €"],
    ["Werbungskosten Eva", "4.011,00 €"],
    ["Summe der Einkünfte", "49.725,00 €"],
    ["Abziehbare Vorsorgeaufwendungen", "6.657,00 €"],
    ["Einkommen", "37.080,00 €"],
    ["Zu versteuerndes Einkommen", "36.860,00 €"],
    ["Anzahl der Kinder", "2 Kinder"],
  ],
  gew: [
    ["Einnahmen (ohne private Nutzung)", "24.098,48 €"],
    ["Als Einnahmen anzusetzende private Nutzungsanteile", "794,57 €"],
    ["Summe der Betriebseinnahmen", "24.893,05 €"],
    ["Fahrzeugkosten", "5.593,09 €"],
    ["Abschreibungen", "3.367,35 €"],
    ["Fremdleistungen", "8.500,00 €"],
    ["Arbeitszimmer", "1.173,23 €"],
  ],
};
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

function assertExpectedResultRows(id, result) {
  assert.equal(result.vollstaendig, true, `${id}: Ergebnisliste ist nicht vollstaendig.`);
  assert.deepEqual(result.unvollstaendigeZeilen, [], `${id}: unvollstaendige Ergebniszeilen.`);
  assert.deepEqual(result.vergleichsInvariantFehler, [], `${id}: Vergleichsinvariante verletzt.`);
  const rows = new Map((result.zeilen ?? []).map((row) => [row.beobachteterWert, row.aktuell]));
  for (const [label, expected] of expectedResultRows[id]) {
    assertSemanticEqual(rows.get(label), expected, `${id}: ${label}`);
  }
}

function assertExpectedUstva(ustva) {
  assert.equal(ustva.ok, true, "UStVA: Snapshot ist nicht erfolgreich.");
  assert.equal(ustva.page, "Umsatzsteuer-Voranmeldungen 2025", "UStVA: falsche Seite.");
  assertSemanticEqual(`${ustva.period.frequency}:${ustva.period.key}`, "quarterly:q1", "UStVA: Zeitraum");
  assertSemanticEqual(ustva.amounts.taxable19.base.cents, 1_012_000, "UStVA: 19%-Bemessungsgrundlage");
  assertSemanticEqual(ustva.amounts.taxable19.tax.cents, 192_280, "UStVA: 19%-Steuer");
  assertSemanticEqual(ustva.amounts.inputTax.cents, -13_470, "UStVA: Vorsteuer");
  assertSemanticEqual(
    `${ustva.amounts.settlement.kind}:${ustva.amounts.settlement.cents}`,
    "payment:178810",
    "UStVA: Zahllast",
  );
  assert.equal(ustva.transmission.blockedByApi, true, "UStVA: API-Versandsperre fehlt.");
  assert.equal(ustva.effects.savePerformed, false, "UStVA: Leseweg hat gespeichert.");
  assert.equal(ustva.effects.submissionPerformed, false, "UStVA: Leseweg hat uebermittelt.");
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
      assertExpectedResultRows(definition.id, result);
      const observation = {
        id: definition.id,
        file: definition.file,
        page: page.ueberschrift,
        operation: definition.operation,
        result,
      };
      if (definition.id === "gew") {
        const ustvaPage = "Umsatzsteuer-Voranmeldungen 2025";
        const navigation = await call("sse_goto", {
          name: ustvaPage, maxSteps: 200, useSearch: true, hwnd: instance.hwnd,
        }, 300_000);
        assert(navigation.erreicht === true && navigation.ueberschrift === ustvaPage,
          `gew: UStVA-Uebersicht wurde nicht erreicht: ${JSON.stringify(navigation)}`);
        observation.ustva = await call("sse_ustva_read", { hwnd: instance.hwnd }, 300_000);
        assertExpectedUstva(observation.ustva);
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
  })),
  semanticChecks,
  durationMs: Date.now() - startedAt,
}, null, 2)}\n`);
