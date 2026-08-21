/**
 * Vertrag des vorgewaermten Reservearbeiters.
 *
 * Der Reservearbeiter existiert nur aus einem Grund: das Zerlegen des grossen
 * Workerskripts vor dem Auftrag zu erledigen. Er darf deshalb
 *  - sich genau einmal als bereit melden,
 *  - genau EINEN Auftrag annehmen und danach enden,
 *  - dasselbe Ergebnis liefern wie der Kaltstart,
 *  - keine Auftragszeile akzeptieren, die die Transportgrenze umgeht,
 *  - und bei geschlossener Standardeingabe folgenlos enden.
 *
 * Die Zeitmessung ist bewusst KEIN Bestandteil dieses Vertrags: auf einer
 * ausgelasteten Maschine waere sie unzuverlaessig, und ein langsamer, aber
 * korrekter Reservearbeiter ist kein Fehler.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const worker = join(root, "powershell", "sse-worker.ps1");
const powershell = join(
  process.env.SystemRoot ?? "C:\\Windows",
  "System32",
  "WindowsPowerShell",
  "v1.0",
  "powershell.exe",
);

function newArgumentsFile() {
  const path = join(tmpdir(), `sse-args-${randomUUID().replaceAll("-", "")}.json`);
  writeFileSync(path, "{}", "utf8");
  return path;
}

function runWorker(argv, { jobLine } = {}) {
  return new Promise((resolve) => {
    const child = spawn(
      powershell,
      ["-ExecutionPolicy", "Bypass", "-NoLogo", "-NoProfile", "-NonInteractive", "-File", worker, ...argv],
      { windowsHide: true },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    if (jobLine === null) child.stdin.end();
    else if (jobLine !== undefined) child.stdin.end(`${jobLine}\n`, "utf8");
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

/** Erste Zeile ist die Bereitschaftsmeldung, der Rest das Auftragsergebnis. */
function splitPrewarmOutput(stdout) {
  const newline = stdout.indexOf("\n");
  assert(newline > 0, `Reservearbeiter meldete keine Bereitschaftszeile: ${stdout.slice(0, 400)}`);
  return { announcement: stdout.slice(0, newline).trim(), payload: stdout.slice(newline + 1).trim() };
}

// ---------------------------------------------------------- 1) Kaltstart als Mass
const coldArgumentsFile = newArgumentsFile();
const cold = await runWorker(["-Op", "product_info", "-ArgsFile", coldArgumentsFile]);
unlinkSync(coldArgumentsFile);
assert.equal(cold.code, 0, `Kaltstart scheiterte: ${cold.stderr.slice(0, 400)}`);
const coldResult = JSON.parse(cold.stdout.trim());
assert.equal(coldResult.ok, true);

// ------------------------------------- 2) Vorgewaermt liefert dasselbe Ergebnis
const warmArgumentsFile = newArgumentsFile();
const warm = await runWorker(["-Prewarm"], {
  jobLine: JSON.stringify({ op: "product_info", argsFile: warmArgumentsFile }),
});
unlinkSync(warmArgumentsFile);
assert.equal(warm.code, 0, `Vorgewaermter Lauf scheiterte: ${warm.stderr.slice(0, 400)}`);
const { announcement, payload } = splitPrewarmOutput(warm.stdout);
const ready = JSON.parse(announcement);
assert.equal(ready.prewarm, "ready", "Die erste Zeile muss die Bereitschaft melden.");
assert.equal(typeof ready.pid, "number");
const warmResult = JSON.parse(payload);
assert.equal(warmResult.ok, true);
assert.equal(warmResult.product, coldResult.product, "Warm und kalt muessen dasselbe Produktprofil melden.");
assert.equal(warmResult.profileId, coldResult.profileId);
assert.equal(warmResult.taxYear, coldResult.taxYear);
// Die Uhr startet erst mit dem Auftrag; die Wartezeit gehoert nicht dazu.
assert.equal(typeof warmResult.ms, "number");

// --------------------------------- 3) Die Transportgrenze gilt auch fuer Auftraege
const rejected = [
  ["kein JSON-Objekt", "nicht-json"],
  ["fremdes Feld", JSON.stringify({ op: "product_info", desktop: "boese" })],
  ["unzulaessiger Operationsname", JSON.stringify({ op: "Product-Info" })],
  ["fremde Argumentdatei", JSON.stringify({ op: "product_info", argsFile: "C:\\Windows\\win.ini" })],
];
for (const [label, jobLine] of rejected) {
  const run = await runWorker(["-Prewarm"], { jobLine });
  const { payload: body } = splitPrewarmOutput(run.stdout);
  const result = JSON.parse(body);
  assert.equal(result.ok, false, `${label} haette abgelehnt werden muessen.`);
  assert.equal(result.kind, "bad-args", `${label} muss als bad-args abgelehnt werden.`);
  assert.equal(run.code, 1, `${label} muss mit Exitcode 1 enden.`);
}

// ------------------------------- 4) Ohne Auftrag endet der Reservearbeiter still
const abandoned = await runWorker(["-Prewarm"], { jobLine: null });
assert.equal(abandoned.code, 0, "Ein nicht abgeholter Reservearbeiter muss folgenlos enden.");
const { payload: nothing } = splitPrewarmOutput(abandoned.stdout);
assert.equal(nothing, "", "Ohne Auftrag darf kein Ergebnis entstehen.");

process.stdout.write(
  "Vorgewaermter Arbeiter: Bereitschaft, gleiches Ergebnis wie kalt, " +
  `${rejected.length} abgewiesene Auftragszeilen und folgenloses Ende ohne Auftrag bestanden\n`,
);
