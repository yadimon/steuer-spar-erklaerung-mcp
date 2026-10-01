# Der Weg zur Werte-Info entscheidet ueber den einzigen erlaubten Schreibweg
# fuer Steuerfelder. Er scheiterte schon zweimal an derselben PowerShell-Falle:
# einmal, weil ein einzelner Treffer als Objekt statt als Liste zurueckkam, und
# einmal, weil ein fuehrendes Komma die Liste zusammen mit dem @() der Aufrufer
# ein zweites Mal verpackte - dann meldete `.Count` auch ohne offenes Fenster
# eine Eins, und das vermeintliche Fenster war ein leeres Array mit hwnd 0.
# Beide Faelle sind hier festgenagelt.
$ErrorActionPreference = 'Stop'

$root = Split-Path $PSScriptRoot -Parent
$workerPath = Join-Path $root 'powershell\sse-worker.ps1'

$tokens = $null
$errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($workerPath, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw "Worker-Parserfehler: $($errors[0].Message)" }

$definition = @($ast.FindAll({
  param($node)
  $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Get-SSEValueInfoWindows'
}, $true))
if ($definition.Count -ne 1) { throw 'Get-SSEValueInfoWindows ist nicht eindeutig vorhanden.' }
Invoke-Expression $definition[0].Extent.Text

$script:WERTE_INFO_TITEL = 'Werte-Info: Werte vergleichen - Was wäre wenn'
$script:FensterStub = @()
function Get-Windows([string]$ProcName = 'SSE') { $script:FensterStub }

function Assert-True([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw $Message }
}
function Fenster([int]$Pid_, [string]$Title, [int64]$Hwnd) {
  [pscustomobject]@{ hwnd = $Hwnd; pid = $Pid_; title = $Title; w = 640; h = 480 }
}

# Kein Fenster: die Aufrufer duerfen keine Eins sehen.
$script:FensterStub = @(Fenster 42 'Einkommensteuer 2025: irgendein Hauptfenster' 111)
$leer = @(Get-SSEValueInfoWindows 42)
Assert-True ($leer.Count -eq 0) "Ohne Werte-Info muss die Liste leer sein, war $($leer.Count)."

# Genau ein Fenster: ein echtes Fensterobjekt, kein verschachteltes Array.
$script:FensterStub = @(
  (Fenster 42 'Einkommensteuer 2025: irgendein Hauptfenster' 111),
  (Fenster 42 $script:WERTE_INFO_TITEL 222)
)
$eins = @(Get-SSEValueInfoWindows 42)
Assert-True ($eins.Count -eq 1) "Genau ein Treffer erwartet, waren $($eins.Count)."
Assert-True (-not ($eins[0] -is [System.Array])) 'Der Treffer darf kein verschachteltes Array sein.'
Assert-True ([int64]$eins[0].hwnd -eq 222) "hwnd muss 222 sein, war $([int64]$eins[0].hwnd)."

# Fremder Prozess zaehlt nicht mit.
$fremd = @(Get-SSEValueInfoWindows 43)
Assert-True ($fremd.Count -eq 0) 'Ein Fenster fremder PID darf nicht als Werte-Info gelten.'

# Zwei gleiche Fenster bleiben mehrdeutig und werden nicht stillschweigend eines.
$script:FensterStub = @(
  (Fenster 42 $script:WERTE_INFO_TITEL 222),
  (Fenster 42 $script:WERTE_INFO_TITEL 333)
)
$zwei = @(Get-SSEValueInfoWindows 42)
Assert-True ($zwei.Count -eq 2) "Zwei Treffer erwartet, waren $($zwei.Count)."

Write-Output 'Werte-Info-Fenstersuche: leer, eindeutig, fremde PID und mehrdeutig geprueft.'

# Exercise the real open/readiness/close helpers against an adapter whose
# window appears immediately but whose content can arrive in stages.
foreach ($name in @('Open-SSEValueInfoWindow','Open-TrackedResultWindow','Read-TrackedResultWindowComplete','Close-TrackedResultWindow')) {
  $definitions = @($ast.FindAll({
    param($node)
    $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $name
  }, $true))
  Assert-True ($definitions.Count -eq 1) "Missing helper $name."
  Invoke-Expression $definitions[0].Extent.Text
}
Add-Type -AssemblyName UIAutomationClient
Add-Type -TypeDefinition @'
using System;
public static class SW {
  public static bool Open;
  public static bool CloseSucceeds;
  public static int CloseCalls;
  public static bool IsWindow(IntPtr hwnd) { return Open; }
  public static IntPtr SendMessageTimeout(IntPtr hwnd, uint message, IntPtr wParam,
    IntPtr lParam, uint flags, uint timeout, ref IntPtr result) {
    CloseCalls++;
    if (CloseSucceeds) Open = false;
    return new IntPtr(1);
  }
}
'@
function Walk-Tree { [pscustomobject]@{ nodes=@([pscustomobject]@{ type='Button'; aid='hoverBtnMehrDetails'; rid='button' }) } }
function Get-LiveElement { $null }
function Click-VerifiedPoint {
  $script:FensterStub = @((Fenster 42 'Main' 111), (Fenster 42 $script:WERTE_INFO_TITEL 222))
}
$script:Sleeps = New-Object Collections.ArrayList
function Start-Sleep([int]$Milliseconds) { $null = $script:Sleeps.Add($Milliseconds) }
$script:FensterStub = @(Fenster 42 'Main' 111)
$regular = Open-SSEValueInfoWindow ([IntPtr]111) 42
Assert-True ($regular.ok -and $regular.opened) 'Regular value-info open failed.'
Assert-True ($script:Sleeps.Contains(900)) 'Regular content-readiness delay changed.'

$script:Sleeps.Clear()
$script:FensterStub = @(Fenster 42 'Main' 111)
$tracking = Open-TrackedResultWindow ([IntPtr]111)
Assert-True ($tracking.ok -and $tracking.opened) 'Tracked value-info open failed.'
Assert-True (-not $script:Sleeps.Contains(900)) 'Tracked open waits before its mandatory complete readback.'

$script:Reads = New-Object Collections.Queue
function Read-TrackedResultWindow { $script:Reads.Dequeue() }
$script:Reads.Enqueue([pscustomobject]@{ ok=$false; rows=@() })
$script:Reads.Enqueue([pscustomobject]@{ ok=$false; rows=@('partial') })
$script:Reads.Enqueue([pscustomobject]@{ ok=$true; rows=@('complete') })
$complete = Read-TrackedResultWindowComplete $tracking.window
Assert-True ($complete.ok -and $complete.rows[0] -ceq 'complete') 'Partial result content was accepted.'
Assert-True ($script:Reads.Count -eq 0) 'Readiness did not re-read incomplete content.'
$script:Reads.Enqueue([pscustomobject]@{ ok=$false; rows=@('partial') })
$incomplete = Read-TrackedResultWindowComplete $tracking.window 0
Assert-True (-not $incomplete.ok) 'Incomplete content became successful at the deadline.'

[SW]::Open = $true; [SW]::CloseSucceeds = $true; [SW]::CloseCalls = 0
$script:Sleeps.Clear()
Assert-True (Close-TrackedResultWindow $tracking) 'Immediately closed tracked window remained open.'
Assert-True ([SW]::CloseCalls -eq 1 -and $script:Sleeps.Count -eq 0) 'Verified immediate close still slept or repeated the close mutation.'
[SW]::Open = $true; [SW]::CloseCalls = 0
$borrowed = [pscustomobject]@{ ok=$true; opened=$false; window=$tracking.window }
Assert-True (Close-TrackedResultWindow $borrowed) 'Borrowed window cleanup failed.'
Assert-True ([SW]::Open -and [SW]::CloseCalls -eq 0) 'Cleanup closed a window it did not open.'
[SW]::CloseSucceeds = $false
Assert-True (-not (Close-TrackedResultWindow $tracking)) 'Unclosed tracked window was reported as closed.'
Assert-True ([SW]::CloseCalls -eq 1) 'Close mutation was repeated while waiting for window disappearance.'

Write-Output 'Tracked results: deferred complete readback, partial/deadline rejection and owned close readiness passed.'

# An omitted optional filter must compare every result row. Exercise the
# actual transaction's argument conversion as well as the real comparator:
# PowerShell can otherwise turn a missing argument into one empty label.
. (Join-Path $root 'powershell/table-values.ps1')
foreach ($name in @('Arg', 'Compare-TrackedResultRows')) {
  $definitions = @($ast.FindAll({
    param($node)
    $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $name
  }, $true))
  Assert-True ($definitions.Count -eq 1) "Missing helper $name."
  Invoke-Expression $definitions[0].Extent.Text
}
$labelAssignments = @($ast.FindAll({
  param($node)
  $node -is [Management.Automation.Language.AssignmentStatementAst] -and
    $node.Left.Extent.Text -ceq '$labels' -and $node.Right.Extent.Text.Contains("'resultLabels'")
}, $true))
Assert-True ($labelAssignments.Count -eq 1) 'Tracked result-label conversion is not unique.'
$resultBefore = [pscustomobject]@{ rows=@(
  [pscustomobject]@{ name='Refund'; aktuell='1.000,50' },
  [pscustomobject]@{ name='Tax'; aktuell='2.000,00' },
  [pscustomobject]@{ name='Unchanged'; aktuell='100,00' }
) }
$resultAfter = [pscustomobject]@{ rows=@(
  [pscustomobject]@{ name='Refund'; aktuell='1.500,75' },
  [pscustomobject]@{ name='Tax'; aktuell='1.500,00' },
  [pscustomobject]@{ name='Unchanged'; aktuell='100.00' }
) }
foreach ($a in @([pscustomobject]@{}, [pscustomobject]@{ resultLabels=$null }, [pscustomobject]@{ resultLabels=@() })) {
  Invoke-Expression $labelAssignments[0].Extent.Text
  Assert-True ($labels.Count -eq 0) 'Absent resultLabels became a nonempty filter.'
  $diff = @(Compare-TrackedResultRows $resultBefore $resultAfter $labels)
  Assert-True ($diff.Count -eq 2) 'Unfiltered result comparison lost changed currency rows.'
  Assert-True ($diff[0].name -ceq 'Refund' -and $diff[0].vorher -ceq '1.000,50' -and $diff[0].nachher -ceq '1.500,75') 'Result diff lost its actual before/after values.'
}
$a = [pscustomobject]@{ resultLabels=@('Tax') }
Invoke-Expression $labelAssignments[0].Extent.Text
$filtered = @(Compare-TrackedResultRows $resultBefore $resultAfter $labels)
Assert-True ($filtered.Count -eq 1 -and $filtered[0].name -ceq 'Tax') 'Explicit resultLabels did not restrict the comparison.'
$a = [pscustomobject]@{ resultLabels=@('Unchanged') }
Invoke-Expression $labelAssignments[0].Extent.Text
Assert-True (@(Compare-TrackedResultRows $resultBefore $resultAfter $labels).Count -eq 0) 'Equivalent result formatting produced a false change.'
Write-Output 'Tracked result diffs: absent/null/empty filters, changed currency rows and explicit filtering passed.'

# A requested row may only appear after a calculation. An unmatched filter
# therefore cannot be rejected against the baseline before the write.
$newAfter = [pscustomobject]@{ rows=@([pscustomobject]@{ name='New tax'; aktuell='250,00' }) }
$newDiff = @(Compare-TrackedResultRows ([pscustomobject]@{ rows=@() }) $newAfter @('New tax'))
Assert-True ($newDiff.Count -eq 1 -and $null -eq $newDiff[0].vorher -and $newDiff[0].nachher -ceq '250,00') 'A requested newly calculated row was lost.'
Assert-True (@(Compare-TrackedResultRows $resultBefore $resultAfter @('Absent row')).Count -eq 0) 'An unmatched filter must not invent changed rows.'
$labelGuards = @($ast.FindAll({
  param($node)
  $node -is [Management.Automation.Language.IfStatementAst] -and
    $node.Extent.Text.Contains('$labels | Where-Object { [string]::IsNullOrWhiteSpace($_) }')
}, $true))
Assert-True ($labelGuards.Count -eq 1) 'Blank result-label guard is not unique.'
function Fail([string]$Message, [string]$Kind) { throw "$Kind`: $Message" }
foreach ($blank in @('', ' ', "`t`n")) {
  $a = [pscustomobject]@{ resultLabels=@($blank) }
  Invoke-Expression $labelAssignments[0].Extent.Text
  $rejected = $false
  try { Invoke-Expression $labelGuards[0].Extent.Text }
  catch { $rejected = $_.Exception.Message -like 'bad-args:*' }
  Assert-True $rejected 'The worker accepted a blank result label.'
}
$a = [pscustomobject]@{ resultLabels=@('New tax') }
Invoke-Expression $labelAssignments[0].Extent.Text
Invoke-Expression $labelGuards[0].Extent.Text

# Use the real parser: a whole-row prefix passes structural completeness.
# The transaction must still wait for consecutive identical content snapshots.
. (Join-Path $root 'powershell/structure-binding.ps1')
foreach ($name in @('Convert-SSEComparableNumber', 'Get-SSETextSha256', 'Read-ResultDetailsFromTree', 'Read-TrackedResultWindow')) {
  $definitions = @($ast.FindAll({
    param($node)
    $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $name
  }, $true))
  Assert-True ($definitions.Count -eq 1) "Missing helper $name."
  Invoke-Expression $definitions[0].Extent.Text
}
function Result-Tree([int]$RowCount, [string]$Tax = '2.000,00') {
  $nodes = New-Object Collections.ArrayList
  $null = $nodes.Add([pscustomobject]@{ i=0; p=-1; aid='obj_Wertetabelle'; type='Table' })
  foreach ($label in @('Name', 'Aktuell', 'Festgehalten', 'Differenz')) {
    $index = $nodes.Count
    $null = $nodes.Add([pscustomobject]@{ i=$index; p=0; type='Header'; name=$label; x=($index-1)*100; y=0; w=100; h=20 })
  }
  $rows = @(@('Refund', '1.000,50', '1.000,50', '0,00'), @('Tax', $Tax, $Tax, '0,00'))
  for ($row = 0; $row -lt $RowCount; $row++) {
    for ($column = 0; $column -lt 4; $column++) {
      $null = $nodes.Add([pscustomobject]@{ i=$nodes.Count; p=0; type='DataItem'; name=$rows[$row][$column]; x=$column*100; y=($row+1)*20; w=100; h=20 })
    }
  }
  [pscustomobject]@{ nodes=@($nodes); stats=[pscustomobject]@{ truncated=$false; cyc=$false } }
}
$prefix = Result-Tree 1
$full = Result-Tree 2
$changed = Result-Tree 2 '2.100,00'
$parsedPrefix = Read-ResultDetailsFromTree $prefix
Assert-True ($parsedPrefix.vollstaendig -and $parsedPrefix.anzahl -eq 1) 'The regression fixture must be a structurally complete prefix.'
$beforeAssignments = @($ast.FindAll({
  param($node)
  $node -is [Management.Automation.Language.AssignmentStatementAst] -and
    $node.Left.Extent.Text -ceq '$resultBefore' -and $node.Right.Extent.Text.Contains('Read-TrackedResultWindowComplete')
}, $true))
Assert-True ($beforeAssignments.Count -eq 1) 'Transaction baseline readback is not unique.'
$script:Trees = New-Object Collections.Queue
function Walk-Tree { $script:Trees.Dequeue() }
[SW]::Open = $true
$tracking.opened = $true
foreach ($tree in @($prefix, $full, $full)) { $script:Trees.Enqueue($tree) }
Invoke-Expression $beforeAssignments[0].Extent.Text
Assert-True ($resultBefore.ok -and $resultBefore.rows.Count -eq 2 -and $script:Trees.Count -eq 0) 'The transaction accepted a growing whole-row prefix as its baseline.'
foreach ($tree in @($full, $changed, $changed)) { $script:Trees.Enqueue($tree) }
Invoke-Expression $beforeAssignments[0].Extent.Text
Assert-True ($resultBefore.ok -and $resultBefore.rows[1].aktuell -ceq '2.100,00' -and $script:Trees.Count -eq 0) 'Readiness checked row count without checking content stability.'
$script:Trees.Enqueue($prefix)
$unstable = Read-TrackedResultWindowComplete $tracking.window 0 -RequireStable
Assert-True (-not $unstable.ok -and -not $unstable.complete -and $unstable.error) 'An unproven baseline became successful at the deadline.'
$tracking.opened = $false
$script:Trees.Enqueue($full)
Invoke-Expression $beforeAssignments[0].Extent.Text
Assert-True ($resultBefore.ok -and $script:Trees.Count -eq 0) 'An already open complete result window unnecessarily required fresh-open stability.'
Write-Output 'Tracked baseline: real-parser prefixes, same-size content changes, deadline and borrowed-window readiness passed.'
