/**
 * case_create ist eine Komposition ueber den verschachtelten API-Executor.
 * Ein Skript-Worker antwortet pro Operation deterministisch; damit sind die
 * Schrittfolge, jeder Guard, das Cleanup vor dem Speichern und das
 * Nicht-Loeschen nach dem Speichern exakt pruefbar - ohne SSE und ohne Mock-
 * Zustandsmaschine.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApiExecutor } from "../dist/api-executor.js";
import { executeCaseCreate } from "../dist/case-create-executor.js";
import { WorkerError } from "../dist/worker.js";

const temporary = mkdtempSync(join(tmpdir(), "sse-case-create-"));
const caseDir = join(temporary, "cases");
mkdirSync(caseDir, { recursive: true });
const config = {
  host: "127.0.0.1",
  port: 1,
  configPath: join(temporary, "config.json"),
  caseDir,
  workspaceDir: join(temporary, "workspace"),
  resultDir: join(temporary, "results"),
  sseExecutable: "C:\\Program Files\\Steuertipps\\SteuerSparErklaerung\\Steuerjahr 2025\\SSE.exe",
};
const PID = 5150;
const HWND = 9101;
const HASH = "C".repeat(64);
const START_PAGE = "Gewinn-Erfassung für das Jahr 2026";
const MODE_PAGE = "Beginn der Datenbearbeitung";
const MASTER_PAGE = "Allgemeine Angaben zum Unternehmen";
const SAVE_ENTRY = "Speichern unter... Strg+Alt+S";
const SAVE_TITLE = "Gewinn-Erfassung speichern";
const TARGET = "cases:neu.GewErfass2026";
const targetPath = join(caseDir, "neu.GewErfass2026");
const saveDialog = { hwnd: 7001, pid: PID, cls: "#32770", kind: "native-dialog", title: SAVE_TITLE,
  buttons: [], texts: [], fingerprint: "D".repeat(64) };

const instance = (extra = {}) => ({
  ok: true, count: 1, ambiguous: false, foregroundHwnd: HWND,
  instances: [{ hwnd: HWND, pid: PID, title: "Gewinn-Erfassung 2026: SteuerSparErklärung", hung: false, recoveredState: false, ...extra }],
});
const noInstance = { ok: true, count: 0, instances: [], ambiguous: false, foregroundHwnd: null };

/** Ein Skript-Worker: Antworten je Operation, optional als Funktion ueber die Argumente. */
function scriptedWorker(overrides = {}, calls = []) {
  let instanceCalls = 0;
  const defaults = {
    instances: (args) => {
      instanceCalls += 1;
      if (instanceCalls === 1) return noInstance;
      if (args.includeHash === true) {
        writeFileSync(targetPath, "neu");
        return instance({ caseName: "neu.GewErfass2026", caseSha256: HASH, casePath: targetPath });
      }
      return instance();
    },
    desktop_status: () => ({ ok: true, aktiv: false, desktop: null, sseLaeuft: false }),
    launch: () => ({ ok: true, launched: true, pid: PID, ready: true, blockedByDialog: false }),
    launch_probe: () => ({
      ok: true, outcome: "observed", dialogs: [],
      windows: [{ pid: PID, hwnd: HWND, title: "Steuerprogramm", w: 1200, h: 800, minimiert: false }],
    }),
    ui_state: () => ({ ok: true, running: true, heading: START_PAGE, blockiert: false, instance: { pid: PID, hwnd: HWND } }),
    subpages: () => ({
      ok: true, anzahl: 2,
      unterseiten: [
        { schalter: "Jetzt beginnen", typ: "Hyperlink", rid: "42.1.4.-1", aktiviert: true },
        { schalter: "Daten übernehmen", typ: "Hyperlink", rid: "42.1.4.-2", aktiviert: true },
      ],
    }),
    click: (args) => ({
      ok: true, clicked: String(args.name ?? args.aid ?? args.rid), verified: true,
      ueberschriftVorher: String(args.expectedPageBefore ?? ""),
      ueberschriftNachher: String(args.expectedPageAfter ?? args.expectedPageBefore ?? ""),
    }),
    menu: () => ({
      ok: true, menue: "Datei", anzahl: 2,
      eintraege: [{ name: "Steuerfall öffnen...", aktiv: true, gesperrt: false }, { name: SAVE_ENTRY, aktiv: true, gesperrt: false }],
    }),
    menu_click: () => ({ ok: true, ausgeloest: SAVE_ENTRY, fenster: 2 }),
    menu_close: () => ({ ok: true, collapsed: ["Datei"], verified: true }),
    dialog_list: () => ({
      ok: true, count: 1,
      dialogs: [saveDialog], windows: [saveDialog],
    }),
    file_dialog_select: () => ({ ok: true, selected: targetPath, sha256: HASH, mode: "save-new", dialogClosed: true, verified: true }),
    close: () => ({ ok: true, closed: true, killed: true, stillRunning: false }),
    product_info: () => ({ ok: true, supportedRunning: [], ignoredRunning: [] }),
  };
  const table = { ...defaults, ...overrides };
  const worker = async (operation, args, timeoutMs) => {
    calls.push({ operation, args, timeoutMs });
    const handler = table[operation];
    assert(handler, `Skript-Worker kennt '${operation}' nicht.`);
    return typeof handler === "function" ? handler(args) : handler;
  };
  return { worker, calls };
}

const operationsOf = (calls) => calls.map((entry) => entry.operation);
const closes = (calls) => calls.filter((entry) => entry.operation === "close");
const resetTarget = () => rmSync(targetPath, { force: true });
const emptyStartupDialogs = { ok: true, count: 0, dialogs: [], windows: [] };

try {
  for (const failure of [
    { outcomeUnknown: true, inputDispatched: true },
    { outcomeUnknown: true, inputDispatched: null },
    { outcomeUnknown: false, reconciliationRequired: true, inputDispatched: false },
    { outcomeUnknown: true, reconciliationRequired: true, processStillRunning: false },
    { processPreserved: true },
    { kind: "interference", inputDispatched: false, outcomeUnknown: false, reconciliationRequired: false },
  ]) {
    const clickBinding = { x: 30, y: 30, clickCount: 1 };
    const { worker, calls } = scriptedWorker({ click: () => ({
      ok: false, kind: "navigation-blocked", error: "Synthetic first click failed.", clickBinding, ...failure,
    }) });
    const result = await createApiExecutor(config, worker)("case_create", { targetRef: TARGET, mode: "einurvor" }, 240_000);
    assert.equal(result.ok, false);
    assert.equal(result.kind, failure.kind ?? "navigation-blocked");
    assert.equal(result.error, "Synthetic first click failed.");
    assert.equal(result.outcomeUnknown, failure.outcomeUnknown);
    assert.equal(result.inputDispatched, failure.inputDispatched);
    assert.deepEqual(result.clickBinding, clickBinding);
    assert.equal(result.processPreserved, true);
    assert.equal(result.processStillRunning, failure.processStillRunning ?? null);
    assert.equal(result.reconciliationRequired, true);
    assert.equal(result.retryable, false);
    assert.equal(result.failedStep, "click");
    assert.equal(result.pid, PID);
    assert.equal(result.created, false);
    assert.deepEqual(operationsOf(calls), [
      "instances", "desktop_status", "launch", "launch_probe", "instances", "ui_state", "subpages", "click",
    ], "Ein ungewisser oder fremd beeinflusster Fall darf weder weiter bedient noch automatisch verworfen werden.");
  }
  for (const failure of [
    { kind: "precondition-failed", inputDispatched: false, outcomeUnknown: false, reconciliationRequired: false },
    { kind: "timeout", inputDispatched: false, outcomeUnknown: false, reconciliationRequired: false },
  ]) {
    const { worker, calls } = scriptedWorker({ click: () => ({
      ok: false, error: "Synthetic known-unsent failure.", ...failure,
    }) });
    const result = await createApiExecutor(config, worker)("case_create", { targetRef: TARGET, mode: "einurvor" }, 240_000);
    assert.equal(result.kind, failure.kind);
    assert.equal(result.outcomeUnknown, false);
    assert.equal(result.reconciliationRequired, false);
    assert.deepEqual(operationsOf(calls).slice(-2), ["close", "product_info"]);
    assert.deepEqual(closes(calls).map(entry => entry.args), [{ pid: PID, force: true, discardChanges: true }]);
  }
  {
    const { worker, calls } = scriptedWorker({ click: () => { throw new Error("Synthetic click response lost."); } });
    const result = await executeCaseCreate({ targetRef: TARGET, mode: "einurvor" }, 240_000, undefined, {
      execute: worker, worker, resolveTarget: () => ({ path: targetPath, ref: TARGET }),
      profile: { taxYear: 2025, startModes: { einurvor: "GewErfass" }, additionalCaseYears: { einurvor: [2026] } },
    });
    assert.equal(result.error, "Synthetic click response lost.");
    assert.equal(result.failedStep, "click");
    assert.equal(result.processPreserved, true);
    assert.equal(result.processStillRunning, null);
    assert.equal(result.outcomeUnknown, true);
    assert.equal(result.reconciliationRequired, true);
    assert.equal(result.retryable, false);
    assert.equal(closes(calls).length, 0);
    assert.equal(calls.filter(entry => entry.operation === "product_info").length, 0);
    assert.equal(calls.filter(entry => entry.operation === "click").length, 1);
  }
  for (const kind of ["timeout", "aborted", "parse", "empty", "output-too-large", "worker", "worker-isolation-lost", "worker-transport-cleanup", "spawn"]) {
    const { worker, calls } = scriptedWorker({ click: () => {
      throw new WorkerError("Synthetic worker response lost through the API executor.", kind);
    } });
    const result = await createApiExecutor(config, worker)("case_create", { targetRef: TARGET, mode: "einurvor" }, 240_000);
    assert.equal(result.kind, kind);
    assert.equal(result.error, "Synthetic worker response lost through the API executor.");
    assert.equal(result.failedStep, "click");
    assert.equal(result.processPreserved, true);
    assert.equal(result.processStillRunning, null);
    assert.equal(result.outcomeUnknown, true);
    assert.equal(result.reconciliationRequired, true);
    assert.equal(result.retryable, false);
    assert.equal(closes(calls).length, 0);
    assert.equal(calls.filter(entry => entry.operation === "product_info").length, 0);
    assert.equal(calls.filter(entry => entry.operation === "click").length, 1);
  }
  for (const [operation, failure] of ["menu_click", "dialog_list"].flatMap(operation => [
    [operation, { kind: "interference", outcomeUnknown: false, reconciliationRequired: false }],
    [operation, { kind: "precondition-failed", outcomeUnknown: true }],
    [operation, { kind: "precondition-failed", outcomeUnknown: false, reconciliationRequired: true }],
  ])) {
    const { worker, calls } = scriptedWorker({ [operation]: () => ({
      ok: false, error: "Synthetic save-dialog ownership lost.", ...failure,
    }) });
    const result = await executeCaseCreate({ targetRef: TARGET, mode: "einurvor" }, 240_000, undefined, {
      execute: worker, worker, resolveTarget: () => ({ path: targetPath, ref: TARGET }),
      profile: { taxYear: 2025, startModes: { einurvor: "GewErfass" }, additionalCaseYears: { einurvor: [2026] } },
    });
    assert.equal(result.error, "Synthetic save-dialog ownership lost.");
    assert.equal(result.failedStep, operation);
    assert.equal(result.processPreserved, true);
    assert.equal(result.outcomeUnknown, failure.outcomeUnknown);
    assert.equal(operationsOf(calls).at(-1), operation);
    assert.equal(calls.filter(entry => ["menu_close", "close", "product_info", "file_dialog_select"].includes(entry.operation)).length, 0);
  }
  for (const operation of ["menu_click", "dialog_list"]) {
    const { worker, calls } = scriptedWorker({ [operation]: () => { throw new Error("Synthetic save-dialog response lost."); } });
    const result = await executeCaseCreate({ targetRef: TARGET, mode: "einurvor" }, 240_000, undefined, {
      execute: worker, worker, resolveTarget: () => ({ path: targetPath, ref: TARGET }),
      profile: { taxYear: 2025, startModes: { einurvor: "GewErfass" }, additionalCaseYears: { einurvor: [2026] } },
    });
    assert.equal(result.failedStep, operation);
    assert.equal(result.outcomeUnknown, true);
    assert.equal(result.processPreserved, true);
    assert.equal(operationsOf(calls).at(-1), operation);
    assert.equal(calls.filter(entry => ["menu_close", "close", "product_info", "file_dialog_select"].includes(entry.operation)).length, 0);
  }
  {
    const { worker, calls } = scriptedWorker({ ui_state: () => ({
      ok: true, running: true, heading: "", blockiert: false, instance: { pid: PID, hwnd: HWND },
    }) });
    const result = await executeCaseCreate({ targetRef: TARGET, mode: "einurvor" }, 240_000, undefined, {
      execute: worker, worker, resolveTarget: () => ({ path: targetPath, ref: TARGET }),
      profile: { taxYear: 2025, startModes: { einurvor: "GewErfass" }, additionalCaseYears: { einurvor: [2026] } },
      wait: async () => { throw new Error("Synthetic wait failed outside a step."); },
    });
    assert.equal(result.failedStep, "case-create", "Ein Fehler ausserhalb eines Aufrufs darf keinen erfolgreichen Schritt beschuldigen.");
    assert.equal(result.outcomeUnknown, undefined, "Ohne laufenden Aufruf darf kein verlorener Eingabeausgang erfunden werden.");
    assert.equal(result.processPreserved, true);
    assert.equal(result.processStillRunning, null);
    assert.equal(closes(calls).length, 0);
  }
  for (const { stop, expectedKind } of [
    { stop: (controller, clock) => controller.abort(), expectedKind: "aborted" },
    { stop: (controller, clock) => { clock.value = 239_000; }, expectedKind: "timeout" },
  ]) {
    const controller = new AbortController(); const clock = { value: 0 };
    const { worker, calls } = scriptedWorker({ menu_click: () => { stop(controller, clock); return { ok: true }; } });
    const result = await executeCaseCreate({ targetRef: TARGET, mode: "einurvor" }, 240_000, controller.signal, {
      execute: worker, worker, resolveTarget: () => ({ path: targetPath, ref: TARGET }),
      profile: { taxYear: 2025, startModes: { einurvor: "GewErfass" }, additionalCaseYears: { einurvor: [2026] } },
      now: () => clock.value,
    });
    assert.equal(result.kind, expectedKind);
    assert.equal(result.processPreserved, true);
    assert.equal(result.cleanup.operation, "menu_close");
    assert.equal(result.cleanup.kind, expectedKind);
    assert.equal(operationsOf(calls).at(-1), "menu_click");
    assert.equal(calls.filter(entry => ["menu_close", "close", "product_info", "file_dialog_select"].includes(entry.operation)).length, 0);
  }
  for (const menuClose of [
    () => ({ ok: false, kind: "interference", error: "Synthetic menu cleanup interference.", outcomeUnknown: true }),
    () => ({ ok: false, kind: "precondition-failed", error: "Synthetic menu remains open." }),
    () => ({ ok: true, outcomeUnknown: true }),
    () => { throw new Error("Synthetic menu cleanup response lost."); },
  ]) {
    let clock = 0;
    const { worker, calls } = scriptedWorker({
      dialog_list: () => ({ ok: true, count: 0, dialogs: [], windows: [] }), menu_close: menuClose,
    });
    const result = await executeCaseCreate({ targetRef: TARGET, mode: "einurvor" }, 240_000, undefined, {
      execute: worker, worker, resolveTarget: () => ({ path: targetPath, ref: TARGET }),
      profile: { taxYear: 2025, startModes: { einurvor: "GewErfass" }, additionalCaseYears: { einurvor: [2026] } },
      now: () => clock, wait: async ms => { clock += ms; },
    });
    assert.equal(result.kind, "save-dialog", "Ein Bereinigungsfehler darf den primaeren Fehler nicht ersetzen.");
    assert.match(result.error, /nativen Dialog/u);
    assert.equal(result.processPreserved, true);
    assert.equal(result.processStillRunning, null);
    assert.equal(result.reconciliationRequired, true);
    assert.equal(result.retryable, false);
    assert.equal(result.cleanup.operation, "menu_close");
    assert.equal(calls.filter(entry => entry.operation === "menu_close").length, 1);
    assert.equal(closes(calls).length, 0);
    assert.equal(calls.filter(entry => entry.operation === "product_info").length, 0);
  }
  {
    // 1 Erfolg: exakte Schrittfolge, Bindung, Redaktion, kein Cleanup.
    const { worker, calls } = scriptedWorker();
    const execute = createApiExecutor(config, worker);
    const result = await execute("case_create", { targetRef: TARGET, mode: "einurvor" }, 240_000);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual(operationsOf(calls), [
      "instances", "desktop_status", "launch", "launch_probe", "instances", "ui_state", "subpages",
      "click", "click", "click", "menu", "menu_click", "dialog_list", "file_dialog_select", "instances",
    ]);
    assert.equal(result.created, true);
    assert.equal(result.caseRef, TARGET);
    assert.equal(result.sha256, HASH);
    assert.equal(result.pid, PID);
    assert.equal(result.hwnd, HWND);
    assert.equal(result.mode, "einurvor");
    assert.equal(result.taxYear, 2026);
    assert.equal(result.heading, MASTER_PAGE);
    assert.deepEqual(result.effects, { taxDataChanged: false, savePerformed: true, submissionPerformed: false });
    assert.deepEqual(result.steps, operationsOf(calls).filter((operation) => operation !== "launch_probe"));
    assert.equal(closes(calls).length, 0, "Erfolg darf nichts schliessen");
    assert(!JSON.stringify(result).includes(caseDir), "Kein lokaler Pfad darf die API verlassen");
    const clicks = calls.filter((entry) => entry.operation === "click").map((entry) => entry.args);
    assert.equal(clicks[0].name, "Jetzt beginnen");
    assert.equal(clicks[0].type, "Hyperlink");
    assert.equal(clicks[0].rid, undefined, "A recycled GuideViewer RuntimeId must not select an anonymous button.");
    assert.equal(clicks[0].expectedPageBefore, START_PAGE);
    assert.equal(clicks[0].expectedPageAfter, MODE_PAGE);
    assert.equal(clicks[1].aid, "btnNavigatormodusEinURVor");
    assert.equal(clicks[2].name, "Weiter");
    assert.equal(clicks[2].expectedPageAfter, MASTER_PAGE);
    const select = calls.find((entry) => entry.operation === "file_dialog_select").args;
    assert.equal(select.expectedDialogTitle, SAVE_TITLE);
    assert.equal(select.expectedPath, targetPath, "Der Speicherdialog bekommt den lokal aufgeloesten Zielpfad");
    assert.equal(calls.find((entry) => entry.operation === "launch").args.file, undefined, "Start ohne Datei");
    assert.equal(calls.find((entry) => entry.operation === "dialog_list").args.pid, PID);
    resetTarget();
  }

  {
    // Ein modal oeffnender Menueklick darf den Dialog erst beim zweiten
    // Readback liefern; die Fallanlage wartet auf genau den gebundenen Titel.
    let dialogReads = 0;
    const { worker, calls } = scriptedWorker({
      dialog_list: () => {
        dialogReads += 1;
        return { ok: true, count: dialogReads === 1 ? 0 : 1, dialogs: dialogReads === 1 ? [] : [
          { hwnd: 7001, pid: PID, kind: "native-dialog", title: SAVE_TITLE },
        ] };
      },
    });
    const result = await createApiExecutor(config, worker)("case_create", { targetRef: TARGET, mode: "einurvor" }, 240_000);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(dialogReads, 2);
    assert.equal(calls.find((entry) => entry.operation === "menu_click").args.waitMs, 100);
    assert.equal(closes(calls).length, 0);
    resetTarget();
  }

  {
    // Der Dateidialog kann vor dem aktualisierten Fenstertitel schliessen.
    // Ein alter Titel beim ersten Readback darf keine erstellte Datei als
    // Fehler zuruecklassen.
    let savedReads = 0;
    let allReads = 0;
    const { worker, calls } = scriptedWorker({
      instances: (args) => {
        allReads += 1;
        if (allReads === 1) return noInstance;
        if (args.includeHash === true) {
          savedReads += 1;
          writeFileSync(targetPath, "neu");
          return instance({ caseName: savedReads === 1 ? "Gewinn-Erfassung 2026" : "neu.GewErfass2026", caseSha256: HASH });
        }
        return instance();
      },
    });
    const result = await createApiExecutor(config, worker)("case_create", { targetRef: TARGET, mode: "einurvor" }, 240_000);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(savedReads, 2);
    assert.equal(calls.filter((entry) => entry.operation === "instances" && entry.args.includeHash === true).length, 2);
    resetTarget();
  }

  {
    // 2 Offene Instanz: nichts starten.
    const { worker, calls } = scriptedWorker({ instances: () => instance() });
    const result = await createApiExecutor(config, worker)("case_create", { targetRef: TARGET, mode: "einurvor" }, 240_000);
    assert.equal(result.kind, "confirmation-required");
    assert.equal(result.created, false);
    assert.deepEqual(operationsOf(calls), ["instances"]);
  }

  {
    // 3 Versteckter Desktop aktiv.
    const { worker, calls } = scriptedWorker({ desktop_status: () => ({ ok: true, aktiv: true, desktop: "sse-x", sseLaeuft: true }) });
    const result = await createApiExecutor(config, worker)("case_create", { targetRef: TARGET, mode: "einurvor" }, 240_000);
    assert.equal(result.kind, "hidden-desktop");
    assert.deepEqual(operationsOf(calls), ["instances", "desktop_status"]);
  }

  {
    // 4 Ziel existiert: kein einziger Worker-Aufruf.
    writeFileSync(targetPath, "vorhanden");
    const { worker, calls } = scriptedWorker();
    const result = await createApiExecutor(config, worker)("case_create", { targetRef: TARGET, mode: "einurvor" }, 240_000);
    assert.equal(result.kind, "target-exists");
    assert.deepEqual(calls, []);
    resetTarget();
  }

  {
    // 5 Falsche Endung fuer den Modus und unbekannter Bereich.
    const { worker, calls } = scriptedWorker();
    const execute = createApiExecutor(config, worker);
    const wrongSuffix = await execute("case_create", { targetRef: "cases:neu.Gew2025", mode: "einurvor" }, 240_000);
    assert.equal(wrongSuffix.kind, "bad-args");
    const wrongArea = await execute("case_create", { targetRef: "backups:neu.GewErfass2026", mode: "einurvor" }, 240_000);
    assert.equal(wrongArea.kind, "bad-args");
    const wrongMode = await execute("case_create", { targetRef: TARGET, mode: "einur" }, 240_000);
    assert.equal(wrongMode.kind, "bad-args");
    assert.deepEqual(calls, []);
  }

  {
    // 6 Falsche Seite nach 'Jetzt beginnen': Cleanup der gestarteten PID.
    const { worker, calls } = scriptedWorker({
      click: (args) => ({ ok: true, ueberschriftVorher: START_PAGE, ueberschriftNachher: args.name === "Jetzt beginnen" ? "Datenübernahme" : MASTER_PAGE }),
    });
    const result = await createApiExecutor(config, worker)("case_create", { targetRef: TARGET, mode: "einurvor" }, 240_000);
    assert.equal(result.kind, "wizard-page");
    assert.equal(result.created, false);
    assert.equal(result.pid, PID);
    assert.equal(result.processStillRunning, false);
    assert.equal(result.cleanup.closed, true);
    assert.deepEqual(closes(calls).map((entry) => entry.args), [{ pid: PID, force: true, discardChanges: true }]);
    assert.equal(operationsOf(calls).at(-1), "product_info");
  }

  {
    // 7 Menueeintrag gesperrt.
    const { worker, calls } = scriptedWorker({
      menu: () => ({ ok: true, menue: "Datei", anzahl: 1, eintraege: [{ name: SAVE_ENTRY, aktiv: true, gesperrt: true }] }),
    });
    const result = await createApiExecutor(config, worker)("case_create", { targetRef: TARGET, mode: "einurvor" }, 240_000);
    assert.equal(result.kind, "menu-entry");
    assert.equal(closes(calls).length, 1);
    assert(!operationsOf(calls).includes("menu_click"));
  }

  {
    // 8 Kein passender nativer Dialog: Menue schliessen, dann Cleanup.
    const { worker, calls } = scriptedWorker({ dialog_list: () => ({ ok: true, count: 0, dialogs: [], windows: [] }) });
    let clock = 0;
    const result = await executeCaseCreate({ targetRef: TARGET, mode: "einurvor" }, 240_000, undefined, {
      execute: worker, worker, resolveTarget: () => ({ path: targetPath, ref: TARGET }),
      profile: { taxYear: 2025, startModes: { einurvor: "GewErfass" }, additionalCaseYears: { einurvor: [2026] } },
      now: () => clock, wait: async (ms) => { clock += ms; },
    });
    assert.equal(result.kind, "save-dialog");
    assert(clock >= 5_000);
    const tail = operationsOf(calls).slice(-4);
    assert.deepEqual(tail, ["dialog_list", "menu_close", "close", "product_info"]);
  }

  {
    // 9 Speicherdialog scheitert vor der Datei: Fehler durchreichen, Cleanup.
    const { worker, calls } = scriptedWorker({
      file_dialog_select: () => ({ ok: false, kind: "postcondition-failed", error: "Dateidialog ist nach der Aktion noch vorhanden." }),
    });
    const result = await createApiExecutor(config, worker)("case_create", { targetRef: TARGET, mode: "einurvor" }, 240_000);
    assert.equal(result.kind, "postcondition-failed");
    assert.equal(result.failedStep, "file_dialog_select");
    assert.equal(result.created, false);
    assert.equal(closes(calls).length, 1);
  }

  {
    // 10 Readback-Hash weicht ab: Datei existiert, also kein Cleanup und created=true.
    let instanceCalls = 0;
    const { worker, calls } = scriptedWorker({
      instances: (args) => {
        instanceCalls += 1;
        if (instanceCalls === 1) return noInstance;
        if (args.includeHash === true) {
          writeFileSync(targetPath, "neu");
          return instance({ caseName: "neu.GewErfass2026", caseSha256: "E".repeat(64) });
        }
        return instance();
      },
    });
    const result = await createApiExecutor(config, worker)("case_create", { targetRef: TARGET, mode: "einurvor" }, 240_000);
    assert.equal(result.kind, "postcondition-failed");
    assert.equal(result.created, true);
    assert.equal(result.caseRef, TARGET);
    assert.equal(result.processStillRunning, true);
    assert.equal(closes(calls).length, 0, "Nach dem Speichern wird nie geschlossen oder geloescht");
    resetTarget();
  }

  {
    // A real launch can succeed in creating a process while a recovery
    // question blocks the wizard. Preserve that state without polling or cleanup.
    const { worker, calls } = scriptedWorker({ launch_probe: () => ({ ok: true, outcome: "observed",
      windows: [{ pid: PID, hwnd: HWND, title: "SteuerSparErklärung", w: 518, h: 260, minimiert: false }],
      dialogs: [{ pid: PID, hwnd: HWND, kind: "qt-dialog", recoveryPrompt: true, requiresCaseBinding: true }],
    }) });
    const result = await createApiExecutor(config, worker)("case_create", { targetRef: TARGET, mode: "einurvor" }, 240_000);
    assert.equal(result.ok, false);
    assert.equal(result.kind, "startup-not-ready");
    assert.equal(result.blockedByDialog, true);
    assert.equal(result.processPreserved, true);
    assert.equal(result.processStillRunning, true);
    assert.equal(result.pid, PID);
    assert.equal(result.created, false);
    assert.equal(result.dialogs[0].recoveryPrompt, true);
    assert.deepEqual(operationsOf(calls), ["instances", "desktop_status", "launch", "launch_probe"]);
  }
  for (const launch of [
    { ready: false }, { ready: undefined }, { ready: true, blockedByDialog: true },
    { ready: true, outcomeUnknown: true }, { ready: true, processPreserved: true },
  ]) {
    const { worker, calls } = scriptedWorker({ launch: () => ({ ok: true, pid: PID, ...launch }) });
    const result = await executeCaseCreate({ targetRef: TARGET, mode: "einurvor" }, 240_000, undefined, {
      execute: worker, worker, resolveTarget: () => ({ path: targetPath, ref: TARGET }),
      profile: { taxYear: 2025, startModes: { einurvor: "GewErfass" }, additionalCaseYears: { einurvor: [2026] } },
    });
    assert.equal(result.kind, "startup-not-ready");
    assert.equal(result.processPreserved, true);
    assert.equal(result.processStillRunning, null);
    assert.equal(result.pid, PID);
    assert.equal(result.created, false);
    assert.equal(result.failedStep, "launch");
    assert.deepEqual(operationsOf(calls), ["instances", "desktop_status", "launch"]);
  }

  for (const instanceState of [{ recoveredState: true }, { hung: true },
    { recoveredState: true, title: "Steuerprogramm" }, { hung: true, title: "Steuerprogramm" }]) {
    let reads = 0;
    const { worker, calls } = scriptedWorker({ instances: () => ++reads === 1 ? noInstance : instance(instanceState) });
    const result = await createApiExecutor(config, worker)("case_create", { targetRef: TARGET, mode: "einurvor" }, 240_000);
    assert.equal(result.kind, instanceState.recoveredState ? "recovered-state" : "startup-not-ready");
    assert.equal(result.processPreserved, true);
    assert.equal(result.processStillRunning, true);
    assert.equal(result.pid, PID);
    assert.equal(result.failedStep, "instances");
    assert.equal(calls.filter(entry => entry.operation === "ui_state").length, 0);
    assert.equal(closes(calls).length, 0);
    assert.deepEqual(operationsOf(calls), ["instances", "desktop_status", "launch", "launch_probe", "instances"]);
  }
  {
    const { worker, calls } = scriptedWorker({ ui_state: () => ({ ok: true, heading: START_PAGE, blockiert: true }) });
    const result = await createApiExecutor(config, worker)("case_create", { targetRef: TARGET, mode: "einurvor" }, 240_000);
    assert.equal(result.kind, "startup-not-ready");
    assert.equal(result.processPreserved, true);
    assert.equal(result.processStillRunning, true);
    assert.equal(result.failedStep, "ui_state");
    assert.deepEqual(operationsOf(calls), ["instances", "desktop_status", "launch", "launch_probe", "instances", "ui_state"]);
  }
  for (const spec of [
    { kind: "startup-question", title: "SteuerSparErklärung", width: 518, outcome: "deadline" },
    { kind: "recovered-state", title: "SteuerSparErklärung (Wiederhergestellt)", width: 1200, outcome: "observed" },
    { kind: "startup-timeout", title: "SteuerSparErklärung (Wiederhergestellt)", width: 1200, outcome: "deadline" },
    { kind: "startup-timeout", title: null, width: 0, outcome: "deadline" },
  ]) {
    const { worker, calls } = scriptedWorker({ launch_probe: () => ({ ok: true, outcome: spec.outcome, dialogs: [],
      windows: spec.title ? [{ pid: PID, hwnd: HWND, title: spec.title, w: spec.width, h: 800, minimiert: false }] : [],
    }) });
    const result = await createApiExecutor(config, worker)("case_create", { targetRef: TARGET, mode: "einurvor" }, 240_000);
    assert.equal(result.kind, spec.kind);
    assert.equal(result.processPreserved, true);
    assert.equal(result.processStillRunning, spec.kind === "startup-timeout" ? null : true);
    assert.equal(result.pid, PID);
    assert.equal(result.created, false);
    assert.equal(result.failedStep, "launch");
    assert.equal(result.reconciliationRequired, true);
    assert.deepEqual(operationsOf(calls), ["instances", "desktop_status", "launch", "launch_probe"]);
  }
  for (const invalidLaunch of [
    () => { throw new Error("Synthetic response lost after launch dispatch"); },
    () => ({ ok: true, ready: true }),
    () => ({ ok: true, ready: true, pid: "not-a-pid" }),
  ]) {
    const { worker, calls } = scriptedWorker({ launch: invalidLaunch });
    const result = await executeCaseCreate({ targetRef: TARGET, mode: "einurvor" }, 240_000, undefined, {
      execute: worker, worker, resolveTarget: () => ({ path: targetPath, ref: TARGET }),
      profile: { taxYear: 2025, startModes: { einurvor: "GewErfass" }, additionalCaseYears: { einurvor: [2026] } },
    });
    assert.equal(result.processPreserved, true);
    assert.equal(result.processStillRunning, null);
    assert.equal(result.outcomeUnknown, true);
    assert.equal(result.reconciliationRequired, true);
    assert.equal(result.retryable, false);
    assert.equal(result.failedStep, "launch");
    assert.equal(result.created, false);
    assert.equal(Object.hasOwn(result, "pid"), false);
    assert.deepEqual(operationsOf(calls), ["instances", "desktop_status", "launch"]);
  }
  for (const spec of [
    { kind: "startup-launch", launch: () => { throw new Error("Synthetic launch worker response lost"); } },
    { kind: "startup-pid", launch: () => ({ ok: true, launched: true }) },
    { kind: "startup-pid", launch: () => ({ ok: true, launched: true, pid: "not-a-pid" }) },
  ]) {
    const { worker, calls } = scriptedWorker({ launch: spec.launch });
    const result = await createApiExecutor(config, worker)("case_create", { targetRef: TARGET, mode: "einurvor" }, 240_000);
    assert.equal(result.kind, spec.kind);
    assert.equal(result.processPreserved, true);
    assert.equal(result.processStillRunning, null);
    assert.equal(result.outcomeUnknown, true);
    assert.equal(result.failedStep, "launch");
    assert.equal(result.reconciliationRequired, true);
    assert.equal(result.retryable, false);
    assert.equal(Object.hasOwn(result, "pid"), false);
    assert.deepEqual(operationsOf(calls), ["instances", "desktop_status", "launch"]);
  }
  for (const spec of [
    { budget: 29_999, consumeAfterDesktop: 0 },
    { budget: 59_999, consumeAfterDesktop: 0 },
    { budget: 89_999, consumeAfterDesktop: 0 },
    { budget: 240_000, consumeAfterDesktop: 210_001 },
  ]) {
    let clock = 0;
    const { worker, calls } = scriptedWorker({ desktop_status: () => {
      clock = spec.consumeAfterDesktop;return { ok: true, aktiv: false };
    } });
    const result = await executeCaseCreate({ targetRef: TARGET, mode: "einurvor" }, spec.budget, undefined, {
      execute: worker, worker, resolveTarget: () => ({ path: targetPath, ref: TARGET }),
      profile: { taxYear: 2025, startModes: { einurvor: "GewErfass" }, additionalCaseYears: { einurvor: [2026] } },
      now: () => clock,
    });
    assert.equal(result.kind, "timeout");
    assert.equal(result.created, false);
    for (const key of ["processPreserved", "processStillRunning", "pid", "outcomeUnknown", "reconciliationRequired", "retryable"]) {
      assert.equal(Object.hasOwn(result, key), false);
    }
    assert.deepEqual(operationsOf(calls), ["instances", "desktop_status"]);
  }
  {
    const { worker, calls } = scriptedWorker({ launch: () => ({ ok: false, kind: "precondition-failed",
      mutationStarted: false, resultingState: "unchanged", outcomeUnknown: false }) });
    const result = await createApiExecutor(config, worker)("case_create", { targetRef: TARGET, mode: "einurvor" }, 240_000);
    assert.equal(result.kind, "precondition-failed");
    assert.equal(result.outcomeUnknown, false);
    assert.notEqual(result.processPreserved, true);
    for (const key of ["processPreserved", "processStillRunning", "pid", "reconciliationRequired", "retryable"]) {
      assert.equal(Object.hasOwn(result, key), false);
    }
    assert.deepEqual(operationsOf(calls), ["instances", "desktop_status", "launch"]);
  }

  {
    // 11 Abbruch vor dem Start: kein Prozess.
    const controller = new AbortController();
    controller.abort();
    const { worker, calls } = scriptedWorker();
    const result = await createApiExecutor(config, worker)("case_create", { targetRef: TARGET, mode: "einurvor" }, 240_000, controller.signal);
    assert.equal(result.kind, "aborted");
    assert.deepEqual(calls, []);
  }

  {
    // 12 Startseite erscheint erst nach einer Wartezeit: das Polling bindet das Fenster erneut.
    let stateCalls = 0;
    const { worker, calls } = scriptedWorker({
      ui_state: () => {
        stateCalls += 1;
        return { ok: true, running: true, heading: stateCalls < 3 ? "" : START_PAGE, blockiert: false, instance: {pid: PID, hwnd: HWND} };
      },
    });
    const result = await createApiExecutor(config, worker)("case_create", { targetRef: TARGET, mode: "einurvor" }, 240_000);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(calls.filter((entry) => entry.operation === "ui_state").length, 3);
    resetTarget();
  }

  // A ready generic startup can disappear behind an own recovery/modal question.
  // These tests use the existing absolute clock; they start no product or real worker.
  async function startupDialogScenario(readback, pollInstances = [noInstance]) {
    let clock = 0, index = 0;
    const inventories = [noInstance, ...pollInstances];
    const { worker, calls } = scriptedWorker({
      instances: () => inventories[Math.min(index++, inventories.length - 1)],
      dialog_list: () => typeof readback === "function" ? readback() : readback,
    });
    const result = await executeCaseCreate({ targetRef: TARGET, mode: "einurvor" }, 90_000, undefined, {
      execute: worker, worker, resolveTarget: () => ({ path: targetPath, ref: TARGET }),
      profile: { taxYear: 2025, startModes: { einurvor: "GewErfass" }, additionalCaseYears: { einurvor: [2026] } },
      now: () => clock, wait: async ms => { clock += ms; },
    });
    return { result, calls, clock };
  }
  const startupMain = { pid: PID, hwnd: HWND - 1, kind: "main", uiaReadOk: false, msaaReadOk: false };
  for (const dialog of [
    { pid: PID, hwnd: HWND + 1, kind: "qt-dialog", recoveryPrompt: true, requiresCaseBinding: true,
      uiaReadOk: true, texts: ["Synthetic recovery question"], fingerprint: "D".repeat(64) },
    { pid: PID, hwnd: HWND + 2, kind: "native-dialog", uiaReadOk: false, msaaReadOk: false,
      uiaError: "Native modal content was not readable" },
  ]) {
    const inventory = { ok: true, count: 2, windows: [startupMain, dialog], dialogs: [dialog] };
    const { result, calls, clock } = await startupDialogScenario(inventory);
    assert.equal(result.kind, "startup-not-ready"); assert.equal(result.failedStep, "dialog_list");
    assert.equal(result.ready, false); assert.equal(result.blockedByDialog, true);
    assert.equal(result.processPreserved, true); assert.equal(result.processStillRunning, true);
    assert.equal(result.outcomeUnknown, true); assert.equal(result.reconciliationRequired, true);
    assert.equal(result.retryable, false); assert.equal(result.created, false); assert.equal(result.pid, PID);
    assert.deepEqual(result.dialogs, inventory.dialogs); assert.deepEqual(result.windows, inventory.windows);
    assert.equal(result.count, 2, "count includes the main window, not only the modal.");
    assert.equal(clock, 0, "A confirmed own modal must not consume the remaining startup polling budget.");
    assert.deepEqual(operationsOf(calls), ["instances", "desktop_status", "launch", "instances", "dialog_list"]);
    assert.deepEqual(calls.at(-1).args, { pid: PID }); assert.equal(calls.at(-1).timeoutMs, 5_000);
    assert.equal(closes(calls).length, 0);
  }
  {
    const dialog = { pid: PID, hwnd: HWND + 3, kind: "qt-dialog", recoveryPrompt: true, requiresCaseBinding: true };
    const inventory = { ok: true, count: 1, windows: [dialog], dialogs: [dialog] };
    let reads = 0;
    const { result, calls, clock } = await startupDialogScenario(
      () => ++reads === 1 ? emptyStartupDialogs : inventory,
      [instance({ title: "Steuerprogramm", hwnd: HWND - 1 }), noInstance],
    );
    assert.equal(result.kind, "startup-not-ready"); assert.equal(result.blockedByDialog, true);
    assert.equal(result.processPreserved, true); assert.equal(result.processStillRunning, true);
    assert.deepEqual(result.dialogs, [dialog]); assert.equal(clock, 1_500); assert.equal(reads, 2);
    assert.deepEqual(operationsOf(calls), ["instances", "desktop_status", "launch", "instances", "dialog_list", "instances", "dialog_list"]);
    assert.equal(closes(calls).length, 0);
  }
  const foreignDialog = { pid: PID + 1, hwnd: HWND + 4, kind: "qt-dialog", recoveryPrompt: true };
  for (const inventory of [
    { ok: true, count: 1, windows: [foreignDialog], dialogs: [foreignDialog] },
    // A modal present in windows must not disappear from the modal payload.
    { ok: true, count: 1, windows: [{ ...startupMain, kind: "qt-dialog" }], dialogs: [] },
    { ok: true, count: 0, windows: [], dialogs: [{ ...startupMain, kind: "qt-dialog" }] },
    { ok: true, count: 1, windows: [], dialogs: [] },
    { ok: true, count: 0, dialogs: [] },
    { ok: true, count: 0, windows: [], dialogs: "unreadable" },
    { ok: true, count: 1, windows: [{ ...startupMain, uiaReadOk: "false" }], dialogs: [] },
    { ok: true, count: 1, windows: [{ ...startupMain, kind: "other", uiaError: "Synthetic unreadable startup window" }], dialogs: [] },
    { ok: true, count: 1, windows: [{ ...startupMain, uiaError: "Synthetic unreadable main inventory" }], dialogs: [] },
    { ...emptyStartupDialogs, outcomeUnknown: true },
  ]) {
    const { result, calls, clock } = await startupDialogScenario(inventory);
    assert.equal(result.kind, "startup-not-ready"); assert.equal(result.failedStep, "dialog_list");
    assert.equal(result.blockedByDialog, null, "Incomplete inventory cannot prove dialog absence."); assert.equal(result.ready, false);
    assert.deepEqual(result.dialogs, inventory.dialogs); assert.deepEqual(result.windows, inventory.windows);
    assert.equal(result.processPreserved, true); assert.equal(result.processStillRunning, null);
    assert.equal(result.outcomeUnknown, true); assert.equal(result.reconciliationRequired, true);
    assert.equal(result.retryable, false); assert.equal(clock, 0);
    assert.deepEqual(operationsOf(calls), ["instances", "desktop_status", "launch", "instances", "dialog_list"]);
    assert.equal(closes(calls).length, 0);
  }
  for (const failure of [
    { ok: false, kind: "timeout", error: "Synthetic startup dialog timeout", outcomeUnknown: false },
    { ok: false, kind: "uia-root-unavailable", error: "Synthetic poisoned startup read", outcomeUnknown: false },
  ]) {
    const { result, calls } = await startupDialogScenario(failure);
    assert.equal(result.kind, failure.kind); assert.equal(result.error, failure.error);
    assert.equal(result.failedStep, "dialog_list"); assert.equal(result.processPreserved, true);
    assert.equal(result.outcomeUnknown, true); assert.equal(result.reconciliationRequired, true);
    assert.equal(result.retryable, false); assert.equal(closes(calls).length, 0);
    assert.equal(calls.filter(call => call.operation === "dialog_list").length, 1, "No failed UIA read is retried.");
  }
  {
    const { result, calls } = await startupDialogScenario(() => { throw new Error("Synthetic thrown startup read"); });
    assert.equal(result.kind, "startup-probe"); assert.equal(result.error, "Synthetic thrown startup read");
    assert.equal(result.processPreserved, true); assert.equal(result.reconciliationRequired, true);
    assert.equal(result.outcomeUnknown, true); assert.equal(result.failedStep, "dialog_list");
    assert.equal(closes(calls).length, 0); assert.equal(calls.filter(call => call.operation === "dialog_list").length, 1);
  }
  {
    const { result, calls, clock } = await startupDialogScenario(emptyStartupDialogs);
    assert.equal(result.kind, "startup-not-ready"); assert.equal(result.ready, false);
    assert.equal(result.processPreserved, true); assert.equal(result.processStillRunning, null);
    assert.equal(result.outcomeUnknown, true); assert.equal(result.reconciliationRequired, true);
    assert.equal(clock, 61_500, "Empty startup inventories use the existing absolute deadline and reserve.");
    assert.equal(calls.filter(call => call.operation === "launch").length, 1);
    assert.equal(calls.filter(call => call.operation === "dialog_list").length, calls.filter(call => call.operation === "instances").length - 1);
    assert.equal(calls.filter(call => call.operation === "click").length, 0); assert.equal(closes(calls).length, 0);
  }

  {
    const controller = new AbortController();
    let clock = 0, inventories = 0;
    const { worker, calls } = scriptedWorker({
      instances: () => ++inventories === 1 ? noInstance : instance({ title: "Steuerprogramm" }),
      dialog_list: () => emptyStartupDialogs,
    });
    const result = await executeCaseCreate({ targetRef: TARGET, mode: "einurvor" }, 90_000, controller.signal, {
      execute: worker, worker, resolveTarget: () => ({ path: targetPath, ref: TARGET }),
      profile: { taxYear: 2025, startModes: { einurvor: "GewErfass" }, additionalCaseYears: { einurvor: [2026] } },
      now: () => clock, wait: async ms => { clock += ms; controller.abort(); },
    });
    assert.equal(result.kind, "aborted"); assert.equal(clock, 1500);
    assert.equal(result.processPreserved, true); assert.equal(result.processStillRunning, null);
    assert.equal(result.outcomeUnknown, true); assert.equal(result.reconciliationRequired, true);
    assert.equal(result.retryable, false); assert.equal(result.created, false);
    assert.deepEqual(operationsOf(calls), ["instances", "desktop_status", "launch", "instances", "dialog_list"]);
    assert.equal(closes(calls).length, 0);
  }
  {
    let inventories = 0;
    // A known-unsent failing read still leaves the launched application uninspected.
    const failing = scriptedWorker({ instances: () => ++inventories === 1 ? noInstance
      : { ok: false, kind: "timeout", error: "Synthetic unsent startup inventory", outcomeUnknown: false } });
    const failed = await executeCaseCreate({ targetRef: TARGET, mode: "einurvor" }, 90_000, undefined, {
      execute: failing.worker, worker: failing.worker, resolveTarget: () => ({ path: targetPath, ref: TARGET }),
      profile: { taxYear: 2025, startModes: { einurvor: "GewErfass" }, additionalCaseYears: { einurvor: [2026] } },
      now: () => 0,
    });
    assert.equal(failed.kind, "timeout"); assert.equal(failed.error, "Synthetic unsent startup inventory");
    assert.equal(failed.processPreserved, true); assert.equal(failed.processStillRunning, null);
    assert.equal(failed.outcomeUnknown, true); assert.equal(failed.reconciliationRequired, true);
    assert.equal(failed.retryable, false); assert.equal(closes(failing.calls).length, 0);
    assert.deepEqual(operationsOf(failing.calls), ["instances", "desktop_status", "launch", "instances"]);
  }
  {
    const controller = new AbortController();
    let inventories = 0, clock = 0;
    const { worker, calls } = scriptedWorker({
      instances: () => ++inventories === 1 ? noInstance : instance({ title: "Steuerprogramm" }),
      dialog_list: () => { controller.abort(); return emptyStartupDialogs; },
    });
    const result = await executeCaseCreate({ targetRef: TARGET, mode: "einurvor" }, 90_000, controller.signal, {
      execute: worker, worker, resolveTarget: () => ({ path: targetPath, ref: TARGET }),
      profile: { taxYear: 2025, startModes: { einurvor: "GewErfass" }, additionalCaseYears: { einurvor: [2026] } },
      now: () => clock, wait: async ms => { clock += ms; },
    });
    assert.equal(result.kind, "aborted"); assert.equal(clock, 0);
    assert.equal(result.processPreserved, true); assert.equal(result.processStillRunning, null);
    assert.equal(result.outcomeUnknown, true); assert.equal(result.reconciliationRequired, true);
    assert.equal(calls.filter(call => call.operation === "launch").length, 1);
    assert.equal(calls.filter(call => call.operation === "dialog_list").length, 1);
    assert.equal(closes(calls).length, 0);
  }

  {
    // The generic startup frame can exceed the main-window width threshold
    // before the product replaces it. Never bind UIA to that transient HWND.
    let inventories = 0, clock = 0;
    const { worker, calls } = scriptedWorker({
      instances: args => {
        inventories++;
        if (inventories === 1) return noInstance;
        if (inventories < 4) return instance({ hwnd: HWND - 1, title: "Steuerprogramm", w: 1200, h: 800 });
        if (args.includeHash === true) {
          writeFileSync(targetPath, "neu");
          return instance({ caseName: "neu.GewErfass2026", caseSha256: HASH, casePath: targetPath });
        }
        return instance();
      },
      dialog_list: (() => {
        let reads = 0;
        // The real inventory includes the generic main, but skips its deep
        // UIA content: both read flags may be false without an error.
        return () => ++reads <= 2 ? { ok: true, count: 1, windows: [startupMain], dialogs: [] } : {
          ok: true, count: 1,
          dialogs: [saveDialog], windows: [saveDialog],
        };
      })(),
      ui_state: args => {
        assert.equal(args.hwnd, HWND, "The generic startup frame must never reach UIA.");
        return { ok: true, heading: START_PAGE, blockiert: false, instance: { pid: PID, hwnd: HWND } };
      },
    });
    const result = await executeCaseCreate({ targetRef: TARGET, mode: "einurvor" }, 240_000, undefined, {
      execute: worker, worker, resolveTarget: () => ({ path: targetPath, ref: TARGET }),
      profile: { taxYear: 2025, startModes: { einurvor: "GewErfass" }, additionalCaseYears: { einurvor: [2026] } },
      now: () => clock, wait: async ms => { clock += ms; },
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(clock, 3_000);
    assert.equal(result.hwnd, HWND);
    assert.deepEqual(operationsOf(calls).slice(0, 9),
      ["instances", "desktop_status", "launch", "instances", "dialog_list", "instances", "dialog_list", "instances", "ui_state"]);
    assert.equal(calls.filter(entry => entry.operation === "launch").length, 1);
    assert.deepEqual(calls.filter(entry => entry.operation === "ui_state").map(entry => entry.args.hwnd), [HWND]);
    assert.equal(closes(calls).length, 0);
    resetTarget();
  }
  {
    let inventories = 0, clock = 0;
    const { worker, calls } = scriptedWorker({
      instances: () => ++inventories === 1 ? noInstance : instance({ title: "Steuerprogramm", w: 1500 }),
      dialog_list: () => emptyStartupDialogs,
    });
    const result = await executeCaseCreate({ targetRef: TARGET, mode: "einurvor" }, 90_000, undefined, {
      execute: worker, worker, resolveTarget: () => ({ path: targetPath, ref: TARGET }),
      profile: { taxYear: 2025, startModes: { einurvor: "GewErfass" }, additionalCaseYears: { einurvor: [2026] } },
      now: () => clock, wait: async ms => { clock += ms; },
    });
    assert.equal(result.ok, false);
    assert.equal(result.kind, "startup-not-ready");
    assert.equal(clock, 61_500, "Generic frames consume the original wizard budget.");
    assert.equal(result.processPreserved, true);
    assert.equal(result.processStillRunning, true);
    assert.equal(result.outcomeUnknown, true);
    assert.equal(calls.filter(entry => entry.operation === "ui_state").length, 0);
    assert.equal(calls.filter(entry => entry.operation === "click").length, 0);
    assert.equal(calls.filter(entry => entry.operation === "launch").length, 1);
    assert.equal(closes(calls).length, 0);
    assert.equal(calls.filter(entry => entry.operation === "subpages").length, 0);
  }
  {
    let inventories = 0, clock = 0;
    const { worker, calls } = scriptedWorker({
      instances: () => {
        inventories++;
        return inventories === 2 ? instance({ title: "Steuerprogramm" }) : noInstance;
      },
      dialog_list: () => emptyStartupDialogs,
    });
    const result = await executeCaseCreate({ targetRef: TARGET, mode: "einurvor" }, 90_000, undefined, {
      execute: worker, worker, resolveTarget: () => ({ path: targetPath, ref: TARGET }),
      profile: { taxYear: 2025, startModes: { einurvor: "GewErfass" }, additionalCaseYears: { einurvor: [2026] } },
      now: () => clock, wait: async ms => { clock += ms; },
    });
    assert.equal(result.kind, "startup-not-ready");
    assert.equal(result.processPreserved, true);
    assert.equal(result.processStillRunning, null, "An absent main window is not proof the process is still alive.");
    assert.equal(calls.filter(entry => entry.operation === "ui_state").length, 0);
    assert.equal(calls.filter(entry => entry.operation === "launch").length, 1);
    assert.equal(closes(calls).length, 0);
  }

  {
    // A named native main window can still be absent from passive discovery
    // during startup. Re-read only a known pre-dispatch absence, retaining
    // the launched PID and the original wizard deadline.
    let stateCalls = 0, clock = 0;
    const { worker, calls } = scriptedWorker({
      ui_state: () => ++stateCalls < 3
        ? { ok: false, backend: "qt", kind: "no-window", outcomeUnknown: false, error: "Not materialized yet" }
        : { ok: true, running: true, heading: START_PAGE, blockiert: false, instance: {pid: PID, hwnd: HWND} },
    });
    const result = await executeCaseCreate({ targetRef: TARGET, mode: "einurvor" }, 240_000, undefined, {
      execute: worker, worker, resolveTarget: () => ({ path: targetPath, ref: TARGET }),
      profile: { taxYear: 2025, startModes: { einurvor: "GewErfass" }, additionalCaseYears: { einurvor: [2026] } },
      now: () => clock, wait: async ms => { clock += ms; },
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(stateCalls, 3);
    assert.equal(clock, 3_000);
    assert.equal(calls.filter(entry => entry.operation === "launch").length, 1);
    assert.deepEqual(calls.filter(entry => entry.operation === "ui_state").map(entry => entry.args.hwnd), [HWND, HWND, HWND]);
    assert.deepEqual(operationsOf(calls).slice(2, 8), ["launch", "instances", "ui_state", "instances", "ui_state", "instances"]);
    assert.equal(closes(calls).length, 0);
    resetTarget();
  }

  for (const failure of [
    { backend: "qt", kind: "no-window", outcomeUnknown: true },
    { backend: "qt", kind: "no-window" },
    { kind: "no-window", outcomeUnknown: false },
    { backend: "qt", kind: "ambiguous", outcomeUnknown: false },
    { backend: "qt", kind: "native-binding", outcomeUnknown: false },
  ]) {
    const { worker, calls } = scriptedWorker({ ui_state: () => ({ ok: false, ...failure, error: "Terminal binding failure" }) });
    let clock = 0;
    const result = await executeCaseCreate({ targetRef: TARGET, mode: "einurvor" }, 240_000, undefined, {
      execute: worker, worker, resolveTarget: () => ({ path: targetPath, ref: TARGET }),
      profile: { taxYear: 2025, startModes: { einurvor: "GewErfass" }, additionalCaseYears: { einurvor: [2026] } },
      now: () => clock, wait: async ms => { clock += ms; },
    });
    assert.equal(result.ok, false);
    assert.equal(result.kind, failure.kind);
    assert.equal(calls.filter(entry => entry.operation === "ui_state").length, 1);
    assert.equal(calls.filter(entry => entry.operation === "click").length, 0);
    assert.equal(clock, 0);
    assert.equal(result.processPreserved, true); assert.equal(result.processStillRunning, null);
    assert.equal(result.outcomeUnknown, failure.outcomeUnknown);
    assert.equal(result.reconciliationRequired, true); assert.equal(result.retryable, false);
    assert.equal(closes(calls).length, 0);
  }

  {
    let clock = 0;
    const { worker, calls } = scriptedWorker({ ui_state: () => ({
      ok: false, backend: "qt", kind: "no-window", outcomeUnknown: false,
    }) });
    const result = await executeCaseCreate({ targetRef: TARGET, mode: "einurvor" }, 90_000, undefined, {
      execute: worker, worker, resolveTarget: () => ({ path: targetPath, ref: TARGET }),
      profile: { taxYear: 2025, startModes: { einurvor: "GewErfass" }, additionalCaseYears: { einurvor: [2026] } },
      now: () => clock, wait: async ms => { clock += ms; },
    });
    assert.equal(result.ok, false);
    assert.equal(result.kind, "wizard-page");
    assert.equal(clock, 61_500);
    assert.equal(calls.filter(entry => entry.operation === "launch").length, 1);
    assert.equal(calls.filter(entry => entry.operation === "click").length, 0);
    assert.equal(result.processPreserved, true); assert.equal(result.processStillRunning, null);
    assert.equal(result.reconciliationRequired, true); assert.equal(result.retryable, false);
    assert.equal(closes(calls).length, 0);
  }

  {
    // Der Qt-Snapshot exponiert den Startlink erst nach einem UIA-Baumlauf.
    // Der Assistent muss genau diesen Read direkt ueber den Worker ausfuehren.
    const { worker, calls } = scriptedWorker();
    let nativeSubpageCalls = 0;
    const execute = (operation, args, timeoutMs, signal) => {
      if (operation === "subpages") {
        nativeSubpageCalls += 1;
        return Promise.resolve({ ok: true, anzahl: 0, unterseiten: [] });
      }
      return worker(operation, args, timeoutMs, signal);
    };
    const result = await executeCaseCreate({ targetRef: TARGET, mode: "einurvor" }, 240_000, undefined, {
      execute, worker, resolveTarget: () => ({ path: targetPath, ref: TARGET }),
      profile: { taxYear: 2025, startModes: { einurvor: "GewErfass" }, additionalCaseYears: { einurvor: [2026] } },
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(nativeSubpageCalls, 0);
    assert.equal(calls.filter((entry) => entry.operation === "subpages").length, 1);
    assert.equal(calls.filter((entry) => entry.operation === "click")[0].args.name, "Jetzt beginnen");
    assert.equal(closes(calls).length, 0);
    resetTarget();
  }

  {
    // 13 Gekuerzter Fenstertitel: der Worker kann keinen Dateihash liefern,
    // die Datei selbst muss den Dialog-Readback bestaetigen.
    const diskHash = createHash("sha256").update("neu").digest("hex").toUpperCase();
    let instanceCalls = 0;
    const { worker, calls } = scriptedWorker({
      instances: (args) => {
        instanceCalls += 1;
        if (instanceCalls === 1) return noInstance;
        if (args.includeHash === true) {
          writeFileSync(targetPath, "neu");
          return instance({ caseName: "neu.GewErfass2026", caseSha256: null, casePath: null, casePathSource: "title-leaf", titleTruncated: true });
        }
        return instance();
      },
      file_dialog_select: () => ({ ok: true, selected: targetPath, sha256: diskHash, mode: "save-new", dialogClosed: true, verified: true }),
    });
    const result = await createApiExecutor(config, worker)("case_create", { targetRef: TARGET, mode: "einurvor" }, 240_000);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.sha256, diskHash);
    assert.equal(result.caseHashSource, "local-file");
    assert.equal(closes(calls).length, 0);
    resetTarget();
  }
  for (const links of [
    [],
    [{ schalter: "Jetzt beginnen", typ: "Button", aktiviert: true }],
    [{ schalter: "Jetzt beginnen", typ: "Hyperlink", aktiviert: false }],
    [
      { schalter: "Jetzt beginnen", typ: "Hyperlink", aktiviert: true },
      { schalter: "Jetzt beginnen", typ: "Hyperlink", aktiviert: true },
    ],
  ]) {
    const { worker, calls } = scriptedWorker({
      subpages: () => ({ ok: true, anzahl: links.length, unterseiten: links }),
    });
    const result = await createApiExecutor(config, worker)("case_create", { targetRef: TARGET, mode: "einurvor" }, 240_000);
    assert.equal(result.kind, "wizard-page");
    assert.equal(result.created, false);
    assert.equal(calls.filter(entry => entry.operation === "click").length, 0,
      "Missing, disabled, anonymous or ambiguous wizard links must fail before dispatch.");
    assert.equal(closes(calls).length, 1);
    assert.equal(result.processStillRunning, false);
  }
  const rootFailure = (extra = {}) => ({
    ok: false, kind: "uia-root-unavailable", error: "Synthetic UIA root failure", operation: "ui_state", phase: "snapshot-root",
    pid: PID, hwnd: HWND, windowAlive: true, windowSetMainOnly: true, windowStateChanged: false, mutationStarted: false, outcomeUnknown: false,
    exceptionType: "System.Runtime.InteropServices.COMException", hresult: "0x80004005", ...extra,
  });
  const rootScenario = async (overrides, timeout = 240_000) => {
    let clock = 0;
    const { worker, calls } = scriptedWorker(overrides);
    const result = await executeCaseCreate({ targetRef: TARGET, mode: "einurvor" }, timeout, undefined, {
      execute: worker, worker, resolveTarget: () => ({ path: targetPath, ref: TARGET }),
      profile: { taxYear: 2025, startModes: { einurvor: "GewErfass" }, additionalCaseYears: { einurvor: [2026] } },
      now: () => clock, wait: async ms => { clock += ms; },
    });
    return { result, calls, clock };
  };
  {
    let reads = 0;
    const {worker, calls} = scriptedWorker({ui_state: () => ++reads < 3 ? rootFailure()
      : {ok: true, heading: START_PAGE, instance: {pid: PID, hwnd: HWND}, blockiert: false}});
    const result = await createApiExecutor(config, worker)("case_create", {targetRef: TARGET, mode: "einurvor"}, 240_000);
    assert.equal(result.ok, true, JSON.stringify(result)); assert.equal(result.startupUiaRootFailures, 2);
    assert.equal(reads, 3); assert.equal(calls.filter(c => c.operation === "launch").length, 1);
    assert.equal(closes(calls).length, 0); resetTarget();
  }
  {
    let reads = 0;
    const { result, calls, clock } = await rootScenario({ ui_state: () => ++reads < 3 ? rootFailure()
      : { ok: true, heading: START_PAGE, blockiert: false, instance: {pid: PID, hwnd: HWND} } });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(reads, 3); assert.equal(clock, 3000);
    assert.equal(result.startupUiaRootFailures, 2);
    assert.equal(result.lastUiaRootFailure.hresult, "0x80004005");
    assert.deepEqual(calls.filter(c => c.operation === "ui_state").map(c => c.timeoutMs), [240_000, 238_500, 237_000]);
    assert.equal(calls.filter(c => c.operation === "launch").length, 1);
    assert.deepEqual(calls.filter(c => c.operation === "ui_state").map(c => c.args.hwnd), [HWND, HWND, HWND]);
    const start = operationsOf(calls);
    assert.deepEqual(start.slice(3, 10), ["instances", "ui_state", "instances", "ui_state", "instances", "ui_state", "subpages"]);
    assert.equal(closes(calls).length, 0); resetTarget();
  }
  {
    const { result, calls, clock } = await rootScenario({ui_state: () => rootFailure()});
    assert.equal(result.kind, "uia-root-unavailable"); assert.equal(result.attempts, 3); assert.equal(result.created, false);
    assert.equal(result.retryable, false); assert.equal(result.processStillRunning, null);
    assert.equal(result.processPreserved, true); assert.equal(result.outcomeUnknown, false);
    assert.equal(result.reconciliationRequired, true);
    assert.equal(calls.filter(c => c.operation === "ui_state").length, 3); assert.equal(clock, 3000);
    assert.equal(calls.filter(c => c.operation === "launch").length, 1);
    assert.equal(calls.filter(c => c.operation === "click" || c.operation === "file_dialog_select").length, 0);
    assert.equal(closes(calls).length, 0);
  }
  for (const extra of [
    {kind: "worker-init"}, {operation: "subpages"}, {phase: "dispatch"}, {phase: undefined}, {backend: "qt"},
    {windowAlive: false}, {windowAlive: undefined}, {windowSetMainOnly: false}, {windowSetMainOnly: undefined},
    {windowStateChanged: true}, {windowStateChanged: undefined},
    {mutationStarted: true}, {mutationStarted: undefined}, {outcomeUnknown: undefined},
    {pid: PID+1}, {hwnd: HWND+1},
  ]) {
    const { result, calls, clock } = await rootScenario({ui_state: () => rootFailure(extra)});
    assert.equal(result.ok, false); assert.equal(result.created, false);
    assert.equal(calls.filter(c => c.operation === "ui_state").length, 1); assert.equal(clock, 0);
    assert.equal(result.processPreserved, true); assert.equal(result.processStillRunning, null);
    assert.equal(result.reconciliationRequired, true); assert.equal(result.retryable, false);
    assert.equal(calls.filter(c => c.operation === "click").length, 0); assert.equal(closes(calls).length, 0);
  }
  {
    const { result, calls, clock } = await rootScenario({ui_state: () => rootFailure({outcomeUnknown: true})});
    assert.equal(result.ok, false); assert.equal(result.created, false);
    assert.equal(result.outcomeUnknown, true); assert.equal(result.processPreserved, true);
    assert.equal(result.processStillRunning, null); assert.equal(result.reconciliationRequired, true);
    assert.equal(calls.filter(c => c.operation === "ui_state").length, 1); assert.equal(clock, 0);
    assert.equal(calls.filter(c => c.operation === "click").length, 0); assert.equal(closes(calls).length, 0);
  }
  for (const extra of [{recoveredState: true}, {hung: true}]) {
    let counts = 0;
    const {result, calls} = await rootScenario({instances: () => ++counts === 1 ? noInstance : instance(counts < 3 ? {} : extra),
      ui_state: () => rootFailure()});
    assert.equal(result.processPreserved, true); assert.equal(result.startupUiaRootFailures, 1);
    assert.equal(calls.filter(c => c.operation === "ui_state").length, 1); assert.equal(closes(calls).length, 0);
  }
  for (const spec of [
    { inventory: emptyStartupDialogs, kind: "startup-binding-changed", blocked: undefined, processStillRunning: null },
    { inventory: { ok: true, count: 1,
      dialogs: [{ pid: PID, hwnd: HWND + 7, kind: "qt-dialog", recoveryPrompt: true }],
      windows: [{ pid: PID, hwnd: HWND + 7, kind: "qt-dialog", recoveryPrompt: true }] },
      kind: "startup-not-ready", blocked: true, processStillRunning: true },
  ]) {
    let counts = 0;
    const { result, calls } = await rootScenario({
      instances: () => ++counts === 2 ? instance() : noInstance,
      ui_state: () => rootFailure(), dialog_list: () => spec.inventory,
    });
    assert.equal(result.kind, spec.kind); assert.equal(result.blockedByDialog, spec.blocked);
    assert.equal(result.processPreserved, true); assert.equal(result.processStillRunning, spec.processStillRunning);
    assert.equal(result.outcomeUnknown, true); assert.equal(result.reconciliationRequired, true);
    assert.equal(result.retryable, false); assert.equal(result.created, false);
    assert.equal(result.startupUiaRootFailures, 1);
    assert.deepEqual(calls.filter(c => c.operation === "dialog_list").map(c => c.args), [{ pid: PID }]);
    assert.equal(calls.filter(c => c.operation === "ui_state").length, 1);
    assert.equal(calls.filter(c => c.operation === "click").length, 0); assert.equal(closes(calls).length, 0);
  }
  {
    let counts = 0;
    const { result, calls } = await rootScenario({
      instances: () => ++counts === 1 ? noInstance : instance({hwnd: counts < 3 ? HWND : HWND+1}),
      ui_state: () => rootFailure(),
      dialog_list: () => emptyStartupDialogs,
    });
    assert.equal(result.kind, "startup-binding-changed");
    assert.equal(calls.filter(c => c.operation === "ui_state").length, 1);
    assert.equal(result.processPreserved, true); assert.equal(result.processStillRunning, null);
    assert.equal(result.reconciliationRequired, true); assert.equal(result.outcomeUnknown, true);
    assert.equal(calls.filter(c => c.operation === "click").length, 0); assert.equal(closes(calls).length, 0);
  }
  {
    const {result, calls} = await rootScenario({ui_state: () => rootFailure({windowSetMainOnly: false,
      outcomeUnknown: true, processPreserved: true, retryable: false, reconciliationRequired: true})});
    assert.equal(result.processPreserved, true); assert.equal(result.processStillRunning, null);
    assert.equal(calls.filter(c => c.operation === "ui_state").length, 1); assert.equal(closes(calls).length, 0);
  }
  {
    let reads = 0;
    const { result, calls } = await rootScenario({ui_state: () => ++reads % 2 ? rootFailure()
      : {ok: true, heading: "", instance: {pid: PID, hwnd: HWND}}});
    assert.equal(result.kind, "uia-root-unavailable"); assert.equal(result.attempts, 3); assert.equal(reads, 5);
    assert.equal(result.processPreserved, true); assert.equal(result.processStillRunning, null);
    assert.equal(result.outcomeUnknown, false); assert.equal(result.reconciliationRequired, true);
    assert.equal(calls.filter(c => c.operation === "launch").length, 1); assert.equal(closes(calls).length, 0);
  }
  {
    const { result, calls } = await rootScenario({ui_state: () => ({ok: true, heading: START_PAGE, instance: {pid: PID+1, hwnd: HWND}})});
    assert.equal(result.kind, "startup-binding-changed");
    assert.equal(result.processPreserved, true); assert.equal(result.processStillRunning, null);
    assert.equal(result.reconciliationRequired, true); assert.equal(result.outcomeUnknown, true);
    assert.equal(calls.filter(c => c.operation === "click").length, 0); assert.equal(closes(calls).length, 0);
  }
  {
    let clock = 0;
    const controller = new AbortController();
    const {worker, calls} = scriptedWorker({ui_state: () => {controller.abort(); return rootFailure();}});
    const result = await executeCaseCreate({targetRef: TARGET, mode: "einurvor"}, 240_000, controller.signal, {
      execute: worker, worker, resolveTarget: () => ({path: targetPath, ref: TARGET}),
      profile: {taxYear: 2025, startModes: {einurvor: "GewErfass"}, additionalCaseYears: {einurvor: [2026]}},
      now: () => clock, wait: async ms => {clock += ms;},
    });
    assert.equal(result.kind, "aborted"); assert.equal(clock, 0); assert.equal(result.startupUiaRootFailures, 1);
    assert.equal(result.processPreserved, true); assert.equal(result.processStillRunning, null);
    assert.equal(result.reconciliationRequired, true); assert.equal(result.outcomeUnknown, true);
    assert.equal(calls.filter(c => c.operation === "ui_state").length, 1); assert.equal(closes(calls).length, 0);
  }
  {
    let clock = 0, reads = 0;
    const controller = new AbortController();
    const responses = [() => rootFailure(), () => rootFailure(), () => { controller.abort(); return rootFailure(); }];
    const { worker, calls } = scriptedWorker({ ui_state: () => responses[reads++]() });
    const result = await executeCaseCreate({ targetRef: TARGET, mode: "einurvor" }, 240_000, controller.signal, {
      execute: worker, worker, resolveTarget: () => ({ path: targetPath, ref: TARGET }),
      profile: { taxYear: 2025, startModes: { einurvor: "GewErfass" }, additionalCaseYears: { einurvor: [2026] } },
      now: () => clock, wait: async ms => { clock += ms; },
    });
    assert.equal(result.kind, "uia-root-unavailable"); assert.equal(result.attempts, 3);
    assert.equal(result.processPreserved, true); assert.equal(result.processStillRunning, null);
    assert.equal(result.reconciliationRequired, true); assert.equal(result.outcomeUnknown, true);
    assert.equal(reads, 3); assert.equal(closes(calls).length, 0);
  }
  {
    let clock = 0;
    const {worker, calls} = scriptedWorker({ui_state: () => {clock = 89_999; return rootFailure();}});
    const result = await executeCaseCreate({targetRef: TARGET, mode: "einurvor"}, 90_000, undefined, {
      execute: worker, worker, resolveTarget: () => ({path: targetPath, ref: TARGET}),
      profile: {taxYear: 2025, startModes: {einurvor: "GewErfass"}, additionalCaseYears: {einurvor: [2026]}},
      now: () => clock, wait: async ms => {clock += ms;},
    });
    assert.equal(result.ok, false); assert.equal(clock, 89_999); assert.equal(result.startupUiaRootFailures, 1);
    assert.equal(calls.filter(c => c.operation === "ui_state").length, 1);
    assert.equal(calls.filter(c => c.operation === "launch").length, 1); assert.equal(closes(calls).length, 0);
    assert.equal(result.processPreserved, true); assert.equal(result.processStillRunning, null);
    assert.equal(result.outcomeUnknown, undefined); assert.equal(result.reconciliationRequired, true); assert.equal(result.retryable, false);
  }
  {
    let clock = 0, reads = 0;
    const {worker, calls} = scriptedWorker({instances: () => {
      if (++reads === 1) return noInstance;
      clock = 89_999;
      return instance();
    }});
    const result = await executeCaseCreate({targetRef: TARGET, mode: "einurvor"}, 90_000, undefined, {
      execute: worker, worker, resolveTarget: () => ({path: targetPath, ref: TARGET}),
      profile: {taxYear: 2025, startModes: {einurvor: "GewErfass"}, additionalCaseYears: {einurvor: [2026]}},
      now: () => clock, wait: async ms => {clock += ms;},
    });
    assert.equal(result.kind, "timeout"); assert.equal(result.failedStep, undefined);
    assert.equal(result.created, false); assert.equal(result.processPreserved, true); assert.equal(result.processStillRunning, null);
    assert.equal(result.outcomeUnknown, undefined); assert.equal(result.reconciliationRequired, true); assert.equal(result.retryable, false);
    assert.deepEqual(operationsOf(calls), ["instances", "desktop_status", "launch", "instances"]);
    assert.equal(closes(calls).length, 0);
  }
  {
    const {result, calls} = await rootScenario({ui_state: () => ({
      ok: false, kind: "not-found", error: "Synthetic determinate startup read failure",
      mutationStarted: false, outcomeUnknown: false,
    })});
    assert.equal(result.kind, "not-found"); assert.equal(result.failedStep, "ui_state");
    assert.equal(result.created, false); assert.equal(result.processPreserved, true); assert.equal(result.processStillRunning, null);
    assert.equal(result.outcomeUnknown, false); assert.equal(result.reconciliationRequired, true); assert.equal(result.retryable, false);
    assert.equal(calls.filter(c => c.operation === "ui_state").length, 1); assert.equal(closes(calls).length, 0);
  }
  {
    const {result, calls} = await rootScenario({ui_state: () => ({
      ok: true, heading: "Gewinn-Erfassung für das Jahr 2025", blockiert: false, instance: {pid: PID, hwnd: HWND},
    })});
    assert.equal(result.kind, "wizard-page"); assert.equal(result.created, false);
    assert.equal(result.processPreserved, true); assert.equal(result.processStillRunning, null);
    assert.equal(result.outcomeUnknown, undefined); assert.equal(result.reconciliationRequired, true); assert.equal(result.retryable, false);
    assert.equal(calls.filter(c => c.operation === "ui_state").length, 1);
    assert.equal(calls.filter(c => c.operation === "click" || c.operation === "file_dialog_select").length, 0);
    assert.equal(closes(calls).length, 0);
  }
  {
    const {result, calls} = await rootScenario({click: () => ({
      ok: false, kind: "not-found", error: "Synthetic determinate refusal after confirmed startup",
      mutationStarted: false, outcomeUnknown: false,
    })});
    assert.equal(result.kind, "not-found"); assert.equal(result.failedStep, "click");
    assert.equal(result.processStillRunning, false); assert.notEqual(result.processPreserved, true);
    assert.equal(calls.filter(c => c.operation === "click").length, 1); assert.equal(closes(calls).length, 1);
  }
} finally {
  rmSync(temporary, { recursive: true, force: true });
}

process.stdout.write("case_create: Schrittfolge, Guards, Cleanup vor dem Speichern und Schutz danach bestanden.\n");
