import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
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

process.stdout.write("Optionale MCP-Liveskripte: Ressourcenreferenzen und enger Eigentums-Cleanup gebunden.\n");
