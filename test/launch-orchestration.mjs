import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApiExecutor } from "../dist/api-executor.js";
import { directWorker } from "./direct-worker-helpers.mjs";

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
          ["deadlineUnixMs", "hasCase", "pid", "planKind", "schemaVersion"].sort());
        assert.equal(args.schemaVersion, 1);
        assert.equal(args.planKind, "launch-readiness");
        assert.equal(args.pid, pid, "Startprobe muss vor jedem Readback PID-begrenzt sein");
        assert.equal(args.hasCase, false);
        assert(args.deadlineUnixMs > Date.now());
        assert(timeoutMs <= 30_000 && timeoutMs >= 29_000, "Workerfrist muss die absolute Startfrist fortsetzen");
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
  }

  {
    // Regression aus dem beta.10-VM-Lauf: SSE hatte eine Wiederherstellungsdatei
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
    assert.equal(result.instance.hwnd, 8109, "Der Agent braucht das Fenster zum kontrollierten Schliessen.");
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

  for (const cleanupStillRunning of [false, true]) {
    const pid = cleanupStillRunning ? 4105 : 4104;
    let probeCalls = 0;
    let closeCalls = 0;
    const controller = new AbortController();
    const execute = createApiExecutor(config, async (operation, _args, _timeoutMs, signal) => {
      if (operation === "launch") return { ok: true, launched: true, pid };
      if (operation === "launch_probe") return waitForProbeAbort(signal, () => { probeCalls += 1; });
      if (operation === "close") {
        closeCalls += 1;
        return cleanupStillRunning
          ? { ok: false, stillRunning: true, error: "Test-Cleanup fehlgeschlagen" }
          : { ok: true, stillRunning: false };
      }
      if (operation === "product_info") {
        return {
          ok: true,
          supportedRunning: cleanupStillRunning ? [{ pid, supported: true }] : [],
          ignoredRunning: [],
        };
      }
      return { ok: false, kind: "fixture", error: operation };
    });
    const pending = execute("launch", { mode: "normal" }, 30_000, controller.signal);
    await waitUntil(() => probeCalls > 0);
    controller.abort();
    const result = await pending;
    assert.equal(closeCalls, 1);
    assert.equal(result.pid, pid);
    assert.equal(result.processStillRunning, cleanupStillRunning);
    assert.equal(result.kind, cleanupStillRunning ? "startup-abort-cleanup" : "aborted");
  }

  {
    const pid = 4106;
    let probeCalls = 0;
    const controller = new AbortController();
    const execute = createApiExecutor(config, async (operation, _args, _timeoutMs, signal) => {
      if (operation === "launch") return { ok: true, launched: true, pid };
      if (operation === "launch_probe") return waitForProbeAbort(signal, () => { probeCalls += 1; });
      if (operation === "close") throw new Error("Cleanup-Worker nicht startbar");
      if (operation === "product_info") return { ok: false, error: "Status unbekannt" };
      return { ok: false, kind: "fixture", error: operation };
    });
    const pending = execute("launch", { mode: "normal" }, 30_000, controller.signal);
    await waitUntil(() => probeCalls > 0);
    controller.abort();
    const result = await pending;
    assert.equal(result.kind, "startup-abort-cleanup");
    assert.equal(result.pid, pid);
    assert.equal(result.processStillRunning, true, "Unbekannter Cleanup-Status muss fail-closed sein");
    assert.match(result.cleanupError, /Cleanup-Worker|unvollstaendig/);
  }

  {
    // Der private Worker-Vertrag bleibt streng typisiert und laeuft bei einer
    // bereits erreichten absoluten Deadline garantiert ohne UI-Poll sofort aus.
    const result = directWorker("launch_probe", {
      schemaVersion: 1,
      planKind: "launch-readiness",
      pid: 2147483647,
      hasCase: true,
      deadlineUnixMs: Date.now() - 1,
    }, { SSE_PROFILE_ID: "2024", SSE_OPERATE_EXPERIMENTAL: "1" });
    assert.equal(result.ok, true);
    assert.equal(result.outcome, "deadline");
    assert.deepEqual(result.windows, []);
    assert.deepEqual(result.dialogs, []);
  }

  process.stdout.write("Launch-Orchestrierung: PID-Scope, Retry, Dialog, Ambiguitaet und Cleanup-Gates bestanden\n");
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
