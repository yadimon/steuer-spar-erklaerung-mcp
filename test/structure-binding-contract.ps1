$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot '..\powershell\structure-binding.ps1')

function Assert-True([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw $Message }
}

function Node([int]$I, [int]$P, [int]$D, [string]$Type, [string]$Name, [string]$Aid = '',
              [int]$X = 600, [int]$Y = 400) {
  [pscustomobject]@{
    i=$I; p=$P; d=$D; type=$Type; name=$Name; aid=$Aid
    x=$X; y=$Y; w=200; h=20; on=$true; rid="42.$I"
  }
}

# Engine 31: der Blattknoten traegt selbst eine AutomationId.
$engine31 = @(
  (Node 0 -1 0 'Group' '' 'SSE_Application.AAV4GLEngineWindow31.centralWidget')
  (Node 1  0 1 'Group' '' 'TopLevelHSplitter.RedThreadContent.ClientFrameSSE')
  (Node 2  1 2 'Group' '' 'RedThreadContent.ClientFrameSSE.ClientHeader')
  (Node 3  2 3 'Text'  'Abgabe der Steuererklaerung' 'ClientFrameSSE.ClientHeader.QLabel' 575 199)
)
# Engine 30: identischer Container, Blattknoten OHNE AutomationId.
$engine30 = @(
  (Node 0 -1 0 'Group' '' 'AAV4GLEngineWindow30.centralWidget')
  (Node 1  0 1 'Group' '' 'TopLevelHSplitter.RedThreadContent.ClientFrameSSE')
  (Node 2  1 2 'Group' '' 'RedThreadContent.ClientFrameSSE.ClientHeader')
  (Node 3  2 3 'Text'  'Erhalt der Steuerbescheiddaten' '' 556 153)
)

$suffix = '.ClientFrameSSE.ClientHeader'
Assert-True ((Get-SSEContainerChild $engine31 $suffix 'Text').name -eq 'Abgabe der Steuererklaerung') `
  'Engine-31-Ueberschrift wurde nicht ueber den Container gefunden.'
Assert-True ((Get-SSEContainerChild $engine30 $suffix 'Text').name -eq 'Erhalt der Steuerbescheiddaten') `
  'Engine-30-Ueberschrift wurde nicht ueber den Container gefunden.'

# Fehlt der Container, wird NICHTS geraten.
$ohne = @( (Node 0 -1 0 'Text' 'irgendein Absatz' '' 620 195) )
Assert-True ($null -eq (Get-SSEContainerChild $ohne $suffix 'Text')) `
  'Ohne Container wurde ein Ergebnis geraten statt $null geliefert.'

# Ein Text AUSSERHALB des Containers darf nie gewinnen, auch nicht weiter oben.
$mitAbsatz = @(
  (Node 0 -1 0 'Text'  'der SteuerSparErklaerung fuer das Steuerjahr 2025.' '' 620 100)
  (Node 1 -1 0 'Group' '' 'RedThreadContent.ClientFrameSSE.ClientHeader')
  (Node 2  1 1 'Text'  'Datensicherung' '' 575 199)
)
Assert-True ((Get-SSEContainerChild $mitAbsatz $suffix 'Text').name -eq 'Datensicherung') `
  'Ein Absatz ausserhalb des Containers hat die Ueberschrift verdraengt.'

# Suchfeld: Edit im Container 'SearchSSE', beide Engines.
$suche31 = @(
  (Node 0 -1 0 'ToolBar' '' 'AAV4GLEngineWindow31.MainToolBar')
  (Node 1  0 1 'Group'   '' 'MainToolBar.QWidget')
  (Node 2  1 2 'Group'   '' 'QWidget.SearchSSE')
  (Node 3  2 3 'Edit'    '' 'SearchSSE.QLineEdit' 2149 78)
)
$suche30 = @(
  (Node 0 -1 0 'ToolBar' '' 'AAV4GLEngineWindow30.MainToolBar')
  (Node 1  0 1 'Group'   '' '')
  (Node 2  1 2 'Group'   '' 'AAV4GLEngineWindow30.MainToolBar.QWidget.SearchSSE')
  (Node 3  2 3 'Edit'    '' '' 2149 78)
)
Assert-True ($null -ne (Get-SSEContainerChild $suche31 'SearchSSE' 'Edit')) 'Suchfeld Engine 31 nicht gefunden.'
Assert-True ($null -ne (Get-SSEContainerChild $suche30 'SearchSSE' 'Edit')) 'Suchfeld Engine 30 nicht gefunden.'

# Tiefe Verschachtelung: auch ein Enkel des Containers zaehlt.
$tief = @(
  (Node 0 -1 0 'Group' '' 'RedThreadContent.ClientFrameSSE.ClientHeader')
  (Node 1  0 1 'Group' '' '')
  (Node 2  1 2 'Text'  'tief liegende Ueberschrift' '' 575 199)
)
Assert-True ((Get-SSEContainerChild $tief $suffix 'Text').name -eq 'tief liegende Ueberschrift') `
  'Enkelknoten des Containers wurde nicht gefunden.'

# Beide ausgelieferten Kataloge muessen die Containerendungen deklarieren und
# die alte Blattendung losgeworden sein.
foreach ($jahr in @('2024', '2025')) {
  $pfad = Join-Path $PSScriptRoot "..\profiles\$jahr\page-objects.json"
  $katalog = Get-Content -LiteralPath $pfad -Raw | ConvertFrom-Json
  $haupt = $katalog.windows.main
  Assert-True ($haupt.headingContainerAutomationIdSuffix -eq '.ClientFrameSSE.ClientHeader') `
    "Profil $jahr deklariert keine Ueberschrifts-Containerendung."
  Assert-True ($haupt.searchContainerAutomationIdSuffix -eq 'SearchSSE') `
    "Profil $jahr deklariert keine Such-Containerendung."
  Assert-True ($null -eq $haupt.headingAutomationIdSuffix) `
    "Profil $jahr traegt noch die alte Blattendung headingAutomationIdSuffix."
}

# Navigationsauswahl: genau das ausgewaehlte TreeItem, sonst $null.
$baum = @(
  [pscustomobject]@{ i=0; p=-1; d=0; type='TreeItem'; name='Steuererklaerung'; aid=''; x=25; y=229; w=200; h=20; selected=$false; rid='42.0' }
  [pscustomobject]@{ i=1; p=-1; d=0; type='TreeItem'; name='Pruefen und Abgeben'; aid=''; x=25; y=272; w=200; h=20; selected=$true; rid='42.1' }
)
Assert-True ((Get-SSENavigationSelectionFromNodes $baum) -eq 'Pruefen und Abgeben') `
  'Ausgewaehlter Navigationsknoten wurde nicht erkannt.'

$ohneAuswahl = @(
  [pscustomobject]@{ i=0; p=-1; d=0; type='TreeItem'; name='Steuererklaerung'; aid=''; x=25; y=229; w=200; h=20; selected=$false; rid='42.0' }
)
Assert-True ($null -eq (Get-SSENavigationSelectionFromNodes $ohneAuswahl)) `
  'Ohne Auswahl wurde ein Name geraten.'

# Mehrdeutigkeit ist ein Fehlerzustand, kein Ratespiel.
$zweiAuswahlen = @(
  [pscustomobject]@{ i=0; p=-1; d=0; type='TreeItem'; name='A'; aid=''; x=25; y=229; w=200; h=20; selected=$true; rid='42.0' }
  [pscustomobject]@{ i=1; p=-1; d=0; type='TreeItem'; name='B'; aid=''; x=25; y=272; w=200; h=20; selected=$true; rid='42.1' }
)
Assert-True ($null -eq (Get-SSENavigationSelectionFromNodes $zweiAuswahlen)) `
  'Bei zwei ausgewaehlten Knoten wurde einer geraten.'

# --------------------------------------------------------------------------
# Randfaelle der Containerbindung
# --------------------------------------------------------------------------

# Container gefunden, aber KEIN Kind des verlangten Typs darunter.
$ohneKindtyp = @(
  (Node 0 -1 0 'Group' '' 'RedThreadContent.ClientFrameSSE.ClientHeader')
  (Node 1  0 1 'Image' '' '' 575 199)
)
Assert-True ($null -eq (Get-SSEContainerChild $ohneKindtyp $suffix 'Text')) `
  'Ohne Kind des verlangten Typs wurde ein Ergebnis geraten statt $null.'

# Container als LETZTER Knoten des Bestands: kein Nachfahre kann folgen.
$containerZuletzt = @(
  (Node 0 -1 0 'Text'  'irgendein Inhalt' '' 620 300)
  (Node 1 -1 0 'Group' '' 'RedThreadContent.ClientFrameSSE.ClientHeader')
)
Assert-True ($null -eq (Get-SSEContainerChild $containerZuletzt $suffix 'Text')) `
  'Container als letzter Knoten lieferte ein erfundenes Kind.'

# Zwei passende Kinder im selben Container: das oberste (kleinstes y, dann x)
# gewinnt deterministisch.
$zweiKinder = @(
  (Node 0 -1 0 'Group' '' 'RedThreadContent.ClientFrameSSE.ClientHeader')
  (Node 1  0 1 'Text'  'unterer Text' '' 575 240)
  (Node 2  0 1 'Text'  'oberer Text'  '' 575 199)
)
Assert-True ((Get-SSEContainerChild $zweiKinder $suffix 'Text').name -eq 'oberer Text') `
  'Bei zwei Kindern gewann nicht das oberste (Sortierung y, x).'

# ZWEI Container mit derselben Endung: Mehrdeutigkeit ist ein Fehlerzustand.
# Der Modulgrundsatz gilt: es wird nie geraten - also $null, nicht der erste.
$zweiContainer = @(
  (Node 0 -1 0 'Group' '' 'A.ClientFrameSSE.ClientHeader')
  (Node 1  0 1 'Text'  'Titel A' '' 575 199)
  (Node 2 -1 0 'Group' '' 'B.ClientFrameSSE.ClientHeader')
  (Node 3  2 1 'Text'  'Titel B' '' 575 400)
)
Assert-True ($null -eq (Find-SSEContainerNode $zweiContainer $suffix)) `
  'Bei zwei passenden Containern wurde einer geraten statt $null geliefert.'
Assert-True ($null -eq (Get-SSEContainerChild $zweiContainer $suffix 'Text')) `
  'Mehrdeutige Container lieferten trotzdem ein Kind.'

# --------------------------------------------------------------------------
# Nachfahrenliste: Grundlage der Pruefer-Eintraege beider Engines.
# Engine 30 laesst die Blatt-AutomationIds weg; die Zugehoerigkeit zum
# Container muss deshalb ueber den Teilbaum laufen, nie ueber Blatt-Ids.
# --------------------------------------------------------------------------
$prueferSuffix = 'PrueferWidgetSSE.SteuerPruefer'

# Engine-31-Form: Qt VERERBT die Container-Id an die Eintraege - TreeItems
# tragen dieselbe Id wie ihr Tree. Ohne ContainerType-Filter waere der
# Container dadurch mehrdeutig.
$pruefer31 = @(
  (Node 0 -1 0 'Tree'     '' 'NavFrameSSE.PrueferWidgetSSE.SteuerPruefer')
  (Node 1  0 1 'TreeItem' '3 Fragen oder Warnungen' 'NavFrameSSE.PrueferWidgetSSE.SteuerPruefer' 30 200)
  (Node 2  0 1 'TreeItem' 'Sparer-Pauschbetrag zu hoch?' 'NavFrameSSE.PrueferWidgetSSE.SteuerPruefer' 30 240)
)
# Engine-30-Form: identische Struktur, Eintraege OHNE eigene Ids.
$pruefer30 = @(
  (Node 0 -1 0 'Tree'     '' 'NavFrameSSE.PrueferWidgetSSE.SteuerPruefer')
  (Node 1  0 1 'TreeItem' '3 Fragen oder Warnungen' '' 30 200)
  (Node 2  0 1 'TreeItem' 'Homeoffice-Pauschale?'   '' 30 240)
)
foreach ($paar in @(@('31', $pruefer31), @('30', $pruefer30))) {
  $eintraege = @(Get-SSEContainerDescendants $paar[1] $prueferSuffix 'TreeItem' 'Tree')
  Assert-True ($eintraege.Count -eq 2) `
    ("Engine " + $paar[0] + ": erwartet 2 Pruefer-Eintraege, gefunden " + $eintraege.Count)
  Assert-True ($eintraege[0].name -eq '3 Fragen oder Warnungen') `
    ("Engine " + $paar[0] + ": Sortierung nach y verletzt.")
}

# Leerer Pruefer (Panel offen, keine Meldungen): leere Liste, KEIN Fehler.
$prueferLeer = @( (Node 0 -1 0 'Tree' '' 'NavFrameSSE.PrueferWidgetSSE.SteuerPruefer') )
Assert-True (@(Get-SSEContainerDescendants $prueferLeer $prueferSuffix 'TreeItem' 'Tree').Count -eq 0) `
  'Leerer Prueferbaum lieferte erfundene Eintraege.'

# Ohne Container: leere Liste.
Assert-True (@(Get-SSEContainerDescendants @() $prueferSuffix 'TreeItem' 'Tree').Count -eq 0) `
  'Fehlender Container lieferte Eintraege.'

# TreeItems FREMDER Baeume (z. B. Navigationsbaum) duerfen nie hineinzaehlen.
$mitNavbaum = $pruefer30 + @(
  (Node 3 -1 0 'Tree'     '' 'NavFrameSSE.QWidget.NavWidgetSSE')
  (Node 4  3 1 'TreeItem' 'Steuererklaerung' '' 25 300)
)
Assert-True (@(Get-SSEContainerDescendants $mitNavbaum $prueferSuffix 'TreeItem' 'Tree').Count -eq 2) `
  'Navigationsknoten zaehlten in den Prueferbaum hinein.'

# Der Container selbst zaehlt nie als eigener Nachfahre, auch wenn der
# verlangte Kindtyp dem Containertyp entspricht.
$treeInTree = @(
  (Node 0 -1 0 'Tree' '' 'NavFrameSSE.PrueferWidgetSSE.SteuerPruefer')
  (Node 1  0 1 'Tree' '' '')
)
Assert-True (@(Get-SSEContainerDescendants $treeInTree $prueferSuffix 'Tree' 'Tree').Count -eq 1) `
  'Container zaehlte sich selbst als Nachfahren oder verlor ein echtes Tree-Kind.'

# --------------------------------------------------------------------------
# Aufgezeichnete Baeume beider Engines
#
# Die synthetischen Faelle oben binden die Regel; diese Fixtures binden die
# ANNAHME, auf der sie ruht: dass der Ueberschriftscontainer in Engine 30 und
# 31 dieselbe AutomationId-Endung traegt, obwohl Engine 30 die Id des
# Blattknotens weglaesst. Ohne sie wuerde ein Produktupdate die Regel still
# aushebeln und nur der Live-Smoke es merken.
# --------------------------------------------------------------------------
$fixtureAnzahl = 0
$gesehendeEngines = New-Object System.Collections.ArrayList
foreach ($jahr in @('2024', '2025')) {
  $ordner = Join-Path $PSScriptRoot "..\profiles\$jahr\fixtures"
  Assert-True (Test-Path -LiteralPath $ordner) "Fixture-Ordner fuer $jahr fehlt."
  foreach ($datei in Get-ChildItem -LiteralPath $ordner -Filter '*.json') {
    $fixture = Get-Content -LiteralPath $datei.FullName -Raw | ConvertFrom-Json
    $gefunden = Get-SSEContainerChild $fixture.nodes $suffix 'Text'
    if ($null -eq $fixture.erwarteteUeberschrift) {
      Assert-True ($null -eq $gefunden) `
        "$jahr/$($datei.Name): Ueberschrift geraten, obwohl der Container fehlt."
    } else {
      Assert-True ($null -ne $gefunden) `
        "$jahr/$($datei.Name): Ueberschrift nicht ueber den Container gefunden."
      Assert-True ($gefunden.name -eq $fixture.erwarteteUeberschrift) `
        "$jahr/$($datei.Name): erwartet '$($fixture.erwarteteUeberschrift)', gelesen '$($gefunden.name)'."
    }
    # Suchfeld: in beiden Engines ueber denselben Container erreichbar.
    Assert-True ($null -ne (Get-SSEContainerChild $fixture.nodes 'SearchSSE' 'Edit')) `
      "$jahr/$($datei.Name): Suchfeld nicht ueber den Container 'SearchSSE' gebunden."
    $null = $gesehendeEngines.Add([int]$fixture.engine)
    $fixtureAnzahl++
  }
}
Assert-True ($fixtureAnzahl -ge 4) "Zu wenige Fixtures: $fixtureAnzahl"
Assert-True (@($gesehendeEngines | Sort-Object -Unique) -join ',' -eq '30,31') `
  "Beide Engines muessen vertreten sein, gesehen: $(@($gesehendeEngines | Sort-Object -Unique) -join ',')"

# Die Fixtures duerfen keine Steuerwerte tragen.
foreach ($jahr in @('2024', '2025')) {
  foreach ($datei in Get-ChildItem -LiteralPath (Join-Path $PSScriptRoot "..\profiles\$jahr\fixtures") -Filter '*.json') {
    $roh = Get-Content -LiteralPath $datei.FullName -Raw
    Assert-True (-not ($roh -match '"val"')) "$jahr/$($datei.Name): Fixture traegt Feldwerte."
    Assert-True (-not ($roh -match '\d+\.\d{3},\d{2}')) "$jahr/$($datei.Name): Fixture traegt einen Betrag."
  }
}

Write-Output 'Strukturbindung: alle Vertraege bestanden'
