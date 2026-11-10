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
Assert-True ($gotoClause.Contains('$genau = Select-SSESearchHit $tt.nodes $ziel -Accept $titelRegel')) `
  'goto uebergibt die ermittelte Titelregel nicht an die produktive Trefferauswahl.'

# The search activation flag predates closing the search panel. Execute the
# actual success block: a stale flag must never publish success for another
# heading or for a known page whose required fields are still unavailable.
$gotoBody = @(@($ast.FindAll({
  param($node)
  $node -is [Management.Automation.Language.SwitchStatementAst] -and
  @($node.Clauses | Where-Object { $_.Item1.Extent.Text -ceq "'goto'" }).Count -eq 1
}, $true))[0].Clauses | Where-Object { $_.Item1.Extent.Text -ceq "'goto'" })[0].Item2

# Execute the actual dispatcher rule assignment and its actual selector call.
# A bare ordinal identifies neither an asset nor another page family.
$ruleAssignments = @($gotoBody.FindAll({ param($node)
  $node -is [Management.Automation.Language.AssignmentStatementAst] -and
  $node.Left.Extent.Text -ceq '$titelRegel'
}, $true))
$hitAssignments = @($gotoBody.FindAll({ param($node)
  $node -is [Management.Automation.Language.AssignmentStatementAst] -and
  $node.Left.Extent.Text -ceq '$genau' -and
  $node.Right.Extent.Text -ceq 'Select-SSESearchHit $tt.nodes $ziel -Accept $titelRegel'
}, $true))
Assert-True ($ruleAssignments.Count -eq 1 -and $hitAssignments.Count -eq 1) 'Die produktive Suchregel und Auswahl sind nicht eindeutig.'
Assert-True ([object]::ReferenceEquals($ruleAssignments[0].Parent, $hitAssignments[0].Parent)) 'Suchregel und Auswahl gehoeren nicht zum selben produktiven Ablauf.'
$statements = @($ruleAssignments[0].Parent.Statements)
Assert-True ([array]::IndexOf($statements, $hitAssignments[0]) -eq [array]::IndexOf($statements, $ruleAssignments[0]) + 1) `
  'Zwischen Suchregel und Auswahl darf kein anderer Ablauf die Bindung ersetzen.'
$headingPredicate = @($ast.FindAll({ param($node)
  $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq 'Test-KnownPageHeading'
}, $true))
Assert-True ($headingPredicate.Count -eq 1) 'Die produktive Titelpruefung fehlt.'
. ([scriptblock]::Create($headingPredicate[0].Extent.Text))
$ruleAssignment = [scriptblock]::Create($ruleAssignments[0].Extent.Text)
$hitAssignment = [scriptblock]::Create($hitAssignments[0].Extent.Text)
function Invoke-GotoSearchSelection($Page, [string]$Target, $Nodes, [switch]$FreeTarget) {
  $knownTarget = $(if ($FreeTarget) { $null } else { [pscustomobject]@{ page=$Page } }); $ziel=$Target
  $tt=[pscustomobject]@{nodes=$Nodes}; $titelRegel=$null; $genau=$null
  . $ruleAssignment
  Assert-True (-not $FreeTarget -or $null -eq $titelRegel) 'Ein freies Ziel erhielt eine Seitenobjektregel.'
  . $hitAssignment
  $genau
}
$catalog = Get-Content -LiteralPath (Join-Path $root 'profiles\2025\page-objects.json') -Raw | ConvertFrom-Json
$assetPage = $catalog.pages.'gew.anlagevermoegen_wirtschaftsgut'
Assert-True ($assetPage.headingPrefix -ceq '1. ') 'Der reale Katalog-Gegenfall fuer einen blossen Zaehler fehlt.'
$ordinalRows = SearchPage '1. ' @((Row @('1. Reise', 'A')), (Row @('1. Fahrzeug: Synthetic', 'B')))
Assert-True ($null -eq (Invoke-GotoSearchSelection $assetPage '1. ' $ordinalRows)) `
  'Ein blosser Zaehler akzeptierte eine Suchzeile einer anderen Seitenart.'
Assert-True ((Invoke-GotoSearchSelection ([pscustomobject]@{heading=$prefix;headingPrefix=$prefix}) $prefix $personList).y -eq 302) `
  'Die produktive Regel verlor den ersten gebundenen dynamischen Titel.'
Assert-True ((Invoke-GotoSearchSelection $catalog.pages.'gew.fahrzeug' 'Fahrzeug' `
  (SearchPage 'Fahrzeug' @((Row @('2. Fahrzeug: Synthetic', 'A'))))).name -ceq '2. Fahrzeug: Synthetic') `
  'Eine katalogisierte nummerierte Seitenart wurde abgewiesen.'
Assert-True ((Invoke-GotoSearchSelection $assetPage '1. ' (SearchPage '1. ' @((Row @('1. ', 'A'))))).name -ceq '1. ') `
  'Der unveraenderte zeichengenaue Titelpfad wurde blockiert.'
Assert-True ($null -eq (Invoke-GotoSearchSelection $null $prefix $personList -FreeTarget)) `
  'Ein freies Ziel akzeptierte einen dynamischen Praefixtitel ohne Katalogbindung.'
Assert-True ((Invoke-GotoSearchSelection $null $prefix $exactFirst -FreeTarget).y -eq 277) `
  'Ein freies Ziel muss weiterhin nur seine exakte Titelzelle auswaehlen.'

# Execute the real visible activation branch against a synthetic search UI.
# Guard preparation and post-input settling separate two single-click calls;
# only one double-click gesture opens the result within its timing budget.
$visibleActivationBlocks = @($gotoBody.FindAll({ param($node)
  $node -is [Management.Automation.Language.IfStatementAst] -and
  $node.Clauses[0].Item1.Extent.Text -ceq '-not $suchSeiteGeoeffnet -and -not $script:DESKTOP_NAME'
}, $true))
Assert-True ($visibleActivationBlocks.Count -eq 1) 'Die sichtbare Suchaktivierung ist nicht eindeutig.'
$visibleActivationBlock = [scriptblock]::Create($visibleActivationBlocks[0].Extent.Text)
function Test-VisibleSearchActivation([string]$HeadingAfter, [switch]$HiddenDesktop) {
  $script:searchClickClock = [long]0
  $script:searchClickTimes = New-Object System.Collections.ArrayList
  $script:searchClickTransactions = New-Object System.Collections.ArrayList
  $script:searchHeadingWaits = New-Object System.Collections.ArrayList
  $script:DESKTOP_NAME = $(if ($HiddenDesktop) { 'synthetic.desktop' } else { $null })
  $hwnd = [IntPtr]4242; $start = 'Startseite'; $ziel = 'Zielseite'
  $aktiviert = $false; $suchSeiteGeoeffnet = $false
  $genau = [pscustomobject]@{rid='42.synthetic-search';name=$ziel;type='DataItem';x=80;y=252;w=238;h=25}
  $suchWeg = New-Object System.Collections.ArrayList
  function Click-VerifiedPoint {
    param([IntPtr]$Window, $Node, [int]$ClickCount = 1)
    Assert-True ($Window -eq $hwnd -and [object]::ReferenceEquals($Node, $genau)) 'Die Suchaktivierung verlor den gebundenen Treffer.'
    $null = $script:searchClickTransactions.Add([pscustomobject]@{hwnd=[int64]$Window;rid=$Node.rid;count=$ClickCount})
    $script:searchClickClock += 100
    for ($index=0; $index -lt $ClickCount; $index++) {
      $null = $script:searchClickTimes.Add($script:searchClickClock)
      if ($index+1 -lt $ClickCount) { $script:searchClickClock += 90 }
    }
    $script:searchClickClock += 180
  }
  function Start-Sleep { param([int]$Milliseconds) $script:searchClickClock += $Milliseconds }
  function WarteAufUeberschrift {
    param([IntPtr]$Window, [string]$Previous, [string]$Target, [int]$TimeoutMs)
    $null = $script:searchHeadingWaits.Add([pscustomobject]@{hwnd=[int64]$Window;previous=$Previous;target=$Target;timeoutMs=$TimeoutMs})
    if ($script:searchClickTimes.Count -eq 2 -and
        $script:searchClickTimes[1]-$script:searchClickTimes[0] -le 300) { return $HeadingAfter }
    $Previous
  }
  function IstZielseite { param([IntPtr]$Window, [string]$Heading) $Window -eq $hwnd -and $Heading -ceq $ziel }
  . $visibleActivationBlock
  [pscustomobject]@{
    activated=$aktiviert; pageChanged=$suchSeiteGeoeffnet
    transactions=@($script:searchClickTransactions); times=@($script:searchClickTimes); waits=@($script:searchHeadingWaits)
  }
}
$doubleClick = Test-VisibleSearchActivation 'Zielseite'
Assert-True ($doubleClick.activated -and $doubleClick.pageChanged) 'Der Suchtreffer wurde nicht innerhalb des synthetischen Doppelklickfensters aktiviert.'
Assert-True ($doubleClick.transactions.Count -eq 1 -and $doubleClick.transactions[0].count -eq 2 -and
  $doubleClick.transactions[0].hwnd -eq 4242 -and $doubleClick.transactions[0].rid -ceq '42.synthetic-search') `
  'Die Suchaktivierung muss eine einzige bewachte Doppelklicktransaktion verwenden.'
Assert-True ($doubleClick.waits.Count -eq 1 -and $doubleClick.waits[0].timeoutMs -eq 1500 -and
  $doubleClick.waits[0].previous -ceq 'Startseite' -and $doubleClick.waits[0].target -ceq 'Zielseite') `
  'Die Suchaktivierung verlor ihre begrenzte Titel-Gegenprobe.'
$missingHeading = Test-VisibleSearchActivation ''
Assert-True (-not $missingHeading.activated -and -not $missingHeading.pageChanged -and $missingHeading.transactions.Count -eq 1) `
  'Eine fehlende Ueberschrift erlaubte Erfolg oder einen erneuten Klickversuch.'
$wrongHeading = Test-VisibleSearchActivation 'Andere Seite'
Assert-True (-not $wrongHeading.activated -and $wrongHeading.pageChanged -and $wrongHeading.transactions.Count -eq 1) `
  'Eine andere Ueberschrift wurde als Ziel akzeptiert oder erneut angeklickt.'
$hiddenSearch = Test-VisibleSearchActivation 'Zielseite' -HiddenDesktop
Assert-True (-not $hiddenSearch.activated -and -not $hiddenSearch.pageChanged -and
  $hiddenSearch.transactions.Count -eq 0 -and $hiddenSearch.waits.Count -eq 0) `
  'Der sichtbare Doppelklickpfad bediente einen versteckten Desktop.'
$script:DESKTOP_NAME = $null
Write-Output 'goto-Suchaktivierung: eine bewachte Doppelklicktransaktion, begrenzter Readback und negative Gegenfaelle - bestanden'

$activatedBlocks = @($gotoBody.FindAll({
  param($node)
  $node -is [Management.Automation.Language.IfStatementAst] -and
  $node.Clauses[0].Item1.Extent.Text -ceq '$aktiviert'
}, $true))
Assert-True ($activatedBlocks.Count -eq 1) 'Der Sucherfolgsblock ist nicht eindeutig.'
$activatedBlock = [scriptblock]::Create($activatedBlocks[0].Extent.Text)
function Test-SearchSuccess([string]$HeadingAfter, [bool]$FieldsReady) {
  $script:searchEmitted = $null; $script:searchFailure = $null
  $script:searchWaits = New-Object System.Collections.ArrayList
  $aktiviert = $true; $hwnd = [IntPtr]4242; $nachSuche = 'Frueher bestaetigt'
  $ziel = 'Zielseite'; $pageId = 'synthetic.page'
  $weg = @('Startseite'); $suchWeg = New-Object System.Collections.ArrayList
  $null = $suchWeg.Add('Suchtreffer aktiviert')
  function WarteAufZielseite {
    param([IntPtr]$h, [int]$timeoutMs)
    $null = $script:searchWaits.Add([pscustomobject]@{h=[int64]$h;timeoutMs=$timeoutMs})
    [pscustomobject]@{bereit=($FieldsReady -and $HeadingAfter -ceq $ziel);ueberschrift=$HeadingAfter;runden=@()}
  }
  function IstZielseite { param([IntPtr]$h, [string]$heading) $FieldsReady -and $heading -ceq $ziel }
  function Emit { param($result) $script:searchEmitted=$result; throw 'search-emitted' }
  function Fail { param($msg,$kind,$details) $script:searchFailure=[pscustomobject]@{kind=$kind;details=$details}; throw 'search-failed' }
  try { . $activatedBlock } catch {
    Assert-True ($_.Exception.Message -in @('search-emitted','search-failed')) "Unerwarteter Suchabschluss: $($_.Exception.Message)"
  }
  [pscustomobject]@{emitted=$script:searchEmitted;failure=$script:searchFailure;waits=@($script:searchWaits)}
}
foreach ($case in @(
  [pscustomobject]@{heading='Andere Seite';fields=$true},
  [pscustomobject]@{heading='';fields=$true},
  [pscustomobject]@{heading='Zielseite';fields=$false}
)) {
  $result = Test-SearchSuccess $case.heading $case.fields
  Assert-True ($null -eq $result.emitted -and $result.failure.kind -ceq 'navigation-blocked') `
    'Ein frueherer Sucherfolg ueberging die frische Ziel-/Feldpruefung nach Suchschluss.'
}
$ready = Test-SearchSuccess 'Zielseite' $true
Assert-True ($ready.emitted.erreicht -eq $true -and $ready.emitted.ueberschrift -ceq 'Zielseite' -and
  $ready.waits.Count -eq 1 -and $ready.waits[0].h -eq 4242 -and
  $ready.waits[0].timeoutMs -eq 1800) 'Der Sucherfolg ist nicht frisch und begrenzt an die Zielseite gebunden.'

Write-Output 'goto-Suchtreffer: genaue Titelzellen und frische Zielpruefung nach Suchschluss - bestanden'

# Execute the productive wait together with the productive success block.
# A positive sample followed by a relayout must consume its original wait
# budget, never trigger more input or acquire a new unbudgeted readback.
$targetWait=@($gotoBody.FindAll({param($node)
  $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq 'WarteAufZielseite'
},$true))
Assert-True ($targetWait.Count -eq 1) 'Die begrenzte Zielpruefung fehlt.'
function Test-StableSearchSuccess([object[]]$Rounds,[int]$ExpectedReads,[bool]$ExpectedSuccess,
  [int]$Budget=0,[int]$SlowRead=-1,[int]$DelayMs=80) {
  $script:searchEmitted=$null;$script:searchFailure=$null
  $script:stableRound=-1;$script:stableReads=0;$script:stableSleeps=0;$script:stableBudget=0
  $script:stableClock=[pscustomobject]@{ElapsedMilliseconds=[long]0}
  $aktiviert=$true;$hwnd=[IntPtr]4242;$ziel='Zielseite';$pageId='';$nachSuche='Zielseite'
  $weg=@('Startseite');$suchWeg=New-Object System.Collections.ArrayList
  $null=$suchWeg.Add('Suchtreffer aktiviert')
  # Exercise the actual wait with a deterministic clock. Real compilation and
  # scheduler latency must not consume a synthetic provider's deadline.
  $clockSite='$sw = [Diagnostics.Stopwatch]::StartNew()'
  $waitSource=$targetWait[0].Extent.Text
  Assert-True ([regex]::Matches($waitSource,[regex]::Escape($clockSite)).Count -eq 1) 'Die produktive Wartezeit muss genau eine Uhr besitzen.'
  $waitSource=$waitSource.Replace($clockSite,'$sw = $script:stableClock').Replace('function WarteAufZielseite','function Invoke-ProductiveTargetWait')
  . ([scriptblock]::Create($waitSource))
  function WarteAufZielseite {
    param([IntPtr]$h,[int]$timeoutMs)
    $script:stableBudget=$timeoutMs
    Invoke-ProductiveTargetWait $h $(if ($Budget -gt 0) {$Budget} elseif ($ExpectedSuccess) {1000} else {20})
  }
  function AktuelleUeberschrift {
    param($h)
    $script:stableRound=[Math]::Min($script:stableRound+1,$Rounds.Count-1)
    $Rounds[$script:stableRound].heading
  }
  function IstZielseite {
    param($h,$heading)
    $script:stableReads++
    if($ExpectedSuccess -and $script:stableReads -gt $ExpectedReads){throw 'Unbudgeted readiness recheck after acceptance.'}
    if($script:stableReads -eq $SlowRead){$script:stableClock.ElapsedMilliseconds += $DelayMs}
    $Rounds[$script:stableRound].ready
  }
  function Start-Sleep {param($Milliseconds) $script:stableSleeps++;$script:stableClock.ElapsedMilliseconds += $Milliseconds}
  function Click-VerifiedPoint {throw 'Search close wait dispatched input.'}
  function DrueckeKnopf {throw 'Search close wait navigated.'}
  function Emit {param($result) $script:searchEmitted=$result;throw 'search-emitted'}
  function Fail {param($msg,$kind,$details) $script:searchFailure=[pscustomobject]@{kind=$kind;details=$details};throw 'search-failed'}
  try { . $activatedBlock } catch {
    Assert-True ($_.Exception.Message -in @('search-emitted','search-failed')) "Unexpected target wait: $($_.Exception.Message)"
  }
  Assert-True ($script:stableBudget -eq 1800) 'Suchschluss erhielt ein neues oder vergroessertes Wartebudget.'
  if($ExpectedSuccess){
    Assert-True ($script:searchEmitted.erreicht -eq $true -and $script:stableReads -eq $ExpectedReads -and
      $script:stableSleeps -eq $ExpectedReads-1) 'Instabile Zielbindung wurde angenommen oder nachgeprueft.'
  }else{
    Assert-True ($null -eq $script:searchEmitted -and $script:searchFailure.kind -ceq 'navigation-blocked' -and
      $script:searchFailure.details.weg.Count -gt 1) 'Fehlende Zielbindung erlaubte Erfolg oder verlor Diagnose.'
    if($ExpectedReads -gt 0){Assert-True ($script:stableReads -eq $ExpectedReads) 'Eine neue Zielpruefung startete nach Fristende.'}
  }
}
Test-StableSearchSuccess @(
  [pscustomobject]@{heading='Zielseite';ready=$true},
  [pscustomobject]@{heading='Zielseite';ready=$false},
  [pscustomobject]@{heading='Zielseite';ready=$true},
  [pscustomobject]@{heading='Zielseite';ready=$true}
) 4 $true
Test-StableSearchSuccess @(
  [pscustomobject]@{heading='Andere Seite';ready=$false},
  [pscustomobject]@{heading='Zielseite';ready=$true},
  [pscustomobject]@{heading='Zielseite';ready=$true}
) 3 $true
Test-StableSearchSuccess @(
  [pscustomobject]@{heading='Passender Titel A';ready=$true},
  [pscustomobject]@{heading='Passender Titel B';ready=$true},
  [pscustomobject]@{heading='Passender Titel B';ready=$true}
) 3 $true
Test-StableSearchSuccess @([pscustomobject]@{heading='Zielseite';ready=$false}) 0 $false
Test-StableSearchSuccess @([pscustomobject]@{heading='Andere Seite';ready=$false}) 0 $false
Test-StableSearchSuccess @([pscustomobject]@{heading='';ready=$false}) 0 $false
Test-StableSearchSuccess @([pscustomobject]@{heading='Zielseite';ready=$true}) 2 $true 500 2 600
Test-StableSearchSuccess @([pscustomobject]@{heading='Zielseite';ready=$true}) 1 $false 500 1 600
Write-Output 'goto-Suchschluss: produktive Zielpruefung uebersteht Relayout, ohne erneute Eingabe oder budgetlosen Readback.'
