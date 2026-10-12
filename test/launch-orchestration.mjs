import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApiExecutor } from "../dist/api-executor.js";
import { executeLaunchOperation } from "../dist/launch-executor.js";

const temporary = mkdtempSync(join(tmpdir(), "sse-launch-orchestration-"));
const config = {
  host: "127.0.0.1",
  port: 1,
  configPath: join(temporary, "config.json"),
  workspaceDir: join(temporary, "workspace"),
  resultDir: join(temporary, "results"),
  sseExecutable: "C:\\Program Files\\Steuertipps\\SteuerSparErklaerung\\Steuerjahr 2025\\SSE.exe",
};

const mainWindow = (pid, hwnd = 9001) => ({
  pid,
  hwnd,
  title: "Einkommensteuer 2025: SteuerSparErklärung für das Steuerjahr 2025",
  w: 1200,
  h: 800,
  minimiert: false,
});
const waitUntil = async (predicate, timeoutMs = 2_000) => {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Testbedingung wurde nicht rechtzeitig erreicht.");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};
const waitForProbeAbort = (signal, onStart) => new Promise((_, reject) => {
  onStart();
  const abort = () => reject(Object.assign(new Error("Startprobe abgebrochen"), { kind: "aborted" }));
  if (signal?.aborted) abort();
  else signal?.addEventListener("abort", abort, { once: true });
});

function assertPreserved(result, pid, processStillRunning = null) {
  assert.equal(result.pid, pid);
  assert.equal(result.processPreserved, true, "Preservation means that the executor did not close, not proven liveness");
  assert.equal(result.processStillRunning, processStillRunning);
  assert.equal(result.outcomeUnknown, true);
  assert.equal(result.reconciliationRequired, true);
  assert.equal(result.retryable, false);
  assert.equal(result.ready, false);
  assert.equal(Object.hasOwn(result, "cleanup"), false);
  assert.equal(Object.hasOwn(result, "cleanupError"), false);
}

try {
  {
    let calls = 0;
    const execute = createApiExecutor(config, async () => {
      calls += 1;
      return { ok: true };
    });
    const result = await execute("launch", { mode: "normal" }, 29_999);
    assert.equal(result.ok, false);
    assert.equal(result.kind, "bad-args");
    assert.equal(calls, 0, "Zu kurze Startfrist darf noch keinen Prozess starten");
  }

  {
    const execute = createApiExecutor(config, async (operation) =>
      operation === "launch" ? { ok: true, launched: true } : { ok: false });
    const result = await execute("launch", { mode: "normal" }, 30_000);
    assert.equal(result.ok, false);
    assert.equal(result.kind, "startup-pid");
    assertPreserved(result, undefined);
  }

  {
    const pid = 4101;
    let probeCalls = 0;
    let closeCalls = 0;
    const execute = createApiExecutor(config, async (operation, args, timeoutMs) => {
      if (operation === "launch") return { ok: true, launched: true, pid };
      if (operation === "launch_probe") {
        probeCalls += 1;
        assert.deepEqual(Object.keys(args).sort(),
          ["budgetMs", "hasCase", "pid", "planKind", "schemaVersion"].sort());
        assert.equal(args.schemaVersion, 1);
        assert.equal(args.planKind, "launch-readiness");
        assert.equal(args.pid, pid, "Startprobe muss vor jedem Readback PID-begrenzt sein");
        assert.equal(args.hasCase, false);
        assert(args.budgetMs <= 29_000 && args.budgetMs >= 28_000,
          "Workerbudget muss eine eigene Uebergabereserve behalten");
        assert(timeoutMs <= 30_000 && timeoutMs >= 29_000, "Workerfrist muss das monotone Restbudget fortsetzen");
        return probeCalls === 1
          ? {
              ok: true,
              outcome: "retry-fresh",
              windows: [],
              dialogs: [],
              startupPrompts: [],
              probeFailures: 1,
              lastProbeError: "windows: UIA kurz nicht erreichbar",
              windowProbeSucceeded: false,
            }
          : {
              ok: true,
              outcome: "observed",
              windows: [mainWindow(pid)],
              dialogs: [],
              probeFailures: 0,
            };
      }
      if (operation === "close") {
        closeCalls += 1;
        return { ok: true };
      }
      return { ok: false, kind: "fixture", error: operation };
    });
    const result = await execute("launch", { mode: "normal" }, 30_000);
    assert.equal(result.ok, true);
    assert.equal(result.ready, true);
    assert.equal(result.probeFailures, 1);
    assert.equal(probeCalls, 2, "Eine UIA-Ausnahme muss genau einen frischen Startprobe-Worker erzwingen");
    assert.equal(closeCalls, 0, "Transiente Probe darf gesunden Start nicht beenden");
  }

  {
    const pid = 4112;
    let probeCalls = 0;
    let closeCalls = 0;
    const execute = createApiExecutor(config, async (operation) => {
      if (operation === "launch") return { ok: true, launched: true, pid };
      if (operation === "launch_probe") {
        probeCalls += 1;
        return probeCalls === 1
          ? {
              ok: false,
              kind: "worker-isolation-lost",
              error: "Sitzungsweiter SSE-Controller konnte nicht sicher freigegeben werden.",
              retryable: false,
            }
          : {
              ok: true,
              outcome: "observed",
              windows: [mainWindow(pid)],
              dialogs: [],
              probeFailures: 0,
            };
      }
      if (operation === "close") {
        closeCalls += 1;
        return { ok: true };
      }
      return { ok: false, kind: "fixture", error: operation };
    });
    const result = await execute("launch", { mode: "normal" }, 30_000);
    assert.equal(result.ok, true);
    assert.equal(result.ready, true);
    assert.equal(result.probeFailures, 1);
    assert.equal(probeCalls, 2,
      "Ein verlorener Controller im rein lesenden Startprobe-Worker braucht genau einen frischen Versuch");
    assert.equal(closeCalls, 0,
      "Der transiente Probe-Worker-Fehler darf den erfolgreich gestarteten SSE-Prozess nicht beenden");
  }

  {
    const pid = 4113;
    let probeCalls = 0;
    let closeCalls = 0;
    const execute = createApiExecutor(config, async (operation) => {
      if (operation === "launch") return { ok: true, launched: true, pid };
      if (operation === "launch_probe") {
        probeCalls += 1;
        return probeCalls === 1
          ? {
              ok: false,
              kind: "busy",
              reason: "session-controller-busy",
              error: "Vorheriger Startworker gibt den Sitzungscontroller gerade frei.",
              retryable: true,
              waited: false,
              mutationStarted: false,
              resultingState: "unchanged",
              cleanupRequired: false,
            }
          : {
              ok: true,
              outcome: "observed",
              windows: [mainWindow(pid)],
              dialogs: [],
              probeFailures: 0,
            };
      }
      if (operation === "close") {
        closeCalls += 1;
        return { ok: true };
      }
      return { ok: false, kind: "fixture", error: operation };
    });
    const result = await execute("launch", { mode: "normal" }, 30_000);
    assert.equal(result.ok, true);
    assert.equal(result.ready, true);
    assert.equal(result.probeFailures, 1);
    assert.equal(probeCalls, 2,
      "Zero-Wait-Controlleruebergabe zwischen Start und passiver Probe braucht einen frischen Versuch");
    assert.equal(closeCalls, 0,
      "Sichere Controlleruebergabe darf den erfolgreich gestarteten SSE-Prozess nicht beenden");
  }

  {
    const pid = 4114;
    let probeCalls = 0;
    let closeCalls = 0;
    const started = performance.now();
    const execute = createApiExecutor(config, async (operation) => {
      if (operation === "launch") return { ok: true, launched: true, pid };
      if (operation === "launch_probe") {
        probeCalls += 1;
        return {
          ok: false,
          kind: "worker-isolation-lost",
          error: "Persistenter Sitzungscontrollerfehler.",
          retryable: false,
        };
      }
      if (operation === "close") {
        closeCalls += 1;
        return { ok: true, processStillRunning: false };
      }
      throw new Error(`Unerwartete Operation ${operation}`);
    });
    const result = await execute("launch", { mode: "normal" }, 30_000);
    assert.equal(result.ok, false);
    assert.equal(probeCalls, 4, "Persistente Uebergabefehler duerfen nur begrenzt neu gestartet werden");
    assert.equal(closeCalls, 0, "Persistente Probe-Fehler duerfen den gestarteten Prozess nicht schliessen");
    assertPreserved(result, pid);
    assert.match(result.lastProbeError, /Persistenter Sitzungscontrollerfehler/);
    assert(performance.now() - started < 5_000, "Persistenter Uebergabefehler darf nicht das Startbudget aussitzen");
  }

  {
    const pid = 4102;
    const execute = createApiExecutor(config, async (operation, args) => {
      if (operation === "launch") return { ok: true, launched: true, pid };
      if (operation === "launch_probe") {
        assert.equal(args.pid, pid);
        return {
          ok: true,
          outcome: "observed",
          windows: [{ pid, hwnd: 7102, title: "Wiederherstellung", w: 518, h: 260 }],
          dialogs: [{ pid, hwnd: 7102, title: "Wiederherstellung", kind: "native-dialog" }],
        };
      }
      return { ok: false, kind: "fixture", error: operation };
    });
    const result = await execute("launch", { mode: "normal" }, 30_000);
    assert.equal(result.ok, true);
    assert.equal(result.ready, false);
    assert.equal(result.blockedByDialog, true);
    assert.equal(result.instance, null);
    assertPreserved(result, pid, true);
  }

  {
    // Regression aus einem fruehen Prueflauf: SSE hatte eine Wiederherstellungsdatei
    // geladen, meldete aber keinen Dialog. Nur der Fenstertitel verriet es, und
    // der Ablauf lief mit ready=true auf nicht verifiziertem Inhalt weiter.
    const pid = 4109;
    const execute = createApiExecutor(config, async (operation) => {
      if (operation === "launch") return { ok: true, launched: true, pid };
      if (operation === "launch_probe") {
        return {
          ok: true,
          outcome: "observed",
          windows: [{
            pid,
            hwnd: 8109,
            title: "Einkommensteuer 2025: SteuerSparErklärung für das Steuerjahr 2025 [31.30] - Steuerfall (Wiederhergestellt)",
            w: 1200,
            h: 800,
            minimiert: false,
          }],
          dialogs: [],
        };
      }
      return { ok: false, kind: "fixture", error: operation };
    });
    const result = await execute("launch", { mode: "normal" }, 30_000);
    assert.equal(result.ok, false, "Ein wiederhergestellter Fall darf nicht als bereit gelten.");
    assert.equal(result.kind, "recovered-state");
    assert.match(result.error, /Wiederherstellungsdatei/u);
    assert.equal(result.instance.hwnd, 8109, "Der Agent braucht das Fenster fuer die lesende Zustandsklaerung.");
    assertPreserved(result, pid, true);
    assert.doesNotMatch(result.error, /Wiederherstellung im Programm verwerfen|Fall ohne Speichern schliessen/u);
    assert.match(result.error, /Wiederhergestellte Daten erhalten/u);
  }

  {
    // Vor dem Laden fragt SteuerSparErklaerung erst, ob die
    // Wiederherstellungsdatei geladen werden soll. Diese Qt-Meldungsbox traegt
    // denselben Programmtitel wie ein Fallfenster, ist aber nur rund 520 Pixel
    // breit. Live beobachtet: ohne Groessenpruefung band der Start sie als
    // Hauptfenster und meldete ready=true, waehrend die Frage offen stand.
    const pid = 4111;
    const closeCalls = [];
    const execute = createApiExecutor(config, async (operation, args) => {
      if (operation === "launch") return { ok: true, launched: true, pid };
      if (operation === "launch_probe") {
        return {
          ok: true,
          outcome: "deadline",
          windows: [{
            pid,
            hwnd: 8111,
            title: "SteuerSparErklärung für das Steuerjahr 2025",
            w: 518,
            h: 260,
            minimiert: false,
          }],
          dialogs: [],
        };
      }
      if (operation === "close") { closeCalls.push(args); return { ok: true }; }
      return { ok: false, kind: "fixture", error: operation };
    });
    // Kurzes Budget: die Entscheidung faellt bewusst erst nach Ablauf.
    const result = await execute("launch", { mode: "normal" }, 30_000);
    assert.equal(result.ok, false, "Eine offene Startrueckfrage darf nicht als bereit gelten.");
    assert.equal(result.kind, "startup-question");
    assert.equal(result.ready, false);
    assert.equal(result.instance, null, "Eine Meldungsbox ist kein bindbares Hauptfenster.");
    assert.equal(result.startupPrompts.length, 1);
    assert.equal(result.startupPrompts[0].hwnd, 8111);
    assert.match(result.error, /Wiederherstellungsdatei/u);
    assert.equal(result.processStillRunning, true);
    assertPreserved(result, pid, true);
    assert.deepEqual(
      closeCalls,
      [],
      "Den Prozess hier zu beenden erzeugte die naechste Wiederherstellungsdatei und damit dieselbe Sackgasse.",
    );
  }

  {
    const pid = 4103;
    const execute = createApiExecutor(config, async (operation) => {
      if (operation === "launch") return { ok: true, launched: true, pid };
      if (operation === "launch_probe") {
        return { ok: true, outcome: "observed", windows: [mainWindow(pid, 8101), mainWindow(pid, 8102)], dialogs: [] };
      }
      return { ok: false, kind: "fixture", error: operation };
    });
    const result = await execute("launch", { mode: "normal" }, 30_000);
    assert.equal(result.ok, true);
    assert.equal(result.ready, false);
    assert.equal(result.instance, null);
    assert.equal(result.windows.length, 2);
  }

  for (const abortOutcome of ["throw", "returned"]) {
    const pid = abortOutcome === "throw" ? 4104 : 4105;
    let probeCalls = 0;
    let closeCalls = 0;
    const controller = new AbortController();
    const execute = createApiExecutor(config, async (operation, _args, _timeoutMs, signal) => {
      if (operation === "launch") return { ok: true, launched: true, pid };
      if (operation === "launch_probe") {
        const probe = waitForProbeAbort(signal, () => { probeCalls += 1; });
        return abortOutcome === "throw" ? probe : probe.catch(() => ({ ok: false, kind: "aborted", error: "Probe abgebrochen" }));
      }
      if (operation === "close") {
        closeCalls += 1;
        throw new Error("Synthetischer SSE-Prozess darf nicht geschlossen werden");
      }
      return { ok: false, kind: "fixture", error: operation };
    });
    const pending = execute("launch", { mode: "normal" }, 30_000, controller.signal);
    await waitUntil(() => probeCalls > 0);
    controller.abort();
    const result = await pending;
    assert.equal(closeCalls, 0);
    assertPreserved(result, pid);
    assert.equal(result.kind, "aborted");
  }

  {
    const pid = 4106;
    const controller = new AbortController();
    const calls = [];
    const execute = createApiExecutor(config, async (operation) => {
      calls.push(operation);
      assert.equal(operation, "launch");
      controller.abort();
      return { ok: true, launched: true, pid };
    });
    const result = await execute("launch", { mode: "normal" }, 30_000, controller.signal);
    assert.equal(result.kind, "aborted");
    assertPreserved(result, pid);
    assert.deepEqual(calls, ["launch"], "Abbruch nach Prozessstart darf weder Probe noch Cleanup starten");
  }

  {
    for (const args of [{ mode: "normal" }, { mode: "normal", file: "synthetic.case" }]) {
      const calls = [];
      const pid = 4120;
      const result = await executeLaunchOperation(args, 30_000, undefined, async (operation, probeArgs) => {
        calls.push(operation);
        if (operation === "launch") return { ok: true, launched: true, pid };
        assert.equal(operation, "launch_probe", "Kein indirekter Close-/Discard-/Dialog-Ausweichweg");
        assert.equal(probeArgs.hasCase, Boolean(args.file));
        return { ok: true, outcome: "deadline", windows: [], dialogs: [] };
      });
      assert.equal(result.kind, "startup-timeout");
      assertPreserved(result, pid);
      assert.deepEqual(calls, ["launch", "launch_probe"]);
    }
  }

  {
    const calls = [];
    const pid = 4121;
    const result = await executeLaunchOperation({}, 30_000, undefined, async (operation) => {
      calls.push(operation);
      if (operation === "launch") return { ok: true, launched: true, pid };
      assert.equal(operation, "launch_probe");
      throw new Error("Unbekannter Startprobe-Fehler");
    });
    assert.equal(result.kind, "startup-probe");
    assertPreserved(result, pid);
    assert.deepEqual(calls, ["launch", "launch_probe"]);
  }

  {
    const calls = [];
    const result = await executeLaunchOperation({}, 30_000, undefined, async (operation) => {
      calls.push(operation);
      throw new Error("Startantwort verloren; Prozesszustand unbekannt");
    });
    assert.equal(result.kind, "startup-launch");
    assertPreserved(result, undefined);
    assert.deepEqual(calls, ["launch"]);
  }

  for (const initial of [
    { ok: false, kind: "worker", error: "Startantwort unbekannt" },
    { ok: false, kind: "worker", error: "Startantwort unvollstaendig", pid: 4122 },
    { ok: false, kind: "worker", error: "Startantwort mit ungueltiger PID", pid: "unknown" },
  ]) {
    const calls = [];
    const result = await executeLaunchOperation({}, 30_000, undefined, async (operation) => {
      calls.push(operation);
      return initial;
    });
    assertPreserved(result, Number.isInteger(initial.pid) ? initial.pid : undefined);
    assert.deepEqual(calls, ["launch"]);
  }

  {
    const unchanged = { ok: false, kind: "bad-args", error: "Vor Start blockiert", mutationStarted: false, resultingState: "unchanged" };
    const result = await executeLaunchOperation({}, 30_000, undefined, async () => unchanged);
    assert.equal(result, unchanged, "Nachweislich unveraenderter Vor-Start-Block bleibt unveraendert");
  }

  {
    const pid = 4123;
    const calls = [];
    const result = await executeLaunchOperation({}, 30_000, undefined, async (operation) => {
      calls.push(operation);
      if (operation === "launch") return { ok: true, launched: true, pid };
      assert.equal(operation, "launch_probe");
      return { ok: true, outcome: "observed", windows: [mainWindow(pid)],
        dialogs: [{ pid, hwnd: 9123, kind: "qt-dialog", recoveryPrompt: true }] };
    });
    assert.equal(result.blockedByDialog, true);
    assert.equal(result.instance.hwnd, 9001);
    assertPreserved(result, pid, true);
    assert.deepEqual(calls, ["launch", "launch_probe"]);
  }

  {
    const pid = 4124;
    let probeCalls = 0;
    const result = await executeLaunchOperation({}, 30_000, undefined, async (operation) => {
      if (operation === "launch") return { ok: true, launched: true, pid };
      assert.equal(operation, "launch_probe");
      probeCalls += 1;
      return probeCalls === 1
        ? { ok: true, outcome: "retry-fresh", windowProbeSucceeded: true, windows: [], dialogs: [],
            startupPrompts: [{ pid, hwnd: 9124, title: "SteuerSparErklärung", w: 518, h: 260 }] }
        : { ok: false, kind: "worker", error: "Aktueller Fensterzustand unbekannt" };
    });
    assert.equal(result.kind, "startup-question");
    assertPreserved(result, pid);
  }

  {
    const pid = 4125;
    const result = await executeLaunchOperation({}, 30_000, undefined, async (operation) => {
      if (operation === "launch") return { ok: true, launched: true, pid };
      assert.equal(operation, "launch_probe");
      return { ok: false, kind: "aborted", error: "Probe meldet Abbruch" };
    });
    assert.equal(result.kind, "aborted");
    assertPreserved(result, pid);
  }

  process.stdout.write("Launch-Orchestrierung: synthetischer PID-Scope, Retry, Dialog, Abort und Prozess-Erhalt bestanden\n");
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
