$ErrorActionPreference = 'Stop'

$root = Split-Path $PSScriptRoot -Parent
$workerPath = Join-Path $root 'powershell\sse-worker.ps1'
$structureBindingPath = Join-Path $root 'powershell\structure-binding.ps1'

. $structureBindingPath

$tokens = $null
$errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($workerPath, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw "Worker-Parserfehler: $($errors[0].Message)" }

# Echte Worker-Implementierungen laden, damit der Test nicht nur Textmarker,
# sondern das Verhalten der produktiven Auswertung prueft.
foreach ($functionName in @('Get-SSECheckerTreeItems', 'Get-CheckerResults', 'Test-CheckerResultComplete')) {
  $definition = @($ast.FindAll({
    param($node)
    $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $functionName
  }, $true))
  if ($definition.Count -ne 1) { throw "Funktion $functionName ist nicht eindeutig vorhanden." }
  Invoke-Expression $definition[0].Extent.Text
}
$script:SSE_CHECKER_TREE_SUFFIX = 'PrueferWidgetSSE.SteuerPruefer'

function Assert-True([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw $Message }
}

function Node(
  [int]$I,
  [int]$P,
  [int]$D,
  [string]$Type,
  [string]$Name,
  [string]$Aid = '',
  [int]$X = 30,
  [int]$Y = 200
) {
  [pscustomobject]@{
    i = $I; p = $P; d = $D; type = $Type; name = $Name; aid = $Aid
    x = $X; y = $Y; w = 300; h = 20; on = $true; rid = "42.$I"
  }
}

function Tree([AllowEmptyCollection()][object[]]$Nodes) {
  [pscustomobject]@{ nodes = @($Nodes) }
}

$geschlossen = Get-CheckerResults (Tree @(
  (Node 0 -1 0 'Tree' '' 'NavFrameSSE.QWidget.NavWidgetSSE')
  (Node 1  0 1 'TreeItem' 'Steuererklaerung' '')
))
Assert-True (-not $geschlossen.aktiv) 'Ohne exakt gebundenen Pruefer-Tree wurde aktiv=true gemeldet.'
Assert-True ($geschlossen.gesamt -eq 0) 'Geschlossener Pruefer muss gesamt=0 liefern.'
Assert-True (-not (Test-CheckerResultComplete $geschlossen)) 'Geschlossener Pruefer darf nicht als konsistent gelten.'

$leer = Get-CheckerResults (Tree @(
  (Node 0 -1 0 'Tree' '' 'NavFrameSSE.PrueferWidgetSSE.SteuerPruefer')
))
Assert-True ($leer.aktiv) `
  'Ein eindeutig gebundener, leerer Pruefer-Tree wurde als geschlossen gemeldet; checker_run wuerde timeouten.'
Assert-True ($leer.leer) 'Der echte Null-Ergebniszustand wurde nicht als leer erkannt.'
Assert-True ($leer.gesamt -eq 0) 'Leerer Pruefer muss gesamt=0 liefern.'
Assert-True (@($leer.fragenWarnungen).Count -eq 0 -and @($leer.tippsZusatzinfos).Count -eq 0) `
  'Leerer Pruefer lieferte erfundene Findings.'
Assert-True (Test-CheckerResultComplete $leer) `
  'Ein eindeutig leerer Ergebnisbaum muss als konsistentes Null-Ergebnis gelten.'

# Ein vorhandenes, aber namenloses TreeItem kann eine noch nicht materialisierte
# Qt-Zeile sein. Der Pruefer ist offen, das Ergebnis bleibt jedoch fail-closed.
$namenlos = Get-CheckerResults (Tree @(
  (Node 0 -1 0 'Tree'     '' 'NavFrameSSE.PrueferWidgetSSE.SteuerPruefer')
  (Node 1  0 1 'TreeItem' '' '')
))
Assert-True ($namenlos.aktiv) 'Vorhandener Pruefer-Tree mit namenlosem Eintrag wurde als geschlossen gemeldet.'
Assert-True (-not $namenlos.leer) 'Namenloser TreeItem wurde faelschlich als echtes Null-Ergebnis gewertet.'
Assert-True (-not (Test-CheckerResultComplete $namenlos)) `
  'Teilweise materialisierter Prueferbaum darf nicht als konsistent gelten.'

$vollstaendig = Get-CheckerResults (Tree @(
  (Node 0 -1 0 'Tree'     '' 'NavFrameSSE.PrueferWidgetSSE.SteuerPruefer' 30 180)
  (Node 1  0 1 'TreeItem' '1 Fragen oder Warnungen' '' 30 200)
  (Node 2  0 1 'TreeItem' 'Synthetische Warnung'     '' 30 240)
  (Node 3  0 1 'TreeItem' '0 Tipps oder Zusatzinformationen' '' 30 280)
))
Assert-True ($vollstaendig.aktiv -and -not $vollstaendig.leer) 'Nichtleerer Pruefer wurde falsch klassifiziert.'
Assert-True ($vollstaendig.gesamt -eq 1) 'Nichtleerer Pruefer zaehlt Findings falsch.'
Assert-True (Test-CheckerResultComplete $vollstaendig) 'Vollstaendiger normaler Pruefer gilt nicht mehr als konsistent.'

# SSE verwendet bei genau einem Eintrag grammatisch eigene Gruppenkoepfe.
$singular = Get-CheckerResults (Tree @(
  (Node 0 -1 0 'Tree' '' 'NavFrameSSE.PrueferWidgetSSE.SteuerPruefer' 30 180)
  (Node 1 0 1 'TreeItem' '1 Frage oder Warnung' '' 30 200)
  (Node 2 0 1 'TreeItem' 'Synthetische Warnung' '' 30 240)
  (Node 3 0 1 'TreeItem' '1 Tipp oder Zusatzinformation' '' 30 280)
  (Node 4 0 1 'TreeItem' 'Synthetischer Tipp' '' 30 320)
))
Assert-True (Test-CheckerResultComplete $singular) 'Singular-Gruppen wurden nicht vollstaendig erkannt.'
Assert-True ($singular.fragenWarnungenAngekuendigt -eq 1 -and $singular.tippsAngekuendigt -eq 1) 'Singular-Zaehler sind falsch.'
Assert-True (@($singular.sonstige).Count -eq 0) 'Ein Singular-Gruppenkopf wurde als Meldung gezaehlt.'

$invalidSingular = Get-CheckerResults (Tree @(
  (Node 0 -1 0 'Tree' '' 'NavFrameSSE.PrueferWidgetSSE.SteuerPruefer' 30 180)
  (Node 1 0 1 'TreeItem' '0 Fragen oder Warnungen' '' 30 200)
  (Node 2 0 1 'TreeItem' '2 Tipp oder Zusatzinformation' '' 30 240)
  (Node 3 0 1 'TreeItem' 'Synthetischer Tipp' '' 30 280)
))
Assert-True (-not (Test-CheckerResultComplete $invalidSingular)) 'Unbekannter Gruppenwortlaut wurde als vollstaendig akzeptiert.'

# Zwei passende Container bleiben mehrdeutig und deshalb geschlossen/fail-closed.
$mehrdeutig = Get-CheckerResults (Tree @(
  (Node 0 -1 0 'Tree' '' 'A.PrueferWidgetSSE.SteuerPruefer')
  (Node 1 -1 0 'Tree' '' 'B.PrueferWidgetSSE.SteuerPruefer')
))
Assert-True (-not $mehrdeutig.aktiv) 'Mehrdeutige Pruefer-Container wurden als aktiv akzeptiert.'
Assert-True (-not (Test-CheckerResultComplete $mehrdeutig)) 'Mehrdeutiger Pruefer darf nicht konsistent sein.'

# Qt omits a group whose count is zero. Its absence proves zero only in an
# independently complete snapshot, never in a clipped or anonymous subtree.
$nurTippsBaum = Tree @(
  (Node 0 -1 0 'Tree' '' 'NavFrameSSE.PrueferWidgetSSE.SteuerPruefer' 30 180)
  (Node 1 0 1 'TreeItem' '1 Tipp oder Zusatzinformation' '' 30 200)
  (Node 2 0 1 'TreeItem' 'Synthetischer Tipp' '' 30 240)
)
$nurTippsBaum | Add-Member stats ([pscustomobject]@{
  truncated=$false; depthLimited=$false; err=0; cyc=0; valErr=0; scrollErr=0
})
$nurTipps = Get-CheckerResults $nurTippsBaum
Assert-True (-not $nurTipps.fragenWarnungenGruppeGesehen -and $nurTipps.tippsGruppeGesehen) 'Eine fehlende Null-Gruppe darf nicht als gesehen erfunden werden.'
Assert-True (Test-CheckerResultComplete $nurTipps $nurTippsBaum) 'Vollstaendige Tipps mit ausgelassener leerer Warnungsgruppe sind inkonsistent.'
Assert-True (-not (Test-CheckerResultComplete $nurTipps)) 'Ohne Baumnachweis wurde eine fehlende Gruppe als Null gewertet.'

$nurWarnungenBaum = Tree @(
  (Node 0 -1 0 'Tree' '' 'NavFrameSSE.PrueferWidgetSSE.SteuerPruefer' 30 180)
  (Node 1 0 1 'TreeItem' '1 Frage oder Warnung' '' 30 200)
  (Node 2 0 1 'TreeItem' 'Synthetische Warnung' '' 30 240)
)
$nurWarnungenBaum | Add-Member stats $nurTippsBaum.stats
Assert-True (Test-CheckerResultComplete (Get-CheckerResults $nurWarnungenBaum) $nurWarnungenBaum) 'Vollstaendige Warnungen mit ausgelassener leerer Tipp-Gruppe sind inkonsistent.'

foreach ($flag in @('truncated','depthLimited','err','cyc','valErr','scrollErr')) {
  $unvollstaendig = Tree $nurTippsBaum.nodes
  $stats = [pscustomobject]@{truncated=$false;depthLimited=$false;err=0;cyc=0;valErr=0;scrollErr=0}
  $stats.$flag = $(if ($flag -in @('truncated','depthLimited')) {$true} else {1})
  $unvollstaendig | Add-Member stats $stats
  Assert-True (-not (Test-CheckerResultComplete (Get-CheckerResults $unvollstaendig) $unvollstaendig)) "Unsicherer Baum ($flag) bestaetigt eine ausgelassene Null-Gruppe."
}
$mitPlatzhalter = Tree @($nurTippsBaum.nodes + (Node 3 0 1 'TreeItem' '' '' 30 280))
$mitPlatzhalter | Add-Member stats $nurTippsBaum.stats
Assert-True (-not (Test-CheckerResultComplete (Get-CheckerResults $mitPlatzhalter) $mitPlatzhalter)) 'Namenlose Zeile wurde bei ausgelassener Null-Gruppe uebergangen.'
$mitUnbekanntemEintrag = Tree @(
  (Node 0 -1 0 'Tree' '' 'NavFrameSSE.PrueferWidgetSSE.SteuerPruefer' 30 180)
  (Node 1 0 1 'TreeItem' 'Unzugeordnete Warnung' '' 30 190)
  (Node 2 0 1 'TreeItem' '1 Tipp oder Zusatzinformation' '' 30 220)
  (Node 3 0 1 'TreeItem' 'Synthetischer Tipp' '' 30 260)
)
$mitUnbekanntemEintrag | Add-Member stats $nurTippsBaum.stats
Assert-True (-not (Test-CheckerResultComplete (Get-CheckerResults $mitUnbekanntemEintrag) $mitUnbekanntemEintrag)) 'Unzugeordneter Eintrag wurde als fehlende Null-Gruppe gewertet.'

Write-Output 'Checker-Zero-Results: offen/leer, geschlossen, unvollstaendig und normal korrekt unterschieden.'
