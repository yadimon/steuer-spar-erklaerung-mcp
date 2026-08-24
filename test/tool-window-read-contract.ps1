# Ein Werkzeugfenster wird an seinem eigenen Fenster gelesen - und nur dieses.
#
# Vom Hauptfenster aus bricht der Baumlauf tief im BelegManager ab: Er lieferte
# dort nur seinen in zwei Textknoten zerlegten Titel statt seiner Schalter.
# sse_snapshot kann das Fenster deshalb ueber toolWindow direkt lesen. Die
# Aufloesung muss eng bleiben: nur katalogisierte Werkzeugfenster, nur im
# gebundenen Prozess, nur bei exaktem Titel. Gelesen wird, nicht bedient.
$ErrorActionPreference = 'Stop'

$root = Split-Path $PSScriptRoot -Parent
$workerPath = Join-Path $root 'powershell\sse-worker.ps1'
$catalogPath = Join-Path $root 'profiles\2025\page-objects.json'

$tokens = $null
$errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($workerPath, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw "Worker-Parserfehler: $($errors[0].Message)" }
$definition = @($ast.FindAll({
  param($node)
  $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Resolve-SSEToolWindowHandle'
}, $true))
if ($definition.Count -ne 1) { throw 'Resolve-SSEToolWindowHandle ist nicht eindeutig vorhanden.' }
Invoke-Expression $definition[0].Extent.Text

$script:Katalog = Get-Content -LiteralPath $catalogPath -Raw -Encoding UTF8 | ConvertFrom-Json
function Get-SSEPageObjects { $script:Katalog }
$script:Fenster = @()
function Get-Windows([string]$ProcName = 'SSE') { $script:Fenster }
function Fail([string]$Message, [string]$Kind = 'error') { throw "FAIL[$Kind] $Message" }
function Arg($a, [string]$name, $fallback = $null) {
  if ($a -and $a.PSObject.Properties[$name]) { return $a.$name }
  return $fallback
}
function Assert-True([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw $Message }
}
function Fenster([string]$Title, [int]$ProcessId, [int64]$Hwnd) {
  [pscustomobject]@{ title = $Title; pid = $ProcessId; hwnd = $Hwnd; cls = 'Qt692QWindow'; w = 2304; h = 1359 }
}
function Fehler([scriptblock]$Block) {
  try { & $Block; return '' } catch { return "$_" }
}

$haupt = Fenster 'Einkommensteuer 2025: Hauptfenster' 4711 111
$manager = Fenster 'BelegManager' 4711 222

# Offen im gebundenen Prozess: genau dieses Fenster wird geliefert.
$script:Fenster = @($haupt, $manager)
$treffer = Resolve-SSEToolWindowHandle 'receiptManager' 4711
Assert-True ([int64]$treffer -eq 222) "Aufgeloest wurde hwnd $treffer statt 222."

# Ein gleichnamiges Fenster eines fremden Prozesses zaehlt nicht.
$script:Fenster = @($haupt, (Fenster 'BelegManager' 9999 333))
Assert-True ((Fehler { Resolve-SSEToolWindowHandle 'receiptManager' 4711 }) -like '*not-found*') 'Ein BelegManager aus einem fremden Prozess wurde akzeptiert.'

# Gar nicht offen.
$script:Fenster = @($haupt)
Assert-True ((Fehler { Resolve-SSEToolWindowHandle 'receiptManager' 4711 }) -like '*not-found*') 'Ein geschlossenes Werkzeugfenster wurde aufgeloest.'

# Mehrfach offen ist unerwartet und darf nicht geraten werden.
$script:Fenster = @($haupt, $manager, (Fenster 'BelegManager' 4711 444))
Assert-True ((Fehler { Resolve-SSEToolWindowHandle 'receiptManager' 4711 }) -like '*ambiguous*') 'Zwei gleichnamige Werkzeugfenster wurden stillschweigend auf eines reduziert.'

# Der Titel bindet exakt und mit Gross-/Kleinschreibung.
foreach ($fremd in @('belegmanager', 'BelegManager ', 'Beleg-Manager')) {
  $script:Fenster = @($haupt, (Fenster $fremd 4711 555))
  Assert-True ((Fehler { Resolve-SSEToolWindowHandle 'receiptManager' 4711 }) -like '*not-found*') "Der Titel '$fremd' wurde als BelegManager akzeptiert."
}

# Andere Katalogrollen sind keine Werkzeugfenster.
$script:Fenster = @($haupt, (Fenster 'Steuer-Spar-Tipps' 4711 666))
Assert-True ((Fehler { Resolve-SSEToolWindowHandle 'taxTips' 4711 }) -like '*blocked*') 'Ein Hilfefenster wurde als Werkzeugfenster gelesen.'
Assert-True ((Fehler { Resolve-SSEToolWindowHandle 'main' 4711 }) -like '*blocked*') 'Das Hauptfenster wurde als Werkzeugfenster gelesen.'
Assert-True ((Fehler { Resolve-SSEToolWindowHandle 'vastAssignment' 4711 }) -like '*blocked*') 'Der modale VaSt-Dialog wurde als Werkzeugfenster gelesen.'

# Eine unbekannte Kennung nennt die katalogisierten Alternativen.
$unbekannt = Fehler { Resolve-SSEToolWindowHandle 'gibtsNicht' 4711 }
Assert-True ($unbekannt -like '*bad-args*') 'Eine unbekannte Kennung ergab keinen Argumentfehler.'
Assert-True ($unbekannt -like '*receiptManager*') 'Der Argumentfehler nennt die katalogisierten Werkzeugfenster nicht.'

Write-Output 'Werkzeugfenster lesen: nur katalogisierte Rollen, nur im gebundenen Prozess, Titel exakt, Mehrdeutigkeit abgewiesen.'
