# Ein Hilfsfenster, das das Zielfeld verdeckt, muss ausweichen koennen.
#
# Die Werte-Info schwebt ueber dem Hauptfenster. Deckt sie das Zielfeld ab,
# bricht die Schreibtransaktion mit 'epoch-obstructed' ab, denn geklickt wird
# nur auf verifizierte Punkte. Die Ausweichecken waren am Hauptfenster
# ausgerichtet - und weil dieses auf kleinen Bildschirmen breiter ist als der
# Schirm, deckten alle vier dasselbe Feld weiterhin ab. Der erlaubte Schreibweg
# war damit unerreichbar, obwohl der Arbeitsbereich eine freie Ecke hergab.
$ErrorActionPreference = 'Stop'

$root = Split-Path $PSScriptRoot -Parent
$workerPath = Join-Path $root 'powershell\sse-worker.ps1'

$tokens = $null
$errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($workerPath, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw "Worker-Parserfehler: $($errors[0].Message)" }

foreach ($name in @('Test-SSEPointInRect', 'Get-SSEAsideCorners')) {
  $definition = @($ast.FindAll({
    param($node)
    $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name
  }, $true))
  if ($definition.Count -ne 1) { throw "Funktion $name ist nicht eindeutig vorhanden." }
  Invoke-Expression $definition[0].Extent.Text
}

function Assert-True([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw $Message }
}
function FreieEcken($Ecken, [int]$X, [int]$Y, [int]$Breite, [int]$Hoehe) {
  @($Ecken | Where-Object { -not (Test-SSEPointInRect $X $Y ([int]$_[0]) ([int]$_[1]) $Breite $Hoehe) })
}

# Gemessene Lage: Bildschirm 1020 x 765 mit Taskleiste, Werte-Info 640 x 480,
# Zielfeld bei (621, 496), Hauptfenster 1086 x 685 ab (-8, 36).
$breite = 640
$hoehe = 480
$zielX = 621
$zielY = 496

$ecken = Get-SSEAsideCorners 0 0 1020 725 $breite $hoehe
Assert-True ($ecken.Count -eq 4) "Es wurden $($ecken.Count) Ecken statt vier geliefert."
$frei = FreieEcken $ecken $zielX $zielY $breite $hoehe
Assert-True ($frei.Count -ge 1) 'Im Arbeitsbereich blieb keine Ecke frei, obwohl oben links Platz ist.'

# Zum Vergleich die alte, am Hauptfenster ausgerichtete Rechnung: Sie deckte das
# Zielfeld in jeder Ecke weiter ab. Das ist der Regressionsfall.
$amFenster = Get-SSEAsideCorners -8 36 1078 721 $breite $hoehe
Assert-True ((FreieEcken $amFenster $zielX $zielY $breite $hoehe).Count -eq 0) 'Die Annahme des Regressionsfalls stimmt nicht mehr; der Test prueft nichts.'

# Ein Hilfsfenster, das nicht in den Arbeitsbereich passt, rutscht nicht aus dem
# Bild, sondern bleibt an dessen Anfang stehen.
$zuGross = Get-SSEAsideCorners 0 0 500 400 $breite $hoehe
foreach ($ecke in $zuGross) {
  Assert-True ([int]$ecke[0] -ge 0 -and [int]$ecke[1] -ge 0) "Eine Ecke lag mit ($($ecke[0]), $($ecke[1])) ausserhalb des Arbeitsbereichs."
}

# Ein zweiter Bildschirm links des ersten hat negative Koordinaten; der Rand
# gehoert dann trotzdem nach innen.
$linksDaneben = Get-SSEAsideCorners -1920 0 -900 1080 $breite $hoehe
Assert-True ([int]$linksDaneben[0][0] -eq -1912) "Der linke Rand wurde auf $($linksDaneben[0][0]) statt -1912 gelegt."

Write-Output 'Ausweichecken: am Arbeitsbereich ausgerichtet, Regressionsfall belegt, kein Rutschen aus dem Bild.'
