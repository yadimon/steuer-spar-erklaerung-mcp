import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApiExecutor } from "../dist/api-executor.js";

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
    let windowCalls = 0;
    let closeCalls = 0;
    const execute = createApiExecutor(config, async (operation, args) => {
      if (operation === "launch") return { ok: true, launched: true, pid };
      if (operation === "windows") {
        windowCalls += 1;
        return windowCalls === 1
          ? { ok: false, kind: "transient", error: "UIA kurz nicht erreichbar" }
          : { ok: true, windows: [mainWindow(pid)] };
      }
      if (operation === "dialog_list") {
        assert.equal(args.pid, pid, "Dialogprobe muss vor dem Readback PID-begrenzt sein");
        return { ok: true, dialogs: [] };
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
    assert.equal(windowCalls, 2, "Transiente Fensterprobe muss mit frischem Worker wiederholt werden");
    assert.equal(closeCalls, 0, "Transiente Probe darf gesunden Start nicht beenden");
  }

  {
    const pid = 4102;
    const execute = createApiExecutor(config, async (operation, args) => {
      if (operation === "launch") return { ok: true, launched: true, pid };
      if (operation === "windows") {
        return { ok: true, windows: [{ pid, hwnd: 7102, title: "Wiederherstellung", w: 518, h: 260 }] };
      }
      if (operation === "dialog_list") {
        assert.equal(args.pid, pid);
        return { ok: true, dialogs: [{ pid, hwnd: 7102, title: "Wiederherstellung", kind: "native-dialog" }] };
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
      if (operation === "windows") {
        return {
          ok: true,
          windows: [{
            pid,
            hwnd: 8109,
            title: "Einkommensteuer 2025: SteuerSparErklärung für das Steuerjahr 2025 [31.30] - Steuerfall (Wiederhergestellt)",
            w: 1200,
            h: 800,
            minimiert: false,
          }],
        };
      }
      if (operation === "dialog_list") return { ok: true, dialogs: [] };
      return { ok: false, kind: "fixture", error: operation };
    });
    const result = await execute("launch", { mode: "normal" }, 30_000);
    assert.equal(result.ok, false, "Ein wiederhergestellter Fall darf nicht als bereit gelten.");
    assert.equal(result.kind, "recovered-state");
    assert.match(result.error, /Wiederherstellungsdatei/u);
    assert.equal(result.instance.hwnd, 8109, "Der Agent braucht das Fenster zum kontrollierten Schliessen.");
  }

  {
    const pid = 4103;
    const execute = createApiExecutor(config, async (operation) => {
      if (operation === "launch") return { ok: true, launched: true, pid };
      if (operation === "windows") return { ok: true, windows: [mainWindow(pid, 8101), mainWindow(pid, 8102)] };
      if (operation === "dialog_list") return { ok: true, dialogs: [] };
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
    let windowCalls = 0;
    let closeCalls = 0;
    const controller = new AbortController();
    const execute = createApiExecutor(config, async (operation) => {
      if (operation === "launch") return { ok: true, launched: true, pid };
      if (operation === "windows") {
        windowCalls += 1;
        return { ok: true, windows: [] };
      }
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
    await waitUntil(() => windowCalls > 0);
    controller.abort();
    const result = await pending;
    assert.equal(closeCalls, 1);
    assert.equal(result.pid, pid);
    assert.equal(result.processStillRunning, cleanupStillRunning);
    assert.equal(result.kind, cleanupStillRunning ? "startup-abort-cleanup" : "aborted");
  }

  {
    const pid = 4106;
    let windowCalls = 0;
    const controller = new AbortController();
    const execute = createApiExecutor(config, async (operation) => {
      if (operation === "launch") return { ok: true, launched: true, pid };
      if (operation === "windows") {
        windowCalls += 1;
        return { ok: true, windows: [] };
      }
      if (operation === "close") throw new Error("Cleanup-Worker nicht startbar");
      if (operation === "product_info") return { ok: false, error: "Status unbekannt" };
      return { ok: false, kind: "fixture", error: operation };
    });
    const pending = execute("launch", { mode: "normal" }, 30_000, controller.signal);
    await waitUntil(() => windowCalls > 0);
    controller.abort();
    const result = await pending;
    assert.equal(result.kind, "startup-abort-cleanup");
    assert.equal(result.pid, pid);
    assert.equal(result.processStillRunning, true, "Unbekannter Cleanup-Status muss fail-closed sein");
    assert.match(result.cleanupError, /Cleanup-Worker|unvollstaendig/);
  }

  process.stdout.write("Launch-Orchestrierung: PID-Scope, Retry, Dialog, Ambiguitaet und Cleanup-Gates bestanden\n");
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
