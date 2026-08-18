import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DesktopMarkerError,
  CENTER_TEST_OPERATIONS,
  MAX_DESKTOP_MARKER_BYTES,
  desktopMarkerPath,
  parseDesktopMarker,
  resolveDesktopMarkerForOperation,
} from "../dist/desktop-marker.js";

const directory = mkdtempSync(join(tmpdir(), "sse-desktop-marker-contract-"));
const markerPath = join(directory, "sse-mcp-desktop.txt");
const powershell = process.env.SSE_POWERSHELL_EXE ?? join(
  process.env.SystemRoot ?? process.env.WINDIR ?? "C:\\Windows",
  "System32", "WindowsPowerShell", "v1.0", "powershell.exe",
);
const worker = join(process.cwd(), "powershell", "sse-worker.ps1");

function expectMarkerError(action, kind) {
  assert.throws(action, (error) => {
    assert(error instanceof DesktopMarkerError);
    assert.equal(error.kind, kind);
    return true;
  });
}

function runPowerShellWorker(operation, environment = {}) {
  const result = spawnSync(
    powershell,
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", worker,
      "-Op", operation, "-B64", Buffer.from("{}", "utf8").toString("base64")],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      windowsHide: true,
      env: { ...process.env, TEMP: directory, TMP: directory, ...environment },
    },
  );
  assert.equal(result.error, undefined, result.error?.message);
  return JSON.parse(result.stdout.trim());
}

function writeMarker(text) {
  writeFileSync(markerPath, text, "utf8");
}

try {
  assert.equal(resolveDesktopMarkerForOperation(markerPath, "snapshot", false), null,
    "Nur eine wirklich fehlende Markerdatei darf den sichtbaren Desktop bedeuten.");

  assert.deepEqual(parseDesktopMarker("SSEAuto"), {
    schemaVersion: 0, owner: "sse", name: "SSEAuto", pid: null,
  });
  assert.deepEqual(parseDesktopMarker('{"name":"SSEAuto","pid":1234}'), {
    schemaVersion: 0, owner: "sse", name: "SSEAuto", pid: 1234,
  });
  assert.deepEqual(parseDesktopMarker('{"schemaVersion":1,"owner":"sse","name":"SSEAuto","pid":1234}'), {
    schemaVersion: 1, owner: "sse", name: "SSEAuto", pid: 1234,
  });

  assert.equal(desktopMarkerPath({ TEMP: directory }), markerPath);
  assert.equal(desktopMarkerPath({ TMP: directory }), markerPath);
  assert.deepEqual(CENTER_TEST_OPERATIONS, ["center_cases", "center_refresh"]);
  const workerSource = readFileSync(join(process.cwd(), "powershell", "sse-worker.ps1"), "utf8");
  const mirroredOperations = workerSource.match(/\$script:SSE_CENTER_TEST_OPERATIONS = @\(([^)]+)\)/u)?.[1]
    .match(/'([^']+)'/gu)?.map((value) => value.slice(1, -1));
  assert.deepEqual(mirroredOperations, [...CENTER_TEST_OPERATIONS],
    "Node und PowerShell muessen dieselben Center-Testoperationen erlauben.");

  for (const valid of [
    "SSEAuto",
    '{"name":"SSEAuto","pid":1234}',
    '{"schemaVersion":1,"owner":"sse","name":"SSEAuto","pid":1234}',
    '{"schemaVersion":1,"owner":"sse","name":"SSEAuto","pid":1234.0}',
  ]) {
    writeMarker(valid);
    assert.equal(resolveDesktopMarkerForOperation(markerPath, "product_info", false)?.owner, "sse");
    assert.equal(runPowerShellWorker("product_info").ok, true,
      "PowerShell lehnte einen von Node akzeptierten SSE-Marker ab.");
  }
  writeMarker('{"schemaVersion":1,"owner":"sse","name":"SSEAuto","pid":1234}');
  expectMarkerError(
    () => resolveDesktopMarkerForOperation(markerPath, "center_cases", true),
    "desktop-marker-owner",
  );
  assert.equal(runPowerShellWorker("center_cases", { SSE_CENTER_LIVE_TEST: "1" }).kind, "desktop-marker-owner",
    "Ein SSE-Marker darf Center-Operationen nicht auf den falschen privaten Desktop routen.");

  for (const invalid of [
    "",
    "../Visible",
    "{broken",
    '{"name":"SSEAuto","pid":0}',
    '{"name":"SSEAuto","pid":1,"extra":true}',
    '{"schemaVersion":2,"owner":"sse","name":"SSEAuto","pid":1}',
    '{"schemaVersion":1,"owner":"other","name":"SSEAuto","pid":1}',
    '{"schemaVersion":1,"owner":"sse","name":"SSEAuto","pid":1,"extra":true}',
    '{"Name":"SSEAuto","Pid":1}',
    '{"schemaVersion":1,"owner":"Center-Test","name":"SSEAuto","pid":1}',
  ]) {
    expectMarkerError(() => parseDesktopMarker(invalid), "desktop-marker-invalid");
    writeMarker(invalid);
    assert.equal(runPowerShellWorker("product_info").kind, "desktop-marker-invalid",
      "PowerShell akzeptierte einen von Node abgelehnten Marker.");
  }

  writeFileSync(markerPath, '{"schemaVersion":1,"owner":"center-test","name":"SSECenterTest","pid":4321}', "utf8");
  expectMarkerError(
    () => resolveDesktopMarkerForOperation(markerPath, "center_cases", false),
    "desktop-marker-owner",
  );
  expectMarkerError(
    () => resolveDesktopMarkerForOperation(markerPath, "snapshot", true),
    "desktop-marker-owner",
  );
  assert.equal(resolveDesktopMarkerForOperation(markerPath, "center_cases", true)?.name, "SSECenterTest");
  assert.equal(resolveDesktopMarkerForOperation(markerPath, "center_refresh", true)?.pid, 4321);

  writeFileSync(markerPath, Buffer.from([0xc3, 0x28]));
  expectMarkerError(
    () => resolveDesktopMarkerForOperation(markerPath, "snapshot", false),
    "desktop-marker-invalid",
  );
  assert.equal(runPowerShellWorker("product_info").kind, "desktop-marker-invalid");
  writeFileSync(markerPath, "x".repeat(MAX_DESKTOP_MARKER_BYTES + 1), "utf8");
  expectMarkerError(
    () => resolveDesktopMarkerForOperation(markerPath, "snapshot", false),
    "desktop-marker-invalid",
  );
  assert.equal(runPowerShellWorker("product_info").kind, "desktop-marker-invalid");

  writeFileSync(markerPath, "{broken", "utf8");
  assert.equal(runPowerShellWorker("product_info").kind, "desktop-marker-invalid",
    "Auch der PowerShell-Worker darf einen defekten Marker nicht sichtbar umgehen.");
  writeFileSync(markerPath, '{"schemaVersion":1,"owner":"center-test","name":"SSECenterTest","pid":4321}', "utf8");
  assert.equal(runPowerShellWorker("product_info", { SSE_CENTER_LIVE_TEST: "1" }).kind, "desktop-marker-owner",
    "Der PowerShell-Worker muss den Center-Test auf seine beiden Operationen begrenzen.");
  const status = runPowerShellWorker("desktop_status");
  assert.equal(status.ok, true, "Ein liegengebliebener Center-Testmarker muss diagnostizierbar bleiben.");
  assert.equal(status.markeVeraltet, true);
  assert.match(status.note, /Center-Testmarker/u);

  rmSync(markerPath, { force: true });
  const apiNegativeEnvironment = {
    ...process.env,
    TEMP: directory,
    TMP: directory,
    SSE_CENTER_LIVE_TEST: "1",
  };
  // Dieser gezielte Fehlerpfad hat eigene Assertions und ist keine
  // funktionale Ergebnisform-Evidenz fuer die globale Suiteratsche.
  delete apiNegativeEnvironment.SSE_TEST_OPERATION_TRACE_DIR;
  const apiNegative = spawnSync(
    process.execPath,
    ["test/with-api.mjs", process.execPath, "test/desktop-marker-api-negative.mjs"],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      windowsHide: true,
      env: apiNegativeEnvironment,
    },
  );
  assert.equal(apiNegative.error, undefined, apiNegative.error?.message);
  assert.equal(apiNegative.status, 0, "HTTP-Negativvertrag fuer fremden Marker scheiterte.");

  mkdirSync(markerPath);
  expectMarkerError(
    () => resolveDesktopMarkerForOperation(markerPath, "product_info", false),
    "desktop-marker-invalid",
  );
  assert.equal(runPowerShellWorker("product_info").kind, "desktop-marker-invalid",
    "Ein Marker-Verzeichnis muss in beiden Laufzeiten fail-closed stoppen.");
} finally {
  rmSync(directory, { recursive: true, force: true });
}

process.stdout.write("Desktop-Marker: Format, Eigentum, Center-Test-Grenze und Fail-Closed-I/O bestanden\n");
