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
