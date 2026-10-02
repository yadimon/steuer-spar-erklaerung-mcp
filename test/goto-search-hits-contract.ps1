# Trefferauswahl der globalen Suche in `goto`.
#
# Die Ergebnistabelle hat links den Titel der Fundstelle, rechts ihren Ort im
# Formular. Waehrend die Suche offen ist, steht ausserdem der Navigationsbaum
# verschoben im selben Fensterausschnitt. Frueher konnten deshalb Pfadzellen
# (Feldtreffer '.../Reisekosten (3)' oeffnete '1. Reise') und Baumknoten
# (Klick in die Zeilenmitte waehlt nichts) zum Anker werden.
#
# Dieser Vertrag haelt mit Trefferlisten nach gemessenen Suchen fest:
#   1. Anker ist nur eine Titelzelle der Ergebnistabelle mit genau der
#      gesuchten Ueberschrift; Pfadzellen, Baumknoten, Suchecho und
#      Formulartexte zaehlen nie.
#   2. Ein Titel in einem Text der Titelzelle bindet diese Zelle.
#   3. Kein oder mehr als ein Treffer liefert keinen Anker.
#   4. Ueberschriften werden zeichengenau verglichen, ohne Platzhalter.
#   5. Fuer Seitenobjekte mit Praefix-Ueberschrift entscheidet ohne exakten
#      Titel deren Regel - nur ueber Titelzellen, erste passende Zeile.
$ErrorActionPreference = 'Stop'

$root = Split-Path $PSScriptRoot -Parent
. (Join-Path $root 'powershell\structure-binding.ps1')

function Assert-True([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw $Message }
}

$tableAid = 'SSE_Application.AAV4GLEngineWindow31.centralWidget.SearchSplitter.SearchFrameSSE.SearchResultsView.QStackedWidget.DialogSearchResultsTableView'
$navAid = 'SSE_Application.AAV4GLEngineWindow31.centralWidget.SearchSplitter.TopLevelHSplitter.NavFrameSSE.QWidget.NavWidgetSSE'
function Node([int]$I, [int]$P, [string]$Type, [string]$Name, [int]$X, [int]$Y, [int]$W, [int]$H, [string]$Aid = '') {
  [pscustomobject]@{ i=$I; p=$P; d=0; type=$Type; name=$Name; aid=$Aid; x=$X; y=$Y; w=$W; h=$H; on=$true; rid="42.$I" }
}
function Row([string[]]$Cells) { [pscustomobject]@{ cells=@($Cells) } }

# Suchseite wie gemessen: Suchecho, eine Formularzeile hinter der Suche, die
# Ergebnistabelle (Titelspalte x80, Pfadspalte x318, Zeilenhoehe 25) und der
# um die Trefferliste nach unten verschobene Navigationsbaum.
function SearchPage([string]$Term, [object[]]$Rows, [string[]]$TreeNames = @(), [string]$FormText = '') {
  $nodes = New-Object System.Collections.ArrayList
  $null = $nodes.Add((Node 0 -1 'Window' 'SteuerSparErklärung' 42 30 1816 1075))
  $null = $nodes.Add((Node 1 0 'Text' "Ihre Suche nach `"$Term`" hat folgende Treffer ergeben:" 80 146 900 20))
  $null = $nodes.Add((Node 2 0 'Text' $FormText 600 700 400 20))
  $null = $nodes.Add((Node 3 0 'Table' '' 80 227 1740 154 $tableAid))
  $index = 4
  $y = 252
  foreach ($row in $Rows) {
    $column = 0
    foreach ($cell in @($row.cells)) {
      $null = $nodes.Add((Node $index 3 'DataItem' $cell @(80, 318)[$column] $y @(238, 1502)[$column] 25 $tableAid))
      $index++
      $column++
    }
    $y += 25
  }
  $tree = $index
  $null = $nodes.Add((Node $tree 0 'Tree' '' 25 420 437 600 $navAid))
  $index++
  $treeY = 434
  foreach ($name in $TreeNames) {
    $null = $nodes.Add((Node $index $tree 'TreeItem' $name 70 $treeY 392 34 $navAid))
    $index++
    $treeY += 34
  }
  @($nodes)
}
function Hit($Nodes, [string]$Target) { Select-SSESearchHit $Nodes $Target }

$UStE = 'Umsatzsteuererklärung 2025'
$UStVA = 'Umsatzsteuer-Voranmeldungen 2025'
$angaben = 'Allgemeine Angaben zum Unternehmen'

# A. Suche nach der UStVA: der Titel steht in Zeile 2; 'Allgemeine Angaben
#    zum Unternehmen' nur als Pfad einer anderen Fundstelle und im Baum.
$ustvaList = SearchPage $UStVA @(
  (Row @('Themenfilter/Angaben zur Umsatzsteuer', $angaben))
  (Row @($UStVA))
  (Row @('Vorsteuer (Übersicht)', 'Einnahmen/Ausgaben/Betriebsausgaben'))
  (Row @('Ergebnisse mit mindestens einem der Suchbegriffe anzeigen'))
) @('Voreinstellungen und ELSTER-Anmeldeinformation', $angaben, 'Fahrzeuge (1)', 'Einnahmen/Ausgaben', $UStE, $UStVA)
$ustvaHit = Hit $ustvaList $UStVA
Assert-True ($ustvaHit.type -ceq 'DataItem' -and $ustvaHit.x -eq 80 -and $ustvaHit.y -eq 277 -and $ustvaHit.name -ceq $UStVA) `
  "Die UStVA-Titelzelle wurde nicht gewaehlt: $($ustvaHit | ConvertTo-Json -Compress)"
Assert-True ($null -eq (Hit $ustvaList $angaben)) `
  'Pfadzelle oder verschobener Baumknoten wurde fuer Allgemeine Angaben zum Unternehmen gewaehlt.'
Assert-True ($null -eq (Hit $ustvaList $UStE)) 'Ein Baumknoten wurde als Suchtreffer gewaehlt.'

# B. Suche nach der UStE: die Seite selbst ist kein Treffer, nur Feld- und
#    Hilfetreffer; dieselbe Ueberschrift steht als Formulartext hinter der Suche.
$usteList = SearchPage $UStE @(
  (Row @('Steuernummer-Treffer', 'Einnahmen/Ausgaben/Betriebsausgaben/Telefon/Mobilfunk/Internet (1)'))
  (Row @('AfA-Ermittlung', 'Fahrzeuge (1)/Passat/Abschreibung'))
  (Row @($angaben, ''))
  (Row @('Beiträge, Gebühren und Abgaben', 'Einnahmen/Ausgaben/Betriebsausgaben'))
  (Row @('Betriebseinnahmen', 'Einnahmen/Ausgaben'))
  (Row @('Bürobedarf', 'Einnahmen/Ausgaben/Betriebsausgaben'))
) @() $UStE
Assert-True ($null -eq (Hit $usteList $UStE)) 'Fuer die UStE wurde ein Anker gewaehlt, obwohl die Tabelle sie nicht nennt.'
$buero = Hit $usteList 'Bürobedarf'
Assert-True ($buero.x -eq 80 -and $buero.y -eq 377) "Die Titelzelle 'Bürobedarf' wurde nicht gewaehlt: $($buero | ConvertTo-Json -Compress)"
$angabenTitle = Hit $usteList $angaben
Assert-True ($angabenTitle.x -eq 80 -and $angabenTitle.y -eq 302) 'Eine Titelzelle mit leerer Pfadzelle wurde nicht gewaehlt.'

# C. Reisekosten: Titel mit Zaehler, Baumknoten mit Zaehler, und der Altfall,
#    dessen Pfadspalte '.../Reisekosten (3)' nannte.
$travelList = SearchPage 'Reisekosten' @(
  (Row @('Betriebsausgaben', 'Einnahmen/Ausgaben'))
  (Row @('Fortbildungskosten', 'Einnahmen/Ausgaben/Betriebsausgaben'))
  (Row @('Reisekosten (1)', 'Einnahmen/Ausgaben/Betriebsausgaben'))
  (Row @('Reiseziel', 'Einnahmen/Ausgaben/Betriebsausgaben/Reisekosten (3)'))
) @('Reisekosten (1)')
Assert-True ($null -eq (Hit $travelList 'Reisekosten')) 'Ein unscharfer Treffer wurde fuer Reisekosten gewaehlt.'
$counted = Hit $travelList 'Reisekosten (1)'
Assert-True ($counted.type -ceq 'DataItem' -and $counted.x -eq 80 -and $counted.y -eq 302) 'Der exakte Titel mit Zaehler wurde nicht gewaehlt.'

# D. Leere Titelzelle: die Pfadzelle wird nicht zum Titel.
Assert-True ($null -eq (Hit (SearchPage 'Bürobedarf' @((Row @('', 'Bürobedarf')))) 'Bürobedarf')) `
  'Bei leerer Titelzelle wurde die Pfadzelle gewaehlt.'

# E. Derselbe Titel zweimal: kein Anker.
Assert-True ($null -eq (Hit (SearchPage 'Bürobedarf' @((Row @('Bürobedarf', 'A')), (Row @('Bürobedarf', 'B')))) 'Bürobedarf')) `
  'Ein mehrdeutiger Titel wurde als Anker gewaehlt.'

# F. Titel im Text der Titelzelle bindet die Zelle; ein Text in der
#    Pfadzelle nicht.
$textList = @(
  (Node 0 -1 'Window' 'SteuerSparErklärung' 42 30 1816 1075)
  (Node 1 0 'Table' '' 80 227 1740 154 $tableAid)
  (Node 2 1 'DataItem' 'Arbeitnehmer' 80 252 238 25 $tableAid)
  (Node 3 2 'Text' 'Werbungskosten' 90 256 200 18)
  (Node 4 1 'DataItem' 'Bereich' 318 252 1502 25 $tableAid)
  (Node 5 4 'Text' 'Kinderbetreuungskosten' 330 256 300 18)
)
$viaText = Hit $textList 'Werbungskosten'
Assert-True ($viaText.i -eq 2 -and $viaText.type -ceq 'DataItem') 'Ein Titel im Text der Titelzelle band nicht die Zelle.'
Assert-True ($null -eq (Hit $textList 'Kinderbetreuungskosten')) 'Ein Text in der Pfadzelle wurde zum Anker.'

# G. Zeichengenau, ohne Platzhalter.
$bracketList = SearchPage 'Reisekosten [alt]' @((Row @('Reisekosten [alt]', 'A')), (Row @('Reisekosten x', 'B')))
Assert-True ((Hit $bracketList 'Reisekosten [alt]').y -eq 252) 'Eckige Klammern brachen den exakten Vergleich.'
Assert-True ($null -eq (Hit $bracketList 'Reisekosten*')) 'Ein Platzhalter im Ziel traf einen Titel.'
Assert-True ($null -eq (Hit $bracketList 'reisekosten [alt]')) 'Der Vergleich ignoriert Gross-/Kleinschreibung.'

# H. Ohne Ergebnistabelle kein Anker.
Assert-True ($null -eq (Hit @((Node 0 -1 'Window' 'SteuerSparErklärung' 42 30 1816 1075)) 'Bürobedarf')) `
  'Ohne Ergebnistabelle wurde ein Anker geliefert.'

# I. goto und der Rueckfall goto_tree verwenden genau diese Auswahl und keine
#    Platzhaltervergleiche mehr.
$worker = Get-Content -LiteralPath (Join-Path $root 'powershell\sse-worker.ps1') -Raw
$errors = $null
$ast = [Management.Automation.Language.Parser]::ParseInput($worker, [ref]$null, [ref]$errors)
foreach ($operation in @('goto', 'goto_tree')) {
  $clause = @(@($ast.FindAll({
    param($node)
    $node -is [Management.Automation.Language.SwitchStatementAst] -and
    @($node.Clauses | Where-Object { $_.Item1.Extent.Text -ceq "'$operation'" }).Count -eq 1
  }, $true))[0].Clauses | Where-Object { $_.Item1.Extent.Text -ceq "'$operation'" })[0].Item2.Extent.Text
  Assert-True ($clause.Contains('$genau = Select-SSESearchHit $tt.nodes $ziel')) "$operation waehlt Suchtreffer nicht ueber Select-SSESearchHit."
  Assert-True (-not $clause.Contains('-like "*$ziel*"') -and -not $clause.Contains('"*$($_.name)*"')) `
    "$operation vergleicht Ueberschriften wieder mit Platzhaltern."
}

# J. Seitenobjekte mit Praefix-Ueberschrift (eine Seite je Person). Ohne
#    exakten Titel gilt die Regel des Seitenobjekts, aber nur fuer
#    Titelzellen; die erste passende Zeile gewinnt, ein exakter Titel geht vor.
$prefix = 'Sonstige Werbungskosten/Fahrten'
$prefixRule = { param($titel) $titel.StartsWith('Sonstige Werbungskosten/Fahrten', [StringComparison]::Ordinal) }
$personList = SearchPage $prefix @(
  (Row @('Kontoführungsgebühren', "$prefix Heinz"))
  (Row @('Arbeitnehmer Eva', 'Steuererklärung'))
  (Row @("$prefix Eva", 'Steuererklärung/Arbeitnehmer Eva'))
  (Row @("$prefix Heinz", 'Steuererklärung/Arbeitnehmer Heinz'))
  (Row @('Ergebnisse mit mindestens einem der Suchbegriffe anzeigen'))
) @("$prefix Eva")
Assert-True ($null -eq (Hit $personList $prefix)) 'Ohne Seitenobjektregel wurde ein Praefixtreffer gewaehlt.'
$person = Select-SSESearchHit $personList $prefix -Accept $prefixRule
Assert-True ($person.type -ceq 'DataItem' -and $person.x -eq 80 -and $person.y -eq 302 -and $person.name -ceq "$prefix Eva") `
  "Die erste passende Titelzelle wurde nicht gewaehlt: $($person | ConvertTo-Json -Compress)"
$exactFirst = SearchPage $prefix @((Row @("$prefix Eva", 'A')), (Row @($prefix, 'B')))
Assert-True ((Select-SSESearchHit $exactFirst $prefix -Accept $prefixRule).y -eq 277) 'Ein exakter Titel ging nicht vor.'
$exactTwice = SearchPage $prefix @((Row @($prefix, 'A')), (Row @($prefix, 'B')), (Row @("$prefix Eva", 'C')))
Assert-True ($null -eq (Select-SSESearchHit $exactTwice $prefix -Accept $prefixRule)) 'Ein mehrdeutiger exakter Titel wurde durch die Regel aufgeloest.'
$gotoClause = @(@($ast.FindAll({
  param($node)
  $node -is [Management.Automation.Language.SwitchStatementAst] -and
  @($node.Clauses | Where-Object { $_.Item1.Extent.Text -ceq "'goto'" }).Count -eq 1
}, $true))[0].Clauses | Where-Object { $_.Item1.Extent.Text -ceq "'goto'" })[0].Item2.Extent.Text
Assert-True ($gotoClause.Contains('$titelRegel = $(if ($knownTarget) { { param($titel) Test-KnownPageHeading $titel $knownTarget.page } } else { $null })') -and
  $gotoClause.Contains('$genau = Select-SSESearchHit $tt.nodes $ziel -Accept $titelRegel')) `
  'goto gibt die Seitenobjektregel nicht nur fuer bekannte Ziele an die Trefferauswahl.'

Write-Output 'goto-Suchtreffer: nur Titelzellen der Ergebnistabelle, exakt oder nach Seitenobjektregel - bestanden'
