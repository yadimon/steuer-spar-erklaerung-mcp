import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const worker = readFileSync(new URL("../powershell/sse-worker.ps1", import.meta.url), "utf8");

const functionBlock = (name) => {
  const marker = `function ${name}`;
  const start = worker.indexOf(marker);
  assert(start >= 0, `Worker-Funktion '${name}' fehlt.`);
  const next = worker.indexOf("\nfunction ", start + marker.length);
  return worker.slice(start, next >= 0 ? next : worker.length);
};

const emit = functionBlock("Emit($obj)");
const emitRelease = emit.indexOf("Exit-SSEForegroundLease -Force -Reason 'emit'");
assert(emitRelease >= 0, "Emit erzwingt keine Lease-Freigabe.");
assert(emitRelease < emit.indexOf("ConvertTo-Json"), "Lease wird erst nach der JSON-Serialisierung freigegeben.");
assert.match(emit, /focusTelemetry.*Get-SSEForegroundLeaseTelemetry/s);

const enter = functionBlock("Enter-SSEForegroundLease([IntPtr]$Hwnd)");
for (const required of [
  "$lease.previousForeground = [int64][SW]::GetForegroundWindow()",
  "$lease.previousCursor",
  "$lease.lastOwnedInputTick = Get-SSELastInputTick",
  "$lease.depth = [int]$lease.depth + 1",
  "$lease.acquisitions = [int]$lease.acquisitions + 1",
  "[int]$lease.acquisitions -gt 1 -and [SW]::GetForegroundWindow() -eq $Hwnd",
  "$lease.raises = [int]$lease.raises + 1",
  "Set-SSEForegroundWindowCore $Hwnd -Topmost",
]) assert(enter.includes(required), `Lease-Acquire-Vertrag fehlt: ${required}`);
assert(
  enter.indexOf("[int]$lease.acquisitions -gt 1") < enter.indexOf("$lease.raises = [int]$lease.raises + 1"),
  "Verschachtelte Lease wird erst nach einem redundanten Raise erkannt.",
);

const checkpoint = functionBlock("Set-SSEForegroundLeaseInputCheckpoint");
assert(checkpoint.includes("$null -eq $lease.watch"), "Input-Checkpoint muss bis Emit aktiv bleiben.");
assert(!checkpoint.includes("$lease.depth -le 0"), "depth=0 darf eine Klick-Folgetaste nicht vom Lease abtrennen.");

const exit = functionBlock("Exit-SSEForegroundLease");
for (const required of [
  "$lease.depth = [int]$lease.depth - 1",
  "if ([int]$lease.depth -gt 0) { return }",
  "$lease.releasedByEmit = ($Reason -eq 'emit')",
  "[SW]::SetWindowPos($raised, $HWND_NOTOPMOST",
  "Test-SSELastInputUnchanged $lease.lastOwnedInputTick",
  "$lease.cursorRestored = [bool][SW]::SetCursorPos",
  "$currentPid -ne [int]$lease.targetPid",
  "Test-SSEWindowIsLockScreen $previous",
  "Set-SSEForegroundWindowCore $previous",
  "$lease.watch = $null",
]) assert(exit.includes(required), `Lease-Release-Vertrag fehlt: ${required}`);
assert(
  exit.indexOf("[SW]::SetWindowPos($raised, $HWND_NOTOPMOST") < exit.indexOf("$inputUnchanged ="),
  "TOPMOST-Cleanup haengt faelschlich von der Eingabe-Epoche ab.",
);
assert.match(exit, /if \(-not \$inputUnchanged\).*restoreSkippedReason = 'input-changed'/s);
assert(
  exit.indexOf("if (-not $Force)") < exit.indexOf("$lease.foregroundRestored"),
  "Explizites Zwischen-Hide darf den Benutzerfokus nicht wiederherstellen.",
);

const show = functionBlock("Show-SSEWindow([IntPtr]$hwnd)");
assert.match(show, /Enter-SSEForegroundLease \$hwnd/);
const hide = functionBlock("Hide-SSETopmost([IntPtr]$hwnd)");
assert.match(hide, /Exit-SSEForegroundLease -Hwnd \$hwnd/);
const complete = functionBlock("Complete-SSEPhysicalSection([IntPtr]$hwnd)");
assert.match(complete, /Exit-SSEForegroundLease -Hwnd \$hwnd -Force -Reason 'physical-section'/,
  "Abgeschlossener physischer Abschnitt gibt Fokus und Cursor nicht sofort zurueck.");

const click = functionBlock("Click-VerifiedPoint(");
for (const required of [
  "$script:SSE_FOREGROUND_LEASE.lastAcquireRaised",
  "ForegroundAttempts",
  "$foregroundAttempt",
  "Set-SSEForegroundLeaseInputCheckpoint",
  "Hide-SSETopmost $Window",
]) assert(click.includes(required), `Click-VerifiedPoint fehlt Lease-Vertrag: ${required}`);
assert.match(click, /for \(\$foregroundAttempt = 1; \$foregroundAttempt -le \$ForegroundAttempts; \$foregroundAttempt\+\+\)/u,
  "Click-VerifiedPoint muss die Vordergrundbindung begrenzt und ohne weitere Eingabe erneut versuchen.");
assert(!click.includes("targetPid = $targetPid"), "Click-VerifiedPoint exportiert eine dynamisch geerbte targetPid.");

const clickPointStart = worker.indexOf("\n  'click_point' {");
const clickPointEnd = worker.indexOf("\n  'keys' {", clickPointStart);
assert(clickPointStart >= 0 && clickPointEnd > clickPointStart, "click_point-Workerblock fehlt.");
const clickPoint = worker.slice(clickPointStart, clickPointEnd);
assert.match(clickPoint, /Click-VerifiedPoint[\s\S]*-ExpectedInputTick \$inputBeforeClick/s,
  "Der oeffentliche physische Klick muss denselben Input- und Root-verifizierten Helper wie Tabellenaktionen verwenden.");
assert.match(clickPoint, /-ExpectedInputTick \$inputBeforeClick -RequireForeground/u,
  "Der oeffentliche physische Klick braucht neben der Eingabe-Epoche den echten Vordergrund unmittelbar vor dem Input.");
assert(!clickPoint.includes("[SW]::mouse_event"),
  "click_point darf keinen zweiten, weniger streng gebundenen Mauspfad unterhalten.");
assert(!clickPoint.includes("[SW]::PostMessage"),
  "click_point darf keine dokumentationswidrige Hintergrund-Klickausnahme unterhalten.");

const semanticClickStart = worker.indexOf("\n  'click' {");
const semanticClickEnd = worker.indexOf("\n  'toggle' {", semanticClickStart);
assert(semanticClickStart >= 0 && semanticClickEnd > semanticClickStart, "click-Workerblock fehlt.");
const semanticClick = worker.slice(semanticClickStart, semanticClickEnd);
assert.match(semanticClick, /\$activationMethod = \$\(if \(\$radioSelectionMethod\) \{ \$radioSelectionMethod \} else \{ "uia-\$pattern" \}\)/u,
  "sse_click muss im Erfolgsresultat das tatsaechlich ausgefuehrte UIA-Pattern melden.");
assert.match(semanticClick, /'expand'\s+\{ \$el\.GetCurrentPattern\(\[System\.Windows\.Automation\.ExpandCollapsePattern\]::Pattern\)\.Expand\(\) \}/u,
  "expand muss das ExpandCollapsePattern ausfuehren.");
assert.match(semanticClick, /'collapse'\s+\{ \$el\.GetCurrentPattern\(\[System\.Windows\.Automation\.ExpandCollapsePattern\]::Pattern\)\.Collapse\(\) \}/u,
  "collapse muss das ExpandCollapsePattern ausfuehren.");

const commit = functionBlock("Commit-TrackedValue(");
for (const checkpoint of ["$afterClickInput", "$afterSelectInput", "$afterValueInput", "$afterCommitInput"]) {
  assert(
    commit.includes(`Set-SSEForegroundLeaseInputCheckpoint ${checkpoint}`),
    `Feld-Commit aktualisiert den eigenen Input-Checkpoint ${checkpoint} nicht.`,
  );
}
for (const focusBinding of ["$focusProbe = $focused", "$WLK.GetParent($focusProbe)", "$focusBound = $true", "chain=@($focusChain)"]) {
  assert(commit.includes(focusBinding), `Qt-Kindfokus ist nicht sicher an die Zielzelle gebunden: ${focusBinding}`);
}
assert(commit.includes("while ($settleWatch.ElapsedMilliseconds -lt 700)") &&
  commit.includes("Test-SSEScalarEqual $settledValue $Value") &&
  commit.includes("Complete-SSEPhysicalSection $Hwnd") &&
  !commit.includes("Start-Sleep -Milliseconds 700"),
"Qt-Commit wartet weiterhin pauschal oder gibt den Benutzerfokus erst beim Emit zurueck.");

const saveAsStart = worker.indexOf("\n  'save_as' {");
const saveAsEnd = worker.indexOf("\n  '", saveAsStart + 5);
const saveAs = worker.slice(saveAsStart, saveAsEnd);
assert.doesNotMatch(saveAs, /SendWait\('\^%s'\)/u,
  "save_as darf den unzuverlaessigen globalen Shortcut nicht mehr senden.");
assert.match(saveAs, /Open-SSEMenuByName \$hwnd 'Datei'/u,
  "save_as muss das exakt gebundene Datei-Menue ueber UI Automation oeffnen.");
assert.match(saveAs, /Get-SSEOpenMenuEntryMatches \$hwnd \$targetPid 'Speichern unter\.\.\.'/u,
  "save_as muss den sichtbaren Menueeintrag mit derselben Suche wie menu_click binden.");
assert.match(saveAs, /Click-VerifiedPoint \$saveAsMatch\.hwnd \$saveAsMatch\.node/u,
  "save_as muss ausschliesslich den unmittelbar verifizierten Menueeintrag ausloesen.");
assert.match(saveAs, /\$dialogWait = \[Diagnostics\.Stopwatch\]::StartNew\(\)/u,
  "save_as muss auf den nativen Dialog begrenzt warten statt ihn nach einer festen Pause nur einmal zu suchen.");
assert.match(saveAs, /while \(\$dialogWait\.ElapsedMilliseconds -lt 5000\)[\s\S]*Get-Windows 'SSE'/u,
  "Das begrenzte save_as-Polling muss den echten SSE-Dialog wiederholt neu erfassen.");

const topmostCore = functionBlock("Set-SSEForegroundWindowCore(");
assert.match(topmostCore, /if \(\$Topmost\).*SetWindowPos\(\$hwnd, \$HWND_TOPMOST/s);
assert(topmostCore.includes("Wait-SSEExactForeground $hwnd 150") &&
  topmostCore.includes("Wait-SSEExactForeground $hwnd 200") &&
  !topmostCore.includes("Start-Sleep -Milliseconds 150") &&
  !topmostCore.includes("Start-Sleep -Milliseconds 200"),
"Foreground-Aktivierung verwendet weiterhin feste Wartezeiten statt bounded polling.");

process.stdout.write(
  "Foreground-Lease: sofortiger Physical-Cleanup, bounded polling, Cursor/Fokus-Restore und Input-Race vertraglich gebunden.\n",
);
