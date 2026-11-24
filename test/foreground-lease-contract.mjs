import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

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

const enter = functionBlock("Enter-SSEForegroundLease(");
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
  "$releaseInputTick = Get-SSELastInputTick",
  "Get-SSEInputEpochEvidence $lease.lastOwnedInputTick $releaseInputTick $lease.lastOwnedInputContext",
  "$inputUnchanged = [bool]$lease.releaseInputEvidence.unchanged",
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
assert.equal((exit.match(/Get-SSELastInputTick/gu) ?? []).length, 1,
  "Restore-Guard und Diagnose muessen dieselbe einmal gelesene Eingabe-Epoche verwenden.");
const telemetry = functionBlock("Get-SSEForegroundLeaseTelemetry");
assert(telemetry.includes("inputEpoch=$lease.releaseInputEvidence") &&
  telemetry.includes("beforeRestoreHwnd=$lease.foregroundBeforeRestore; afterRestoreHwnd=$lease.foregroundAfterRestore"),
  "Eingabe-Epoche und Vordergrundwechsel muessen getrennt diagnostiziert werden.");
assert(checkpoint.includes("$lease.lastOwnedInputContext = $Context"),
  "Ein eigener Eingabe-Checkpoint braucht den zugehoerigen Aktionskontext.");
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
assert.match(semanticClick, /\$activationMethod = \$\(if \(\$radioSelectionMethod\) \{ \$radioSelectionMethod \} elseif \(\$directNavigationLink\) \{ 'verified-point' \} else \{ "uia-\$pattern" \}\)/u,
  "sse_click muss im Erfolgsresultat UIA, Radio-Punkt oder direkten Navigations-Punkt korrekt melden.");
assert.match(semanticClick, /\$directNavigationLink = \[bool\]\([\s\S]*\$script:SSE_ENGINE_MAJOR -eq 31[\s\S]*\$expectedPageBefore -and \$expectedPageAfter -and[\s\S]*\$cands\.Count -eq 1 -and \$cands\[0\]\.type -eq 'Hyperlink'/u,
  "Der direkte Linkklick braucht Qt 31, beide Seitenbindungen und genau einen Hyperlink.");
assert.match(semanticClick, /\$freshLink = Convert-ExactElementToNode \$el[\s\S]*Click-VerifiedPoint \$hwnd \$freshLink -ExpectedRuntimeId \(\[string\]\$freshLink\.rid\)/u,
  "Der direkte Linkklick muss einen frisch gebundenen Knoten samt RuntimeId-Punktpruefung nutzen.");
assert(semanticClick.indexOf("$navigationInputBaseline =") < semanticClick.indexOf("$t = Walk-Tree"),
  "Die Eingabe-Epoche des direkten Links muss schon seine erste Seiten-/Zielbindung umfassen.");
assert.match(semanticClick, /Click-VerifiedPoint \$hwnd \$freshLink[\s\S]*?-ExpectedInputTick \$navigationInputBaseline -RequireForeground -ThrowOnFailure/u,
  "Der direkte Link braucht Eingabe-Epoche, echten Vordergrund und auffangbare Versanddaten.");
assert.match(semanticClick, /\$navigationDispatched = \$null\s+if \(\$_\.Exception\.Data\['inputDispatched'\] -is \[bool\]\) \{ \$navigationDispatched = \$_\.Exception\.Data\['inputDispatched'\] \}/u,
  "Fehlender oder ungueltiger Versandbeweis darf nicht als sicher ungesendet gelten.");
assert.match(semanticClick, /\$needsReconciliation = -not \(\$InputDispatched -is \[bool\] -and \$InputDispatched -eq \$false\)/u,
  "Nur ein echter boolscher Nichtversandbeweis darf die Versandunsicherheit aufheben.");
assert.match(semanticClick, /inputDispatched=\$InputDispatched; outcomeUnknown=\(\$needsReconciliation -or \$PreparationUnknown\)\s+reconciliationRequired=\(\$needsReconciliation -or \$inputContextUnproven -or \$PreparationReconciliation -or \$PreparationUnknown\); clickBinding=\$navigationClickBinding/u,
  "Versand-, Kontext- und Vorbereitungsunsicherheit muessen im gemeinsamen Navigationsfehler erhalten bleiben.");
for (const [variable, field] of [
  ["preparationReconciliation", "reconciliationRequired"],
  ["preparationUnknown", "preparationOutcomeUnknown"],
]) {
  assert(semanticClick.includes(`$${variable} = $_.Exception.Data['${field}'] -is [bool] -and $_.Exception.Data['${field}'] -eq $true`),
    `Navigationsfehler muss den boolschen Vorbereitungsnachweis '${field}' uebernehmen.`);
}
assert.match(semanticClick, /& \$emitNavigationPointFailure \$_\.Exception\.Message \$navigationKind \$navigationDispatched \$_\.Exception\.Data\['details'\] \$preparationReconciliation \$preparationUnknown/u,
  "Der direkte Link muss dieselben Versand- und Vorbereitungsnachweise an seinen Fehlerbericht weitergeben.");
assert.match(click, /\$script:AE::FromPoint[\s\S]*\$pointBound[\s\S]*if \(-not \$pointBound\)/u,
  "Der verifizierte Punktklick muss den UIA-Treffer unmittelbar vor dem Input binden.");
assert.match(semanticClick, /\$requiresHyperlinkPageChange = \[bool\]\([\s\S]*\[string\]\$erfolg\.type -ceq 'Hyperlink'/u,
  "Ein gebundener Qt-Hyperlink muss auch ohne bekannte Zielueberschrift einen Seitenwechselvertrag erhalten.");
assert.match(semanticClick, /\$hasNavigationPostcondition[\s\S]*uia-invoke\+verified-point-fallback/u,
  "Ein wirkungsloses Qt-Hyperlink-Invoke muss den verifizierten Point-Fallback verwenden.");
assert.match(semanticClick, /\$isNavigation -or \$hasNavigationPostcondition/u,
  "Ein Hyperlink-Erfolg darf erst nach bestaetigtem Seitenwechsel als verified gelten.");
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
assert(commit.indexOf("$target.SetFocus()") < commit.indexOf("[SW]::SetCursorPos($px, $py)"),
  "Koordinatenfreier UIA-Fokus muss vor dem verifizierten Point-Fallback versucht werden.");
assert(commit.includes("$focusBound = [bool]$target.Current.HasKeyboardFocus") &&
  commit.includes("$focusMethod = 'uia-set-focus'") && commit.includes("$focusMethod = 'verified-point'"),
"Direktfokus und Point-Fallback muessen ihren exakten Fokusbeweis und die tatsaechliche Methode melden.");
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
const saveDialog = functionBlock("Open-SSESaveAsDialog(");
assert(saveAs.indexOf("$sourceBinding = Test-CaseBinding") < saveAs.indexOf("Open-SSESaveAsDialog $hwnd $targetPid"),
  "save_as darf den Fokus erst nach der Quelldateibindung verwenden.");
assert.match(saveDialog, /Enter-SSEPopupForeground \$MainHwnd/u);
assert(saveDialog.indexOf("Enter-SSEPopupForeground $MainHwnd") < saveDialog.indexOf("Open-SSEMenuByName $MainHwnd 'Datei'"));
assert(saveDialog.indexOf("$inputBaseline = Get-SSELastInputTick") < saveDialog.indexOf("Enter-SSEPopupForeground $MainHwnd"));
assert(saveDialog.includes("-UseExistingPopupLease") && saveDialog.includes("-ForegroundWindow $MainHwnd"),
  "SaveAs darf sein geoeffnetes Popup nicht erneut aktivieren oder die urspruengliche Lease ersetzen.");
assert(!saveDialog.includes("Show-SSEWindow"),
  "Speichern unter muss vor Expand dieselbe Popup- und Eingabepruefung wie menu verwenden.");
assert.match(saveDialog, /Get-SSEOpenMenuEntryMatches \$MainHwnd \$TargetPid 'Speichern unter\.\.\.'/u);
assert.equal((saveDialog.match(/Click-VerifiedPoint /gu) ?? []).length, 1,
  "Das Oeffnen des Speicherdialogs darf den Menueklick nicht wiederholen.");
assert(!saveDialog.includes("SendWait") && !saveDialog.includes("Exit-SSEForegroundLease"),
  "Die gemeinsame Lease muss bis zur Dialogbestaetigung gelten, ohne Tastaturersatz.");
assert.match(saveDialog, /Get-Windows 'SSE'[\s\S]*5000 - \$wait\.ElapsedMilliseconds/u);
const menuStart = worker.indexOf("\n  'menu' {");
const menuEnd = worker.indexOf("\n  'menu_click' {", menuStart);
const menu = worker.slice(menuStart, menuEnd);
assert.match(menu, /Get-SSEOpenMenuEntryMatches \$hwnd \$targetPid ''/u,
  "Menueinventar und Auswahl muessen denselben Popup-Vertrag nutzen.");
assert(!menu.includes("catch { }") && !menu.includes("$mainTree"),
  "Ein unlesbares Popup darf nicht durch virtuelle Hauptbaum-Eintraege verdeckt werden.");
assert(menu.indexOf("Enter-SSEPopupForeground $hwnd") < menu.indexOf("Read-SSEMenuTree $hwnd $targetPid") &&
  menu.lastIndexOf("Enter-SSEPopupForeground $hwnd") < menu.indexOf("Open-SSEMenuByName $hwnd $wunsch"),
  "Benannte und vollstaendige Menueinventare brauchen vor Expand ein bestaetigtes Vordergrundfenster.");
assert(menu.includes("-PreserveForegroundReason 'requested-open-menu'"),
  "Ein angefordertes offenes Menue darf durch den Emit-Cleanup nicht wieder geschlossen werden.");

// Die echten Worker-Funktionen laufen gegen synthetische Untergrenzen.
// Keine Fenster, UIA-Provider oder Eingabe werden fuer diese Gegenproben gestartet.
const program = `${[
  "Enter-SSEPopupForeground(",
  "Get-SSEMenuPopupWindows(", "Get-SSEOpenMenuEntryMatches(",
  "Open-SSESaveAsDialog(", "Open-SSECaseCreateSaveDialog(",
].map(functionBlock).join("\n").replaceAll("[SW]::", "[SaveAsForegroundContract.Windows]::")}
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition 'using System; namespace SaveAsForegroundContract { public static class Windows { public static IntPtr Foreground; public static IntPtr GetForegroundWindow() { return Foreground; } } }'
$script:DESKTOP_NAME = $null
$script:events = [Collections.Generic.List[string]]::new()
function Check($Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
function Fail($Message, $Kind, $Details) {
  $error = [Exception]::new([string]$Message)
  $error.Data['kind'] = $Kind
  $error.Data['details'] = $Details
  throw $error
}
function ConvertTo-MenuLabel([string]$Name) { ($Name -replace ' Strg.*$', '').Trim() }
function Get-SSELastInputTick { $script:epochReads++; if ($script:firstEpochUnavailable -and $script:epochReads -eq 1) { $null } else { $script:inputTick } }
function Test-SSELastInputUnchanged($Tick) { $null -ne $Tick -and $Tick -eq $script:inputTick }
function Show-SSEWindow($Window) {
  $script:events.Add('focus'); $script:topmost=$true
  if (-not $script:foregroundLost) { [SaveAsForegroundContract.Windows]::Foreground=$Window }
  if ($script:inputChanged) { $script:inputTick++ }
  $script:foregroundAllowed
}
function Set-SSEForegroundLeaseInputCheckpoint($Tick, $CursorPoint, $Context) {
  $script:events.Add('checkpoint'); $script:checkpoint=$Tick
}
function Hide-SSETopmost($Window) { $script:events.Add('hide'); $script:topmost=$false }
function Open-SSEMenuByName($Window, $Name) {
  $script:events.Add('expand')
  Check (-not $script:topmost) 'Popup opened while its main was still TOPMOST'
  Check ([SaveAsForegroundContract.Windows]::Foreground -eq $Window) 'Popup opened without exact foreground'
  Check ($script:checkpoint -eq $script:inputTick) 'Popup adopted changed input'
  if ($script:inputAfterExpand) { $script:inputTick++ }
}
function Get-Windows($Application) { @($script:windows) }
function Walk-Tree($Window, $Limit, $Depth) {
  $script:events.Add('read-popup')
  if ($script:treeThrows) { throw 'Synthetic inaccessible popup' }
  [pscustomobject]@{ nodes=@($script:node); stats=[pscustomobject]@{truncated=$script:truncated;err=$false} }
}
function Test-SSEMenuPointBinding($Window, $Binding) {
  $script:bindingCalls++
  $Window -eq [IntPtr]92 -and $Binding.mainHwnd -eq 91 -and $Binding.processId -eq 51 -and $Binding.popupHwnd -eq 92 -and
    [SaveAsForegroundContract.Windows]::Foreground -eq [IntPtr]91
}
function Click-VerifiedPoint($Window, $Node, $ExpectedInputTick, [switch]$ThrowOnFailure, [switch]$RequireForeground,
  [IntPtr]$ForegroundWindow, [string]$ExpectedRuntimeId, [scriptblock]$BeforeClickCheck, $BeforeClickBinding, [switch]$UseExistingPopupLease) {
  Check ($RequireForeground -and $UseExistingPopupLease -and $ForegroundWindow -eq [IntPtr]91 -and $ExpectedRuntimeId -ceq $Node.rid) 'Lost compound popup authority'
  Check ($null -ne $BeforeClickCheck -and (& $BeforeClickCheck $Window $BeforeClickBinding $null $null)) 'Lost main/popup/process binding'
  if ($null -eq $ExpectedInputTick -or -not (Test-SSELastInputUnchanged $ExpectedInputTick)) {
    $error=[Exception]::new('Synthetic input changed after Expand');$error.Data['kind']='interference';$error.Data['inputDispatched']=$false;throw $error
  }
  $script:events.Add('click')
  Check ([bool]$ThrowOnFailure) 'Click failures must carry dispatch evidence'
  if ($script:clickThrows) {
    $error=[Exception]::new('Synthetic click response lost')
    if ($script:clickProof -is [bool]) { $error.Data['inputDispatched']=$script:clickProof }
    throw $error
  }
  $script:windows+=@($script:dialogsAfterClick)
}
function Get-CurrentHeading($Window) { $script:heading }
function Get-CasePathFromTitle($Title) { $script:loadedPath }
function Reset-Fixture {
  $script:events.Clear(); $script:foregroundAllowed=$true; $script:treeThrows=$false; $script:truncated=$false
  $script:foregroundLost=$false; $script:inputChanged=$false; $script:inputAfterExpand=$false; $script:inputTick=10; $script:checkpoint=$null; $script:topmost=$false; $script:bindingCalls=0
  $script:epochReads=0; $script:firstEpochUnavailable=$false
  [SaveAsForegroundContract.Windows]::Foreground=[IntPtr]99
  $script:clickThrows=$false; $script:clickProof=$null
  $script:heading='Neue Angaben'; $script:loadedPath=$null
  $script:node=[pscustomobject]@{type='MenuItem';name='Speichern unter... Strg+Alt+S';rid='menu.1';on=$true}
  $script:windows=@(
    [pscustomobject]@{pid=51;hwnd=91;cls='Main';title='Neuer Fall'},
    [pscustomobject]@{pid=51;hwnd=92;cls='QtPopupDropShadow';title=''},
    [pscustomobject]@{pid=51;hwnd=93;cls='SysShadow';title=''},
    [pscustomobject]@{pid=99;hwnd=94;cls='QtPopupDropShadow';title=''},
    [pscustomobject]@{pid=99;hwnd=96;cls='#32770';title='Speichern'})
  $script:dialogsAfterClick=@([pscustomobject]@{pid=51;hwnd=95;cls='#32770';title='Speichern'})
}
function Expect-Failure($Action, [string]$Kind, [int]$Clicks, [bool]$Unknown=$false) {
  $failure=$null
  try { & $Action | Out-Null } catch { $failure=$_.Exception }
  $script:lastFailure=$failure
  Check ($null -ne $failure) 'Expected a failure'
  Check ($failure.Data['kind'] -ceq $Kind) ('Unexpected failure: ' + $failure.Message)
  Check (@($script:events | Where-Object {$_ -ceq 'click'}).Count -eq $Clicks) 'Unexpected click count'
  if ($Unknown) {
    Check ($failure.Data['details'].outcomeUnknown -eq $true) 'Lost unknown outcome'
    Check ($failure.Data['details'].processPreserved -eq $true) 'Lost preserved process'
    Check ($failure.Data['details'].reconciliationRequired -eq $true) 'Lost reconciliation requirement'
    Check ($failure.Data['details'].retryable -eq $false) 'Unsafe retry'
  }
}
Reset-Fixture
$dialog=Open-SSESaveAsDialog ([IntPtr]91) 51
Check ($dialog.hwnd -eq 95) 'Dialog must belong to the bound process'
Check (($script:events -join ',') -ceq 'focus,checkpoint,hide,expand,read-popup,read-popup,click') 'Popup preparation must precede menu input'
Check ($script:bindingCalls -eq 1) 'SaveAs did not wire its real popup binding callback'
Reset-Fixture; $script:inputTick=0
$dialog=Open-SSESaveAsDialog ([IntPtr]91) 51
Check ($dialog.hwnd -eq 95 -and $script:checkpoint -eq 0) 'Compound SaveAs rejected a valid zero epoch'
Reset-Fixture; $script:inputAfterExpand=$true
Expect-Failure { Open-SSESaveAsDialog ([IntPtr]91) 51 } 'interference' 0
Check ($script:lastFailure.Data['details'].inputDispatched -eq $false -and $script:lastFailure.Data['details'].mutationStarted -eq $false) 'Input after Expand was adopted or replayed'
Reset-Fixture
$matches=@(Get-SSEOpenMenuEntryMatches ([IntPtr]91) 51 '')
Check ($matches.Count -eq 1 -and [int64]$matches[0].hwnd -eq 92) 'Popup duplicates or foreign/main windows included'
Reset-Fixture; $script:foregroundAllowed=$false
Expect-Failure { Open-SSESaveAsDialog ([IntPtr]91) 51 } 'foreground-failed' 0
Check (($script:events -join ',') -ceq 'focus,checkpoint') 'Expand ran without foreground'
Reset-Fixture; $script:inputTick=$null
Expect-Failure { Open-SSESaveAsDialog ([IntPtr]91) 51 } 'interference' 0
Check ($script:events.Count -eq 0) 'Unreadable input acquired foreground'
Reset-Fixture; $script:firstEpochUnavailable=$true
Expect-Failure { Open-SSESaveAsDialog ([IntPtr]91) 51 } 'interference' 0
Check ($script:events.Count -eq 0 -and $script:epochReads -eq 1) 'An unavailable original epoch was replaced before focus and Expand'
Reset-Fixture; $script:inputChanged=$true
Expect-Failure { Open-SSESaveAsDialog ([IntPtr]91) 51 } 'interference' 0
Check (($script:events -join ',') -ceq 'focus,checkpoint' -and $script:checkpoint -eq 10) 'Changed input was adopted or expanded'
Reset-Fixture; $script:foregroundLost=$true
Expect-Failure { Open-SSESaveAsDialog ([IntPtr]91) 51 } 'foreground-failed' 0
Check (($script:events -join ',') -ceq 'focus,checkpoint') 'Lost foreground expanded the menu'
Reset-Fixture; $script:windows=@($script:windows | Where-Object {$_.cls -notmatch 'PopupDropShadow|SysShadow'})
Expect-Failure { Open-SSESaveAsDialog ([IntPtr]91) 51 } 'not-found' 0
Reset-Fixture; $script:node.on=$false
Expect-Failure { Open-SSESaveAsDialog ([IntPtr]91) 51 } 'precondition-failed' 0
Reset-Fixture; $script:node.on='true'
Expect-Failure { Open-SSESaveAsDialog ([IntPtr]91) 51 } 'precondition-failed' 0
Reset-Fixture; $script:node.rid=''
Expect-Failure { Open-SSESaveAsDialog ([IntPtr]91) 51 } 'precondition-failed' 0
Reset-Fixture; $script:node=@($script:node, [pscustomobject]@{type='MenuItem';name='Speichern unter...';rid='menu.2';on=$true})
Expect-Failure { Open-SSESaveAsDialog ([IntPtr]91) 51 } 'ambiguous' 0
Reset-Fixture; $script:truncated=$true
Expect-Failure { Open-SSESaveAsDialog ([IntPtr]91) 51 } 'snapshot-truncated' 0
Reset-Fixture; $script:treeThrows=$true
Expect-Failure { Open-SSESaveAsDialog ([IntPtr]91) 51 } 'snapshot-failed' 0
Reset-Fixture; $script:windows+= $script:dialogsAfterClick
Expect-Failure { Open-SSESaveAsDialog ([IntPtr]91) 51 } 'precondition-failed' 0
Check ($script:events.Count -eq 0) 'Existing modal acquired foreground'
Check ($script:lastFailure.Data['details'].processPreserved -eq $true) 'Existing dialog was not preserved'
Check ($script:lastFailure.Data['details'].outcomeUnknown -eq $false) 'Unsent menu input was invented'
Reset-Fixture; $script:windows+= [pscustomobject]@{pid=51;hwnd=97;cls='Qt692QWindowIcon';title='Rueckfrage'}
Expect-Failure { Open-SSESaveAsDialog ([IntPtr]91) 51 } 'precondition-failed' 0
Check ($script:events.Count -eq 0) 'Existing Qt peer acquired foreground'
Reset-Fixture; $script:dialogsAfterClick+= [pscustomobject]@{pid=51;hwnd=96;cls='#32770';title='Speichern'}
Expect-Failure { Open-SSESaveAsDialog ([IntPtr]91) 51 } 'ambiguous' 1 $true
Reset-Fixture; $script:clickThrows=$true
Expect-Failure { Open-SSESaveAsDialog ([IntPtr]91) 51 } 'worker' 1 $true
Reset-Fixture; $script:clickThrows=$true; $script:clickProof=$true
Expect-Failure { Open-SSESaveAsDialog ([IntPtr]91) 51 } 'worker' 1 $true
Reset-Fixture; $script:clickThrows=$true; $script:clickProof=$false
Expect-Failure { Open-SSESaveAsDialog ([IntPtr]91) 51 } 'worker' 1
Check ($script:lastFailure.Data['details'].outcomeUnknown -eq $false) 'Explicit unsent proof was lost'
Check ($script:lastFailure.Data['details'].processPreserved -eq $true) 'Click context was not preserved'
$main=[pscustomobject]@{pid=51;hwnd=91;title='Neuer Fall';minimiert=$false}
$request=[pscustomobject]@{kind='case-create';expectedPage='Neue Angaben';expectedDialogTitle='Speichern'}
Reset-Fixture
$dialog=Open-SSECaseCreateSaveDialog $main $request
Check ($dialog.hwnd -eq 95) 'Private case creation did not return its bound dialog'
Reset-Fixture; $script:heading='Fremde Angaben'
Expect-Failure { Open-SSECaseCreateSaveDialog $main $request } 'interference' 0
Check ($script:events.Count -eq 0) 'Wrong page acquired foreground'
Reset-Fixture; $script:loadedPath='synthetic.GewErfass2026'
Expect-Failure { Open-SSECaseCreateSaveDialog $main $request } 'interference' 0
Check ($script:events.Count -eq 0) 'Loaded case acquired foreground'
Reset-Fixture; $main.minimiert=$true
Expect-Failure { Open-SSECaseCreateSaveDialog $main $request } 'interference' 0
Check ($script:events.Count -eq 0) 'Minimized case acquired foreground'
$main.minimiert=$false
Reset-Fixture
Expect-Failure { Open-SSECaseCreateSaveDialog $main ([pscustomobject]@{kind='case-create'}) } 'bad-args' 0
Reset-Fixture; $request.expectedDialogTitle='Anderer Dialog'
Expect-Failure { Open-SSECaseCreateSaveDialog $main $request } 'postcondition-failed' 1 $true
[Console]::Write('passed')
`;
const bootstrap = `[Console]::InputEncoding=[Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$request=[Console]::In.ReadToEnd() | ConvertFrom-Json
& ([ScriptBlock]::Create([string]$request.program))`;
const behavioral = spawnSync("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand",
  Buffer.from(bootstrap, "utf16le").toString("base64")], {
  input: JSON.stringify({ program }), encoding: "utf8", windowsHide: true, timeout: 60_000, maxBuffer: 1024 * 1024,
});
assert.equal(behavioral.error, undefined, "PowerShell-Gegenproben konnten nicht abgeschlossen werden.");
assert.equal(behavioral.status, 0, behavioral.stderr);
assert.equal(behavioral.stdout.trim(), "passed");

const topmostCore = functionBlock("Set-SSEForegroundWindowCore(");
assert.match(topmostCore, /if \(\$Topmost\).*SetWindowPos\(\$hwnd, \$HWND_TOPMOST/s);
assert(topmostCore.includes("Wait-SSEExactForeground $hwnd 150") &&
  topmostCore.includes("Wait-SSEExactForeground $hwnd 200") &&
  !topmostCore.includes("Start-Sleep -Milliseconds 150") &&
  !topmostCore.includes("Start-Sleep -Milliseconds 200"),
"Foreground-Aktivierung verwendet weiterhin feste Wartezeiten statt bounded polling.");

// Dritte Aktivierungsstufe: Nur wenn das Vordergrundfenster die Kopplung seiner
// Eingabewarteschlange verweigert, darf das eigene Ziel ueber genau eine eigene
// Eingabe aktiviert werden. Die Rueckgabe an ein solches Fenster entfaellt.
assert.match(topmostCore,
  /Wait-SSEExactForeground \$hwnd 200\) \{ return \$true \}\s+#[^\n]*\n\s+#[^\n]*\n\s+if \(\$Topmost -and \$vorne -ne \[IntPtr\]::Zero -and \$tidFremd -ne 0 -and \$tidFremd -ne \$tidSelbst -and\s+-not \$attachedForeground\) \{\s+return \(Enter-SSEForegroundInputSink \$hwnd \$vorne\)/u,
  "Die Eingabe-Aktivierung darf nur dem eigenen Ziel nach verweigerter Kopplung dienen.");
assert.equal((topmostCore.match(/Enter-SSEForegroundInputSink/gu) ?? []).length, 1,
  "Die Eingabe-Aktivierung hat genau einen Aufrufer.");
assert.equal((worker.match(/Enter-SSEForegroundInputSink \$/gu) ?? []).length, 1,
  "Kein anderer Workerpfad darf die Eingabe-Aktivierung direkt ausloesen.");
assert.equal((worker.match(/\[SW\]::ActivateThroughInputSink\(/gu) ?? []).length, 1,
  "Der native Eingabe-Helfer hat genau einen Aufrufer.");
const inputSink = functionBlock("Enter-SSEForegroundInputSink(");
assert(inputSink.indexOf("$lease.unattachableForeground.Add([int64]$DeniedForeground)") <
  inputSink.indexOf("[SW]::ActivateThroughInputSink($Hwnd, 600)"),
  "Das verweigernde Fenster muss vor jedem Aktivierungsversuch festgehalten werden.");
assert.match(inputSink,
  /if \(\$script:DESKTOP_NAME -or \[int\]\$lease\.inputSinkAttempts -ge 3 -or\s+\(Test-SSEWindowIsLockScreen \$DeniedForeground\)\) \{ return \$false \}/u,
  "Privater Desktop, Sperrbildschirm und die Versuchsgrenze muessen vor der Eingabe stoppen.");
assert(!inputSink.includes("mouse_event") && !inputSink.includes("SendKeys") && !inputSink.includes("SetCursorPos"),
  "Die Eingabe-Aktivierung darf keinen zweiten Eingabeweg neben dem nativen Helfer besitzen.");
assert(exit.indexOf("'previous-window-refused-input-attachment'") > exit.indexOf("$lease.restoreSkippedReason = $PreserveForegroundReason") &&
  exit.indexOf("'previous-window-refused-input-attachment'") < exit.indexOf("Set-SSEForegroundWindowCore $previous"),
  "An ein Fenster mit verweigerter Kopplung darf der Vordergrund nicht zurueckgegeben werden.");
const nativeSource = readFileSync(new URL("../powershell/sse-native.cs", import.meta.url), "utf8");
const sinkStart = nativeSource.indexOf("public static long[] ActivateThroughInputSink(");
assert(sinkStart >= 0, "Nativer Eingabe-Helfer fehlt.");
const sinkSource = nativeSource.slice(sinkStart, nativeSource.indexOf("\n  }\n", sinkStart));
assert(sinkSource.indexOf("WindowFromPoint(current) != sink") < sinkSource.indexOf("SendInput(2, click"),
  "Der eigene Klick darf erst nach der Punktbindung an das eigene Fenster gesendet werden.");
assert(sinkSource.includes("current.X != pointer.X || current.Y != pointer.Y"),
  "Ein inzwischen bewegter Mauszeiger muss die Eingabe verhindern.");
assert.equal((sinkSource.match(/SendInput\(/gu) ?? []).length, 1, "Der Helfer sendet genau eine Eingabefolge.");
assert(!sinkSource.includes("SetCursorPos") && !sinkSource.includes("mouse_event") && !sinkSource.includes("keybd_event"),
  "Der Helfer darf weder den Mauszeiger bewegen noch Tasten senden.");
assert(sinkSource.includes("if (sink != IntPtr.Zero) DestroyWindow(sink);") &&
  sinkSource.indexOf("finally") < sinkSource.indexOf("DestroyWindow(sink)"),
  "Das eigene Fenster muss auf jedem Ausgang entfernt werden.");

// Eine Epoche, die den Prozess verlaesst, muss die eigene Aktivierungseingabe
// bereits enthalten: Die naechste Phase und die native Bruecke vergleichen roh.
for (const exported of [
  "inputEpoch=(Resolve-SSEOwnedInputTick $InputEpoch)",
  "inputEpoch=(Resolve-SSEOwnedInputTick $inputBaseline)",
  "inputEpoch=(Resolve-SSEOwnedInputTick $deleteInputBaseline)",
]) assert.equal(worker.split(exported).length - 1, 1, `Weitergegebene Eingabe-Epoche fehlt oder ist mehrdeutig: ${exported}`);
for (const raw of ["inputEpoch=$InputEpoch;", "inputEpoch=$inputBaseline;", "inputEpoch=$deleteInputBaseline;"]) {
  assert(!worker.includes(raw), `Eine Phase gibt ihre Eingabe-Epoche ohne die eigene Aktivierung weiter: ${raw}`);
}
const cursorLease = readFileSync(new URL("../powershell/table-cursor-lease.ps1", import.meta.url), "utf8");
assert(cursorLease.includes("$ownedTick=Resolve-SSEOwnedInputTick $InputTick") &&
  cursorLease.includes("previousCursor=$lease.previousCursor;inputEpoch=$ownedTick}") &&
  cursorLease.includes("@($lease.unattachableForeground) -contains [int64]$lease.previousForeground"),
  "Die Lease-Uebergabe muss die fortgefuehrte Epoche und kein Fenster mit verweigerter Kopplung weitergeben.");

const leaseInitializer = worker.match(/\$script:SSE_FOREGROUND_LEASE = \[ordered\]@\{[\s\S]*?\n\}\n/u)?.[0];
assert(leaseInitializer, "Lease-Initialisierung fehlt.");
const inputSinkProgram = `${[leaseInitializer,
  ...["Enter-SSEForegroundInputSink(", "Resolve-SSEOwnedInputTick(", "Test-SSELastInputUnchanged(", "Get-SSEInputEpochEvidence(",
    "Exit-SSEForegroundLease"]
    .map(functionBlock)].join("\n").replaceAll("[SW]::", "[InputSinkContract.Windows]::").replaceAll("SW+PT", "InputSinkContract.Point")}
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
namespace InputSinkContract {
  public struct Point { public int X, Y; }
  public static class Windows {
    public static IntPtr Foreground; public static long Tick; public static long[] Evidence; public static bool Throws;
    public static int SinkCalls; public static int TargetPid; public static IntPtr ForegroundAfterSink;
    public static long[] ActivateThroughInputSink(IntPtr target, int timeoutMs) {
      SinkCalls++;
      if (Throws) throw new InvalidOperationException("synthetic sink failure");
      if (Evidence[2] == 1 && Evidence[7] >= 0) Tick = Evidence[7];
      Foreground = ForegroundAfterSink;
      return (long[])Evidence.Clone();
    }
    public static IntPtr GetForegroundWindow() { return Foreground; }
    public static bool IsWindow(IntPtr h) { return h != IntPtr.Zero; }
    public static bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags) { return true; }
    public static uint GetWindowThreadProcessId(IntPtr h, out int pid) { pid = h == new IntPtr(91) ? TargetPid : 7; return 1; }
    public static bool GetCursorPos(out Point p) { p = new Point(); return true; }
    public static bool SetCursorPos(int x, int y) { return true; }
  }
}
'@
function Check($Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
function Get-SSELastInputTick { if ([InputSinkContract.Windows]::Tick -lt 0) { $null } else { [uint64][InputSinkContract.Windows]::Tick } }
function Test-SSEWindowIsLockScreen($Window) { [bool]$script:lockScreen }
function Set-SSEForegroundWindowCore($Window) { $script:restores++; [InputSinkContract.Windows]::Foreground = $Window; $true }
function Reset-Fixture {
  $lease = $script:SSE_FOREGROUND_LEASE
  $lease.unattachableForeground.Clear(); $lease.ownActivationInputs.Clear(); $lease.inputSinkAttempts = 0
  $lease.lastOwnedInputTick = $null; $lease.lastOwnedInputContext = $null; $lease.watch = $null; $lease.depth = 0
  $lease.raisedWindows.Clear(); $lease.previousCursor = $null; $lease.ownedCursorPoint = $null
  $lease.previousForeground = [int64]0; $lease.targetPid = 0; $lease.restoreSkippedReason = $null; $lease.foregroundRestored = $false
  $script:DESKTOP_NAME = $null; $script:lockScreen = $false; $script:restores = 0
  [InputSinkContract.Windows]::Tick = 100; [InputSinkContract.Windows]::Foreground = [IntPtr]99
  [InputSinkContract.Windows]::ForegroundAfterSink = [IntPtr]91; [InputSinkContract.Windows]::Throws = $false
  [InputSinkContract.Windows]::SinkCalls = 0; [InputSinkContract.Windows]::TargetPid = 51
  [InputSinkContract.Windows]::Evidence = [long[]]@(1,1,1,1,1,1,100,105)
}
Reset-Fixture; $script:SSE_FOREGROUND_LEASE.lastOwnedInputTick = [uint64]100
Check (Enter-SSEForegroundInputSink ([IntPtr]91) ([IntPtr]99)) 'A delivered own click with exact foreground was not accepted'
Check ([InputSinkContract.Windows]::SinkCalls -eq 1 -and @($script:SSE_FOREGROUND_LEASE.unattachableForeground) -contains [int64]99) 'Denied window was not recorded'
Check ($script:SSE_FOREGROUND_LEASE.ownActivationInputs.Count -eq 1) 'Own activation input was not recorded exactly once'
Check ($script:SSE_FOREGROUND_LEASE.lastOwnedInputTick -eq 105 -and $script:SSE_FOREGROUND_LEASE.lastOwnedInputContext -ceq 'foreground-input-sink') 'Lease did not adopt its own activation input'
Check ((Test-SSELastInputUnchanged ([uint64]100)) -and (Test-SSELastInputUnchanged ([uint64]105))) 'Own activation input was reported as foreign'
Check (-not (Test-SSELastInputUnchanged ([uint64]98)) -and -not (Test-SSELastInputUnchanged $null)) 'Input before the own activation was hidden'
Check ((Resolve-SSEOwnedInputTick ([uint64]100)) -eq 105 -and (Resolve-SSEOwnedInputTick ([uint64]105)) -eq 105 -and
  (Resolve-SSEOwnedInputTick ([uint64]98)) -eq 98 -and $null -eq (Resolve-SSEOwnedInputTick $null)) 'A handed-over epoch must be carried across exactly the own activation'
[InputSinkContract.Windows]::Tick = 106
Check (-not (Test-SSELastInputUnchanged ([uint64]100)) -and -not (Test-SSELastInputUnchanged ([uint64]105))) 'Foreign input after the own activation was hidden'
Reset-Fixture; $script:SSE_FOREGROUND_LEASE.lastOwnedInputTick = [uint64]42
$null = Enter-SSEForegroundInputSink ([IntPtr]91) ([IntPtr]99)
Check ($script:SSE_FOREGROUND_LEASE.lastOwnedInputTick -eq 42 -and $null -eq $script:SSE_FOREGROUND_LEASE.lastOwnedInputContext) 'Lease adopted an unrelated epoch'
Reset-Fixture
$null = Enter-SSEForegroundInputSink ([IntPtr]91) ([IntPtr]99)
[InputSinkContract.Windows]::Evidence = [long[]]@(1,1,1,1,1,1,105,111); [InputSinkContract.Windows]::Foreground = [IntPtr]99
Check (Enter-SSEForegroundInputSink ([IntPtr]91) ([IntPtr]99)) 'Second own activation failed'
Check ((Test-SSELastInputUnchanged ([uint64]100)) -and (Test-SSELastInputUnchanged ([uint64]105)) -and (Test-SSELastInputUnchanged ([uint64]111))) 'Consecutive own activations were not followed in order'
Check (@($script:SSE_FOREGROUND_LEASE.unattachableForeground).Count -eq 1) 'Denied window was recorded twice'
Reset-Fixture; [InputSinkContract.Windows]::Evidence = [long[]]@(1,0,0,0,0,0,-1,-1); [InputSinkContract.Windows]::ForegroundAfterSink = [IntPtr]99
Check (-not (Enter-SSEForegroundInputSink ([IntPtr]91) ([IntPtr]99))) 'Unsent input was reported as activation'
Check ($script:SSE_FOREGROUND_LEASE.ownActivationInputs.Count -eq 0 -and @($script:SSE_FOREGROUND_LEASE.unattachableForeground) -contains [int64]99) 'Unsent input changed the epoch record or lost the denied window'
Reset-Fixture; [InputSinkContract.Windows]::Evidence = [long[]]@(1,1,1,1,1,0,100,105); [InputSinkContract.Windows]::ForegroundAfterSink = [IntPtr]99
Check (-not (Enter-SSEForegroundInputSink ([IntPtr]91) ([IntPtr]99))) 'Missing target foreground was reported as activation'
Check ($script:SSE_FOREGROUND_LEASE.ownActivationInputs.Count -eq 1 -and (Test-SSELastInputUnchanged ([uint64]100))) 'A sent own click must stay attributable even without foreground'
Reset-Fixture; [InputSinkContract.Windows]::Evidence = [long[]]@(1,1,1,1,1,1,100,105); [InputSinkContract.Windows]::ForegroundAfterSink = [IntPtr]77
Check (-not (Enter-SSEForegroundInputSink ([IntPtr]91) ([IntPtr]99))) 'Helper evidence replaced the exact foreground readback'
Reset-Fixture; [InputSinkContract.Windows]::Evidence = [long[]]@(1,1,1,1,1,1,-1,-1)
$null = Enter-SSEForegroundInputSink ([IntPtr]91) ([IntPtr]99)
[InputSinkContract.Windows]::Tick = 105
Check ($script:SSE_FOREGROUND_LEASE.ownActivationInputs.Count -eq 0 -and -not (Test-SSELastInputUnchanged ([uint64]100))) 'An unreadable own epoch was guessed'
Reset-Fixture; [InputSinkContract.Windows]::Throws = $true
Check (-not (Enter-SSEForegroundInputSink ([IntPtr]91) ([IntPtr]99)) -and $script:SSE_FOREGROUND_LEASE.ownActivationInputs.Count -eq 0) 'A failing helper was reported as activation'
Reset-Fixture; $script:DESKTOP_NAME = 'SyntheticDesktop'
Check (-not (Enter-SSEForegroundInputSink ([IntPtr]91) ([IntPtr]99)) -and [InputSinkContract.Windows]::SinkCalls -eq 0) 'Private desktop sent activation input'
Reset-Fixture; $script:lockScreen = $true
Check (-not (Enter-SSEForegroundInputSink ([IntPtr]91) ([IntPtr]99)) -and [InputSinkContract.Windows]::SinkCalls -eq 0) 'Lock screen received activation input'
Reset-Fixture; [InputSinkContract.Windows]::ForegroundAfterSink = [IntPtr]99
for ($attempt = 0; $attempt -lt 5; $attempt++) { $null = Enter-SSEForegroundInputSink ([IntPtr]91) ([IntPtr]99) }
Check ([InputSinkContract.Windows]::SinkCalls -eq 3) 'Activation input was not bounded per job'
# Rueckgabe: nie an ein Fenster mit verweigerter Kopplung, sonst unveraendert.
Reset-Fixture
$lease = $script:SSE_FOREGROUND_LEASE
$null = $lease.unattachableForeground.Add([int64]99)
$lease.watch = [Diagnostics.Stopwatch]::StartNew(); $lease.previousForeground = [int64]99; $lease.targetPid = 51
$lease.lastOwnedInputTick = [uint64]100; [InputSinkContract.Windows]::Foreground = [IntPtr]91
Exit-SSEForegroundLease -Force -Reason 'emit'
Check ($script:restores -eq 0 -and $lease.restoreSkippedReason -ceq 'previous-window-refused-input-attachment' -and -not $lease.foregroundRestored) 'Foreground was handed back to a window that refuses input attachment'
Check ($null -eq $lease.watch -and [InputSinkContract.Windows]::Foreground -eq [IntPtr]91) 'Skipped restore did not finish the lease or moved the foreground'
Reset-Fixture
$lease.watch = [Diagnostics.Stopwatch]::StartNew(); $lease.previousForeground = [int64]88; $lease.targetPid = 51
$lease.lastOwnedInputTick = [uint64]100; [InputSinkContract.Windows]::Foreground = [IntPtr]91
Exit-SSEForegroundLease -Force -Reason 'emit'
Check ($script:restores -eq 1 -and $lease.foregroundRestored -and $null -eq $lease.restoreSkippedReason) 'An ordinary previous window was no longer restored'
# Vertragsfixtures laden den Waechter einzeln, auch im strikten Modus und ohne Lease.
Remove-Variable -Name SSE_FOREGROUND_LEASE -Scope Script
Set-StrictMode -Version Latest
[InputSinkContract.Windows]::Tick = 100
Check ((Test-SSELastInputUnchanged ([uint64]100)) -and -not (Test-SSELastInputUnchanged ([uint64]99))) 'The standalone input guard depends on lease state'
Remove-Item -LiteralPath function:Resolve-SSEOwnedInputTick
Check ((Test-SSELastInputUnchanged ([uint64]100)) -and -not (Test-SSELastInputUnchanged ([uint64]99))) 'The standalone input guard depends on the epoch resolver'
[Console]::Write('passed')
`;
const inputSinkBehavior = spawnSync("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand",
  Buffer.from(bootstrap, "utf16le").toString("base64")], {
  input: JSON.stringify({ program: inputSinkProgram }), encoding: "utf8", windowsHide: true, timeout: 60_000, maxBuffer: 1024 * 1024,
});
assert.equal(inputSinkBehavior.error, undefined, "PowerShell-Gegenproben der Eingabe-Aktivierung konnten nicht abgeschlossen werden.");
assert.equal(inputSinkBehavior.status, 0, inputSinkBehavior.stderr);
assert.equal(inputSinkBehavior.stdout.trim(), "passed");

process.stdout.write(
  "Foreground-Lease: sofortiger Physical-Cleanup, bounded polling, Cursor/Fokus-Restore und Input-Race vertraglich gebunden.\n",
);
const popupContract = spawnSync("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
  "-File", fileURLToPath(new URL("./menu-point-contract.ps1", import.meta.url))], {
  encoding: "utf8", windowsHide: true, timeout: 60_000, maxBuffer: 1024 * 1024,
});
assert.equal(popupContract.error, undefined, "Popup composition contract could not finish.");
assert.equal(popupContract.status, 0, popupContract.stderr || popupContract.stdout);
process.stdout.write(popupContract.stdout);
