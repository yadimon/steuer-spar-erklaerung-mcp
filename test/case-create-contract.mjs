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

const instance = (extra = {}) => ({
  ok: true, count: 1, ambiguous: false, foregroundHwnd: HWND,
  instances: [{ hwnd: HWND, pid: PID, title: "Gewinn-Erfassung 2026", hung: false, recoveredState: false, ...extra }],
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
    launch: () => ({ ok: true, launched: true, pid: PID }),
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
      dialogs: [{ hwnd: 7001, pid: PID, cls: "#32770", kind: "native-dialog", title: SAVE_TITLE, buttons: [], texts: [], fingerprint: "D".repeat(64) }],
      windows: [],
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

try {
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
    assert.equal(clicks[0].rid, "42.1.4.-1");
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
      click: (args) => ({ ok: true, ueberschriftVorher: START_PAGE, ueberschriftNachher: args.rid ? "Datenübernahme" : MASTER_PAGE }),
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
    const result = await createApiExecutor(config, worker)("case_create", { targetRef: TARGET, mode: "einurvor" }, 240_000);
    assert.equal(result.kind, "save-dialog");
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
        return { ok: true, running: true, heading: stateCalls < 3 ? "" : START_PAGE, blockiert: false };
      },
    });
    const result = await createApiExecutor(config, worker)("case_create", { targetRef: TARGET, mode: "einurvor" }, 240_000);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(calls.filter((entry) => entry.operation === "ui_state").length, 3);
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
} finally {
  rmSync(temporary, { recursive: true, force: true });
}

process.stdout.write("case_create: Schrittfolge, Guards, Cleanup vor dem Speichern und Schutz danach bestanden.\n");
