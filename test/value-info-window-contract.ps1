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
