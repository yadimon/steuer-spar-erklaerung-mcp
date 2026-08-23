# Schreibaktionen duerfen ausschliesslich an ein echtes Hauptfenster binden.
#
# Resolve-BoundWriteWindow filterte frueher nur nach Prozess und Breite >= 900.
# Der BelegManager ist 963 px breit und gehoert zum selben SSE-Prozess - er war
# damit ein gueltiger Kandidat fuer tracked_set_value, toggle und combo_select,
# obwohl jede Fehlermeldung dieser Funktion von 'Hauptfenster' spricht. Die
# gleichnamige, schmale Wiederherstellungsfrage darf umgekehrt trotz passendem
# Titel nie Ziel einer Schreibaktion werden.
$ErrorActionPreference = 'Stop'

$root = Split-Path $PSScriptRoot -Parent
$workerPath = Join-Path $root 'powershell\sse-worker.ps1'

$tokens = $null
$errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($workerPath, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw "Worker-Parserfehler: $($errors[0].Message)" }

foreach ($name in @('Get-SSEMainWindowCandidates', 'Resolve-BoundWriteWindow')) {
  $definition = @($ast.FindAll({
    param($node)
    $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name
  }, $true))
  if ($definition.Count -ne 1) { throw "Funktion $name ist nicht eindeutig vorhanden." }
  Invoke-Expression $definition[0].Extent.Text
}

$script:FensterStub = @()
function Get-Windows([string]$ProcName = 'SSE') { $script:FensterStub }
function Arg($a, [string]$name, $fallback = $null) {
  if ($a -and $a.PSObject.Properties[$name]) { return $a.$name }
  return $fallback
}
function Fail([string]$Message, [string]$Kind = 'error') { throw "FAIL[$Kind] $Message" }
function Test-CaseBinding($window, $path) { [pscustomobject]@{ ok = $false } }
function Get-Sha256($path) { $null }

function Assert-True([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw $Message }
}
function Fenster([string]$Title, [int]$Width, [int64]$Hwnd, [bool]$Minimiert = $false) {
  [pscustomobject]@{ hwnd = $Hwnd; pid = 4711; title = $Title; w = $Width; h = 600; minimiert = $Minimiert }
}

$hauptfenster = Fenster 'Gewinn/Umsatz-/Gewerbesteuer 2025: SteuerSparErklärung für das Steuerjahr 2025 [31.30] - cases:a.Gew2025' 1086 111
$belegManager = Fenster 'BelegManager' 963 222
$werteInfo = Fenster 'Werte-Info: Werte vergleichen - Was wäre wenn' 640 333
$startfrage = Fenster 'SteuerSparErklärung für das Steuerjahr 2025' 518 444
$startCenter = Fenster 'Steuerprogramm' 1000 555

# Hauptfenster und BelegManager gleichzeitig: es darf nur das Hauptfenster
# uebrig bleiben, nicht 'mehrere Instanzen' und schon gar nicht der Manager.
$script:FensterStub = @($hauptfenster, $belegManager, $werteInfo)
$gebunden = Resolve-BoundWriteWindow ([pscustomobject]@{})
Assert-True ([int64]$gebunden.window.hwnd -eq 111) "Schreibaktion band an hwnd $($gebunden.window.hwnd) statt an das Hauptfenster."

# Nur der BelegManager offen: keine Schreibaktion, kein stiller Ersatz.
$script:FensterStub = @($belegManager)
$fehler = $null
try { Resolve-BoundWriteWindow ([pscustomobject]@{}) } catch { $fehler = "$_" }
Assert-True ($fehler -like '*no-window*') "Ein alleinstehender BelegManager wurde als Schreibziel akzeptiert: $fehler"

# Auch ausdruecklich per hwnd darf der Manager nicht adressierbar sein.
$script:FensterStub = @($hauptfenster, $belegManager)
$fehler = $null
try { Resolve-BoundWriteWindow ([pscustomobject]@{ hwnd = 222 }) } catch { $fehler = "$_" }
Assert-True ($null -ne $fehler) 'Ein ausdrueckliches hwnd auf den BelegManager wurde nicht abgewiesen.'

# Die schmale Wiederherstellungsfrage traegt den Produktnamen, ist aber kein
# Hauptfenster und darf nie beschrieben werden.
$script:FensterStub = @($startfrage)
$fehler = $null
try { Resolve-BoundWriteWindow ([pscustomobject]@{}) } catch { $fehler = "$_" }
Assert-True ($fehler -like '*no-window*') "Die Startfrage wurde als Schreibziel akzeptiert: $fehler"

# Das breite Start-Hauptfenster vor dem geladenen Fall bleibt gueltig.
$script:FensterStub = @($startCenter)
$gebunden = Resolve-BoundWriteWindow ([pscustomobject]@{})
Assert-True ([int64]$gebunden.window.hwnd -eq 555) 'Das breite Start-Hauptfenster wurde faelschlich abgewiesen.'

# Ein minimiertes Fallfenster bleibt bindbar.
$script:FensterStub = @((Fenster 'Einkommensteuer 2025: SteuerSparErklärung für das Steuerjahr 2025' 160 666 $true))
$gebunden = Resolve-BoundWriteWindow ([pscustomobject]@{})
Assert-True ([int64]$gebunden.window.hwnd -eq 666) 'Ein minimiertes Hauptfenster wurde faelschlich abgewiesen.'

Write-Output 'Schreibfensterbindung: Hauptfenster ja, BelegManager/Werte-Info/Startfrage nein, minimiert und Start-Center ja.'
