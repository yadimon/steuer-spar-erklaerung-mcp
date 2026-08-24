# Der Inhaltsbereich muss sagen, ob seine linke Grenze gemessen oder geraten ist.
#
# Get-ContentBounds ueberspringt links die Navigationsspalte. Findet es keinen
# Baum, faellt es auf 28 % der Fensterbreite zurueck - eine Schaetzung, die
# genau dann greift, wenn es gar nichts zu ueberspringen gibt. Eine
# eingeklappte Navigationsspalte liefert einen Tree der Breite 0; die
# Beschriftungsspalte liegt dann links der geratenen Grenze und fiel aus der
# Seitenlesung heraus. Ergebnis war eine Seite mit lauter unbeschrifteten
# Feldern und danach 'bad-target' bei jedem Zugriff ueber die Beschriftung.
# navErkannt macht diesen Unterschied sichtbar.
$ErrorActionPreference = 'Stop'

$root = Split-Path $PSScriptRoot -Parent
$workerPath = Join-Path $root 'powershell\sse-worker.ps1'

$tokens = $null
$errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($workerPath, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw "Worker-Parserfehler: $($errors[0].Message)" }

foreach ($name in @('Get-ContentBounds', 'Get-CaptionMinX')) {
  $definition = @($ast.FindAll({
    param($node)
    $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name
  }, $true))
  if ($definition.Count -ne 1) { throw "Funktion $name ist nicht eindeutig vorhanden." }
  Invoke-Expression $definition[0].Extent.Text
}

# Festes Fenster von 1086 Pixeln Breite ab x = -8, wie in der Testmaschine
# gemessen. Daraus folgt der Rueckfall minX = 296 und maxX = 850.
Add-Type @'
public class SW {
  public struct RC { public int L; public int T; public int R; public int B; }
  public static bool GetWindowRect(System.IntPtr h, ref RC r) {
    r.L = -8; r.T = 36; r.R = 1078; r.B = 721; return true;
  }
}
'@

function Assert-True([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw $Message }
}
function Baum([int]$X, [int]$W) { [pscustomobject]@{ type = 'Tree'; name = ''; x = $X; w = $W; h = 400 } }
function Marke([string]$Name, [int]$X) { [pscustomobject]@{ type = 'Text'; name = $Name; x = $X; w = 120; h = 20 } }
function Baumlos($nodes) { [pscustomobject]@{ nodes = @($nodes) } }

$null_ = [IntPtr]::Zero

# Ohne Navigationsbaum ist die Grenze geraten.
$ohne = Get-ContentBounds (Baumlos @()) $null_
Assert-True (-not $ohne.navErkannt) 'Ohne Navigationsbaum wurde die geratene Grenze als gemessen ausgegeben.'
Assert-True ($ohne.minX -eq 296) "Der Anteilsrueckfall ergab minX = $($ohne.minX) statt 296."
Assert-True ($ohne.winX -eq -8) "winX war $($ohne.winX) statt -8."

# Eine eingeklappte Navigationsspalte ist kein erkannter Baum.
$eingeklappt = Get-ContentBounds (Baumlos @((Baum -1 0))) $null_
Assert-True (-not $eingeklappt.navErkannt) 'Ein Tree der Breite 0 wurde als erkannte Navigationsspalte gewertet.'
Assert-True ($eingeklappt.minX -eq 296) 'Ein Tree der Breite 0 verschob die linke Grenze.'

# Eine ausgeklappte Navigationsspalte misst die Grenze.
$aufgeklappt = Get-ContentBounds (Baumlos @((Baum 0 250))) $null_
Assert-True ([bool]$aufgeklappt.navErkannt) 'Eine ausgeklappte Navigationsspalte wurde nicht erkannt.'
Assert-True ($aufgeklappt.minX -eq 255) "Die gemessene Grenze war $($aufgeklappt.minX) statt 255."

# Die Hilfespalte begrenzt weiterhin nach rechts, unabhaengig vom Baum.
$mitHilfe = Get-ContentBounds (Baumlos @((Marke 'Steuertipps' 800))) $null_
Assert-True ($mitHilfe.maxX -eq 790) "Die Hilfespalte begrenzte auf $($mitHilfe.maxX) statt 790."
Assert-True (-not $mitHilfe.navErkannt) 'Eine Hilfespalte darf die linke Grenze nicht als gemessen ausweisen.'

# Die Beschriftungssuche folgt der gemessenen Grenze und weicht der geratenen
# nach links aus - sonst faellt die Beschriftungsspalte heraus.
Assert-True ((Get-CaptionMinX $aufgeklappt) -eq 255) 'Bei gemessener Grenze suchte die Beschriftung nicht ab der Navigationskante.'
Assert-True ((Get-CaptionMinX $eingeklappt) -eq -8) 'Bei eingeklappter Navigation suchte die Beschriftung erst ab der geratenen Grenze.'
Assert-True ((Get-CaptionMinX $ohne) -eq -8) 'Ohne Navigationsbaum suchte die Beschriftung erst ab der geratenen Grenze.'
# Die gemessene Grenze bleibt bindend: Navigationseintraege sind keine
# Beschriftungen und duerfen nie in die Suche geraten.
Assert-True ((Get-CaptionMinX $aufgeklappt) -gt $aufgeklappt.winX) 'Eine erkannte Navigationsspalte wurde in die Beschriftungssuche einbezogen.'

Write-Output 'Inhaltsbereich: geratene und gemessene linke Grenze unterscheidbar, eingeklappte Navigation zaehlt nicht als Baum, Beschriftungssuche weicht nur der geratenen Grenze aus.'
