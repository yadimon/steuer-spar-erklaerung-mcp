import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path) => readFileSync(resolve(process.cwd(), path), "utf8");
const packageJson = JSON.parse(read("package.json"));
const runner = read("test/run-live-core-read.mjs");
const sweep = read("test/live-muster-cases.mjs");
const withApi = read("test/with-api.mjs");
const expectations2024 = JSON.parse(read("profiles/2024/tests/expectations.json"));
const liveRunner = read("test/run-live-suite.mjs");

assert.equal(packageJson.scripts["test:live-core-read"], "npm run build && node test/run-live-core-read.mjs",
  "Das Core-Read-Gate muss immer gegen den frisch gebauten API-/MCP-Server laufen.");
assert.match(runner, /SSE_LIVE_MUSTER_MODE:\s*"core-read"/u,
  "Der Core-Read-Runner muss den eingeschraenkten Modus explizit waehlen.");
assert.match(runner, /SSE_PRESERVE_TEST_SANDBOX_ON_FAILURE:\s*"1"/u,
  "Ein fehlgeschlagener Core-Read muss seinen isolierten Diagnosebereich erhalten.");
assert.match(runner, /for \(const profileId of \["2025", "2024"\]\) runProfile\(profileId\);/u,
  "Der Core-Read-Runner muss beide Jahresprofile getrennt pruefen.");
assert.match(runner, /if \(profileId === "2024"\) env\.SSE_OPERATE_EXPERIMENTAL = "1";/u,
  "2024 darf nur mit dem expliziten Verifikations-Opt-in laufen.");
assert.match(runner, /for \(const key of \["SSE_LIVE_MUSTER_CASES", "SSE_MUSTER_DIR", "SSE_TEST_CASE_DIR", "SSE_CASE_DIR"\]\) delete env\[key\];/u,
  "Der Core-Read-Runner darf keine fremde Fallauswahl oder Ressourcenbereiche erben.");
assert.match(runner, /assertNoSse\("Vor dem Core-Read-Live-Gate"\);/u,
  "Der Core-Read-Runner darf keine bereits laufende SSE-Instanz uebernehmen.");
assert.match(runner, /assert\.equal\(leakedPids, "", `Nach Core-Read-Profil/u,
  "Der Core-Read-Runner muss Prozessreste nach jedem Profil ablehnen.");

assert.match(sweep, /\["full", "core-read"\]\.includes\(liveMode\)/u,
  "Der Muster-Sweep muss seinen Evidenzmodus fail-closed validieren.");
for (const gate of [
  "if (liveMode === \"full\" && definition.ustva)",
  "if (liveMode === \"full\" && definition.checker)",
  "if (liveMode === \"full\" && definition.id === allDefinitions[0].id)",
]) {
  assert(sweep.includes(gate), `Der Volltestbereich fehlt oder ist nicht klar auf full begrenzt: ${gate}`);
}
assert.match(sweep, /omittedInCoreRead: liveMode === "core-read"/u,
  "Das Core-Read-Ergebnis muss seinen bewusst nicht erbrachten Umfang ausweisen.");
assert.match(sweep, /async function closeOwnedLiveInstance\(instance, launchedPid\)/u,
  "Der Live-Sweep braucht einen zentralen, PID-gebundenen Cleanup-Pfad.");
assert.match(sweep, /async function waitForOwnSseShutdown\(\)/u,
  "Der Live-Sweep muss den asynchronen Abschluss eines bereits gestarteten discard-close abwarten.");
assert.match(sweep, /const cleanupError = await closeOwnedLiveInstance\(instance, launchedPid\);/u,
  "Die Cleanup-Entscheidung muss vor dem Entfernen der Wegwerfkopien fallen.");
assert.match(sweep, /if \(!cleanupError\) \{\s*await unlinkOwned\(target\);\s*await unlinkOwned\(stagedSource\);\s*\}/u,
  "Wegwerfkopien duerfen nur nach bestaetigtem Instanzstopp entfernt werden.");
assert.match(withApi, /const preserveTemporaryOnFailure = process\.env\.SSE_PRESERVE_TEST_SANDBOX_ON_FAILURE === "1";/u,
  "Der Test-API-Wrapper muss die explizite Diagnoseaufbewahrung kennen.");
assert.match(withApi, /if \(childFailed && preserveTemporaryOnFailure\) \{[\s\S]*Test-Sandbox zur Diagnose erhalten/u,
  "Ein fehlgeschlagener opt-in Live-Test darf seine Sandbox nicht still entfernen.");
assert.equal(expectations2024.snapshotCompare?.allowMissingOnly, true,
  "Engine-30-Snapshot-Differenzen muessen als profilierte, enge Diagnoseausnahme dokumentiert sein.");
assert.match(sweep, /function assertSnapshotComparison\(definition, compared\)/u,
  "Der Live-Sweep muss Snapshot-Differenzen je Profil fail-closed bewerten.");
assert.match(sweep, /assert\(missingOnlyAllowed,/u,
  "Eine nicht freigegebene Snapshot-Abweichung darf nicht als Erfolg durchgehen.");
assert.match(sweep, /\["postcondition-failed", "interference"\], 120_000/u,
  "Der strikte Baumklick muss eine verweigerte Foreground-Lease als fail-closed Diagnose weiterreichen.");
assert.match(sweep, /result\?\.structuredContent && typeof result\.structuredContent === "object"/u,
  "Der Live-Gate muss bei tolerierten MCP-Fehlern die vollstaendige kanonische Diagnose bevorzugen.");
assert.match(liveRunner, /let liveGateCompleted = false;/u,
  "Ein fehlgeschlagener strikter Live-Gate muss seine echte Abdeckungsspur unterscheiden koennen.");
assert.match(liveRunner, /if \(liveGateCompleted\) \{[\s\S]*Live-Abdeckungsspur zur Diagnose erhalten/u,
  "Die Live-Abdeckungsspur darf erst nach einem vollstaendig gruenen Gate entfernt werden.");

process.stdout.write("Core-Read-Live-Gate: Modusgrenze, Profilisolierung und Cleanup-Vertrag bestehen\n");
