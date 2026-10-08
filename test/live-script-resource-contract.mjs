import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { SSE_MCP_TOOL_SCHEMAS } from "../dist/operation-catalog.js";

const readCompact = (name) => readFileSync(join(process.cwd(), "test", name), "utf8").replace(/\s+/gu, " ");

const multiInstance = readCompact("multi-instance-binding.mjs");
for (const required of [
  /fixtureCaseRef\(fixture, \{ extension: "\.Gew2025" \}\)/u,
  /sse_make_working_copy", \{ sourceRef, targetRef: firstRef,/u,
  /sse_make_working_copy", \{ sourceRef, targetRef: secondRef,/u,
  /sse_desktop_start", \{ caseRef: firstRef,/u,
  /sse_launch", \{ caseRef: secondRef,/u,
  /sse_save", \{ caseRef:/u,
  /sameFileIdentity\(identity, statSync\(target, \{ bigint: true \}\)\)/u,
  /sha256\(target\) !== fixtureHash/u,
  /for \(const target of \[firstPath, secondPath\]\)/u,
  /rmSync\(target, \{ force: true \}\)/u,
]) {
  assert.match(multiInstance, required, `Mehrinstanztest fehlt der Ressourcen-/Cleanup-Vertrag ${required}.`);
}
for (const forbidden of [
  /sse_make_working_copy", \{ source:/u,
  /sse_desktop_start", \{ file:/u,
  /sse_launch", \{ file:/u,
  /sse_save", \{ expectedPath:/u,
  /rmSync\([^)]*, \{ recursive: true/u,
]) {
  assert.doesNotMatch(multiInstance, forbidden,
    `Mehrinstanztest verwendet einen veralteten oder zu breiten Dateivertrag ${forbidden}.`);
}

const searchProbe = readCompact("probe-suche.mjs");
assert.match(searchProbe, /sse_screenshot", \{ resultRef: `results:probe-suche-\$\{process\.pid\}\.png` \}/u,
  "Suchprobe muss ihr Kontrollbild ueber eine maschinenneutrale results:-Referenz anfordern.");
assert.match(searchProbe, /console\.log\("Bild:", shot\?\.ref\)/u,
  "Suchprobe muss die kompakte MCP-Bildreferenz statt eines alten API-Pfadfelds ausgeben.");
assert.doesNotMatch(searchProbe, /sse_screenshot", \{ path:/u,
  "Suchprobe darf keinen absoluten Screenshotpfad mehr an MCP senden.");

assert.doesNotThrow(() => SSE_MCP_TOOL_SCHEMAS.sse_make_working_copy.parse({
  sourceRef: "cases:quelle.Gew2025",
  targetRef: "cases:sse-multi-first-123-abcd.Gew2025",
  expectedSourceHash: "A".repeat(64),
}));
assert.doesNotThrow(() => SSE_MCP_TOOL_SCHEMAS.sse_desktop_start.parse({
  caseRef: "cases:sse-multi-first-123-abcd.Gew2025",
  mode: "einur",
}));
assert.doesNotThrow(() => SSE_MCP_TOOL_SCHEMAS.sse_save.parse({
  caseRef: "cases:sse-multi-first-123-abcd.Gew2025",
  expectedHashBefore: "A".repeat(64),
}));
assert.doesNotThrow(() => SSE_MCP_TOOL_SCHEMAS.sse_screenshot.parse({
  resultRef: "results:probe-suche-123.png",
}));
assert.throws(() => SSE_MCP_TOOL_SCHEMAS.sse_make_working_copy.parse({
  source: "C:\\Faelle\\quelle.Gew2025",
  target: "C:\\Temp\\kopie.Gew2025",
  expectedSourceHash: "A".repeat(64),
}));

// Erfolgreiche Live-Laeufe muessen SSE regulaer schliessen. force=true laesst
// der Worker absichtlich in Stop-Process laufen und erzeugt dadurch eine
// Wiederherstellungsdatei, die den naechsten Produkttest blockiert.
const positionCase = readCompact("position-case.mjs");
assert.match(positionCase, /sse_close", \{ \.\.\.instance, discardChanges: true \}/u,
  "Die positionierte Wegwerfvorlage muss regulaer und verwerfend geschlossen werden.");

const writeJourney = readCompact("live-write-journey.mjs");
assert.match(writeJourney,
  /sse_close", \{ pid: first\.pid, hwnd: first\.hwnd, discardChanges: true \}/u,
  "Der erste erfolgreiche Schreibreise-Lauf muss regulaer geschlossen werden.");
assert.match(writeJourney,
  /sse_close", \{ pid: second\.pid, hwnd: second\.hwnd, discardChanges: true \}/u,
  "Der zweite erfolgreiche Schreibreise-Lauf muss regulaer geschlossen werden.");

const tableLifecycle = readCompact("table-lifecycle-transaction.mjs");
assert.match(tableLifecycle, /sse_close", \{ \.\.\.instance, discardChanges: true \}/u,
  "Der Tabellen-Livevertrag muss seine Wegwerfkopie regulaer schliessen.");

const visibleInputGuard = readCompact("visible-input-guard.mjs");
assert.match(visibleInputGuard,
  /pid: instance\.pid, hwnd: instance\.hwnd, discardChanges: true/u,
  "Eine gebundene sichtbare Testinstanz muss regulaer geschlossen werden.");

const ustvaNextYear = readCompact("live-ustva-next-year.mjs");
assert.match(ustvaNextYear,
  /pid: instance\.pid, hwnd: instance\.hwnd, discardChanges: true/u,
  "Der erfolgreiche UStVA-Lesenachweis muss regulaer geschlossen werden.");

const centerLive = readCompact("live-center-cases.mjs");
assert(
  centerLive.indexOf("stopped = await waitForExit(launcher") < centerLive.indexOf("removeOwnedMarker(markerText)"),
  "Center-Cleanup muss den gebundenen Prozessbaum vor seinem Eigentumsmarker beenden.",
);
assert.match(centerLive, /launcher\.stderr\.on\("data"/u,
  "Center-Launcher-stderr muss begrenzt abgelesen werden, damit die Pipe nicht blockiert.");
assert.match(centerLive, /if \(stopped\.code !== 0\)/u,
  "Center-Cleanup muss einen fehlerhaften Launcher-Exit melden.");

const centerLauncher = readFileSync(join(process.cwd(), "test", "start-center-on-desktop.ps1"), "utf8");
assert.match(centerLauncher, /\$assignedToJob = \$false/u);
assert(
  centerLauncher.indexOf("$assignedToJob = $true") > centerLauncher.indexOf("AssignProcessToJobObject"),
  "Job-Eigentum darf erst nach erfolgreicher Zuordnung gelten.",
);
assert.match(centerLauncher, /-not \$assignedToJob[\s\S]{0,250}TerminateProcess\(\$processHandle/u,
  "Ein vor der Jobzuordnung gescheiterter suspendierter Center muss ueber sein Handle beendet werden.");

// Execute the actual state-journey module with a recording transport. A
// failure immediately after launch must close only that exact owned instance,
// and a cleanup failure must preserve the primary failure in its diagnostic.
const sandbox = mkdtempSync(join(tmpdir(), "sse-state-cleanup-contract-"));
const statePath = resolve("test/live-state-journey.mjs");
const originalStateSource = readFileSync(statePath, "utf8");
const savedEnvironment = new Map(["SSE_PROFILE_ID", "SSE_TEST_CASE_DIR", "SSE_STATE_FIXTURE"]
  .map(name => [name, process.env[name]]));
try {
  const fixture = join(sandbox, "synthetic.Gew2025");
  writeFileSync(fixture, "synthetic transport fixture", { flag: "wx" });
  Object.assign(process.env, { SSE_PROFILE_ID: "2025", SSE_TEST_CASE_DIR: sandbox, SSE_STATE_FIXTURE: fixture });
  const transportPath = join(sandbox, "recording-transport.mjs");
  writeFileSync(transportPath, `
export const calls = [];
export let closeFails = false;
export let noWindow = false;
export function configure(fails, absentWindow) { calls.length = 0; closeFails = fails; noWindow = absentWindow; }
export class Client {
  async connect() { calls.push({name:"connect"}); }
  async close() { calls.push({name:"client-close"}); }
  async callTool(request) {
    calls.push(request);
    if(request.name === "sse_launch") return {content:[{type:"text",text:JSON.stringify({ok:true,pid:27182,instance:noWindow ? null : {pid:27182,hwnd:31415}})}]};
    if(request.name === "sse_page") throw new Error("intentional-primary-failure");
    if(request.name === "sse_close") {
      if(closeFails) throw new Error("intentional-cleanup-failure");
      return {content:[{type:"text",text:JSON.stringify({ok:true,stillRunning:false})}]};
    }
    throw new Error("Unexpected mutation after primary failure: " + request.name);
  }
}
export class StdioClientTransport { constructor(options) { this.options = options; } }
`, { flag: "wx" });
  const sdk = await import(pathToFileURL(transportPath).href);
  const adapted = originalStateSource
    .replace(/from (["'])([^"']+)\1/gu, (whole, quote, specifier) => {
      if (specifier.startsWith("node:")) return whole;
      const target = specifier.startsWith("@modelcontextprotocol/") ? transportPath
        : resolve("test", specifier);
      return `from ${JSON.stringify(pathToFileURL(target).href)}`;
    })
    .replace("const here = dirname(fileURLToPath(import.meta.url));",
      `const here = ${JSON.stringify(resolve("test"))};`);
  const adaptedPath = join(sandbox, "actual-state-journey.mjs");
  writeFileSync(adaptedPath, adapted, { flag: "wx" });
  for (const [index, scenario] of [
    { closeFails: false, noWindow: false },
    { closeFails: true, noWindow: false },
    { closeFails: false, noWindow: true },
  ].entries()) {
    const { closeFails, noWindow } = scenario;
    sdk.configure(closeFails, noWindow);
    let failure;
    try { await import(`${pathToFileURL(adaptedPath).href}?failure-case=${index}`); }
    catch (error) { failure = error; }
    assert(failure instanceof Error && failure.message.includes(noWindow
      ? "Start lieferte kein Hauptfenster" : "intentional-primary-failure"));
    const closeCalls = sdk.calls.filter(call => call.name === "sse_close");
    assert.equal(closeCalls.length, 1, "Failed state journey leaked its owned instance or closed it repeatedly");
    assert.deepEqual(closeCalls[0].arguments, noWindow
      ? { pid: 27182, discardChanges: true, force: true }
      : { pid: 27182, hwnd: 31415, discardChanges: true });
    assert.equal(sdk.calls.at(-1).name, "client-close");
    assert.deepEqual(sdk.calls.filter(call => call.arguments).map(call => call.name),
      noWindow ? ["sse_launch", "sse_close"] : ["sse_launch", "sse_page", "sse_close"],
      "Cleanup executed a foreign action or continued the failed journey");
    assert.equal(failure.message.includes("intentional-cleanup-failure"), closeFails,
      "Cleanup failure must be reported alongside the original failure");
  }
  assert.equal(readFileSync(statePath, "utf8"), originalStateSource);
} finally {
  for (const [name, value] of savedEnvironment) value === undefined ? delete process.env[name] : process.env[name] = value;
  assert(resolve(sandbox).startsWith(resolve(tmpdir()) + sep), "Owned cleanup sandbox escaped the temporary directory");
  rmSync(sandbox, { recursive: true, force: true });
}

process.stdout.write("Optionale MCP-Liveskripte: Ressourcenreferenzen und enger Eigentums-Cleanup gebunden.\n");
