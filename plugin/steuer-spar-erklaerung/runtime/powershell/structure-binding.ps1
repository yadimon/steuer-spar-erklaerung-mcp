<#
Strukturelle Elementbindung ueber Containerzugehoerigkeit.

Bildschirmkoordinaten sind kein tragfaehiger Selektor: Fenstergroesse, DPI,
Schriftskalierung und verschobene Bereiche unterscheiden sich je Nutzer. Ein
Offset, der auf einem PC stimmt, zeigt auf einem anderen auf den falschen Text.

Engine 30 laesst die AutomationId einzelner Blattknoten weg, die Engine 31
noch beschriftet. Die Containerhierarchie ist jedoch in beiden Engines
identisch beschriftet. Deshalb wird ueber den Container gebunden und von dort
in den gewuenschten Kindtyp abgestiegen.

Die Funktionen sind rein: sie erhalten einen bereits gelesenen Knotenbestand
und greifen weder auf UIA noch auf Fenster zu.
#>

function Find-SSEContainerNode {
  param(
    [Parameter(Mandatory)][AllowEmptyCollection()]$Nodes,
    [Parameter(Mandatory)][string]$AidSuffix,
    [string]$ContainerType = ''
  )
  if (-not $AidSuffix) { return $null }
  # Mehrdeutigkeit ist ein Fehlerzustand: zwei passende Container heissen,
  # dass die Endung nicht mehr eindeutig bindet. Dann wird nichts geraten -
  # derselbe Grundsatz wie bei Get-SSENavigationSelectionFromNodes.
  #
  # ContainerType ist noetig, sobald Qt die Container-Id an die Eintraege
  # VERERBT: beim Steuerpruefer tragen die TreeItems dieselbe Id wie ihr
  # Tree. Nur der Typ trennt dann den Container von seinen Kindern.
  $treffer = New-Object System.Collections.ArrayList
  foreach ($knoten in @($Nodes)) {
    if ($ContainerType -and $knoten.type -cne $ContainerType) { continue }
    $aid = [string]$knoten.aid
    if ($aid -and $aid.EndsWith($AidSuffix, [StringComparison]::Ordinal)) { $null = $treffer.Add($knoten) }
  }
  if ($treffer.Count -ne 1) { return $null }
  $treffer[0]
}

<#
ALLE Nachfahren eines eindeutig gebundenen Containers mit dem verlangten
Steuerelementtyp, sortiert nach y, x. Leere Liste, wenn der Container fehlt,
mehrdeutig ist oder keine passenden Nachfahren traegt.

Der Filter laeuft ueber die TEILBAUM-Zugehoerigkeit, nie ueber die
AutomationId der Blaetter: Engine 30 laesst die Blatt-Ids weg (etwa bei den
Eintraegen des Steuerpruefers), waehrend der Container seine Id in beiden
Engines behaelt.
#>
function Get-SSEContainerDescendants {
  param(
    [Parameter(Mandatory)][AllowEmptyCollection()]$Nodes,
    [Parameter(Mandatory)][string]$AidSuffix,
    [Parameter(Mandatory)][string]$ChildType,
    [string]$ContainerType = ''
  )
  $container = Find-SSEContainerNode $Nodes $AidSuffix $ContainerType
  if (-not $container) { return @() }

  # Nachfahren sammeln. Der Baum liegt in Vorordnung vor, der Elternindex ist
  # immer kleiner als der Kindindex; ein Vorwaertslauf genuegt.
  $imTeilbaum = @{}
  $imTeilbaum[[int]$container.i] = $true
  $treffer = New-Object System.Collections.ArrayList
  foreach ($knoten in @($Nodes)) {
    $index = [int]$knoten.i
    if ($index -eq [int]$container.i) { continue }
    if (-not $imTeilbaum.ContainsKey([int]$knoten.p)) { continue }
    $imTeilbaum[$index] = $true
    if ($knoten.type -eq $ChildType) { $null = $treffer.Add($knoten) }
  }
  @($treffer | Sort-Object y, x)
}

function Get-SSEContainerChild {
  param(
    [Parameter(Mandatory)][AllowEmptyCollection()]$Nodes,
    [Parameter(Mandatory)][string]$AidSuffix,
    [Parameter(Mandatory)][string]$ChildType
  )
  $treffer = @(Get-SSEContainerDescendants $Nodes $AidSuffix $ChildType)
  if (-not $treffer.Count) { return $null }
  $treffer[0]
}

<#
Eintrag des linken Navigationsbaums, der exakt so heisst wie verlangt.

Gebunden wird wie beim Steuerpruefer ueber den Baum-Container: Engine 30 gibt
nur dem Tree eine AutomationId, Engine 31 vererbt sie zusaetzlich an die
Eintraege. Der Baum ist virtualisiert; geliefert wird nur ein eindeutiger,
aktiver Eintrag, dessen Zeile ganz im sichtbaren Baumausschnitt liegt. Eine
angeschnittene Randzeile oder eine Namensgleichheit liefert $null.
#>
function Get-SSEVisibleNavigationItem {
  param(
    [Parameter(Mandatory)][AllowEmptyCollection()]$Nodes,
    [string]$Name,
    [scriptblock]$Accept = $null
  )
  if (-not $Name) { return $null }
  $baumEndung = 'NavWidgetSSE'
  $baum = Find-SSEContainerNode $Nodes $baumEndung 'Tree'
  if (-not $baum -or $baum.w -le 0 -or $baum.h -le 0) { return $null }
  $treffer = @(Get-SSEContainerDescendants $Nodes $baumEndung 'TreeItem' 'Tree' |
    Where-Object { [string]$_.name -ceq $Name -or ($Accept -and [string]$_.name -and (& $Accept ([string]$_.name))) })
  if ($treffer.Count -ne 1) { return $null }
  $eintrag = $treffer[0]
  if (-not $eintrag.on -or $eintrag.w -le 0 -or $eintrag.h -le 0) { return $null }
  if ($eintrag.x -lt $baum.x -or $eintrag.y -lt $baum.y -or
      ($eintrag.y + $eintrag.h) -gt ($baum.y + $baum.h)) { return $null }
  $eintrag
}

<#
Trefferzelle der globalen Suche fuer eine Seitenueberschrift.

Die Ergebnistabelle hat zwei Spalten: links der Titel der Fundstelle, rechts
ihr Ort im Formular. Zaehlt nur die Titelspalte - die Pfadzelle nennt die
Seite eines Feldtreffers, und ein Doppelklick darauf oeffnet diese, nicht die
gesuchte Seite. Die Titelspalte ist je Zeile die linke Zelle, auch wenn sie
leer ist; sonst wuerde bei leerem Titel die Pfadzelle zum Titel.

Der Navigationsbaum ist kein Kandidat: Waehrend die Suche offen ist, steht er
verschoben im selben Fensterausschnitt, und sichtbare Baumziele klickt goto
vorher selbst. Suchecho und Formulartexte ausserhalb der Tabelle zaehlen
ebenso wenig.

Geliefert wird die eindeutige Titelzelle mit genau dieser Ueberschrift. Steht
der Titel nicht in der Zelle selbst, sondern in einem Text darin, zaehlt die
Zelle, die diesen Text traegt. Mehr als ein exakter Treffer liefert $null.

Ohne exakten Treffer entscheidet, falls angegeben, Accept ueber den Titel -
fuer Seitenobjekte, deren Ueberschrift ein Praefix oder eine nummerierte
Bezeichnung ist ('Sonstige Werbungskosten/Fahrten Eva' und '... Heinz' sind
dieselbe Seitenart). Jede solche Seite erfuellt das Seitenobjekt; geliefert
wird die erste passende Titelzelle in Tabellenreihenfolge. Auch hier zaehlt
nur die Titelspalte. Ohne Accept bleibt es beim exakten Titel.
#>
function Select-SSESearchHit {
  param(
    [Parameter(Mandatory)][AllowEmptyCollection()]$Nodes,
    [string]$Target,
    [scriptblock]$Accept = $null
  )
  if (-not $Target) { return $null }
  $tabelleEndung = 'DialogSearchResultsTableView'
  $tabelle = Find-SSEContainerNode $Nodes $tabelleEndung 'Table'
  if (-not $tabelle) { return $null }
  $titelZellen = @{}
  foreach ($zeile in @(Get-SSEContainerDescendants $Nodes $tabelleEndung 'DataItem' 'Table' | Group-Object y)) {
    $links = @($zeile.Group | Sort-Object x)[0]
    $titelZellen[[int]$links.i] = $links
  }
  # Nachfahren der Tabelle in Vorordnung; je Knoten die naechste Zelle darueber.
  $zelleVon = @{}
  $zelleVon[[int]$tabelle.i] = $null
  $treffer = New-Object System.Collections.ArrayList
  $passend = New-Object System.Collections.ArrayList
  foreach ($knoten in @($Nodes)) {
    $index = [int]$knoten.i
    if ($index -eq [int]$tabelle.i -or -not $zelleVon.ContainsKey([int]$knoten.p)) { continue }
    $zelle = $(if ($titelZellen.ContainsKey($index)) { $titelZellen[$index] } else { $zelleVon[[int]$knoten.p] })
    $zelleVon[$index] = $zelle
    if (-not $zelle -or $knoten.type -notin @('DataItem', 'Text', 'Hyperlink')) { continue }
    if ([string]$knoten.name -ceq $Target) {
      if (-not ($treffer -contains $zelle)) { $null = $treffer.Add($zelle) }
    } elseif ($Accept -and [string]$knoten.name -and -not ($passend -contains $zelle) -and (& $Accept ([string]$knoten.name))) {
      $null = $passend.Add($zelle)
    }
  }
  if ($treffer.Count -eq 1) { return $treffer[0] }
  if ($treffer.Count -eq 0 -and $passend.Count) { return $passend[0] }
  $null
}

# Pure layout evidence for a search title. Enabled Qt items can extend beyond
# their visible table; the rounded point used by Click-VerifiedPoint must also
# remain strictly inside both half-open rectangles.
function Get-SSESearchAncestor {
  param([AllowEmptyCollection()]$Nodes,$Node,[string]$AidSuffix,[string]$Type)
  $byIndex=@{}
  foreach($entry in @($Nodes)) {
    $index=[int]$entry.i
    if($byIndex.ContainsKey($index)){return $null}
    $byIndex[$index]=$entry
  }
  $seen=@{};$current=$Node
  for($depth=0;$depth -lt 32 -and $current;$depth++) {
    $index=[int]$current.i
    if($seen.ContainsKey($index)){return $null}
    $seen[$index]=$true
    if($current.type -ceq $Type -and ([string]$current.aid).EndsWith($AidSuffix,[StringComparison]::Ordinal)){return $current}
    $parent=[int]$current.p
    $current=$(if($parent -ge 0 -and $byIndex.ContainsKey($parent)){$byIndex[$parent]}else{$null})
  }
  $null
}

function Get-SSESearchHitTitle {
  param([AllowEmptyCollection()]$Nodes,$Hit,[string]$Target,[scriptblock]$Accept=$null)
  $inside=@{};$inside[[int]$Hit.i]=$true
  $accepted=New-Object 'Collections.Generic.HashSet[string]' ([StringComparer]::Ordinal)
  foreach($node in @($Nodes)) {
    if([int]$node.i -ne [int]$Hit.i) {
      if(-not $inside.ContainsKey([int]$node.p)){continue}
      $inside[[int]$node.i]=$true
    }
    if($node.type -cnotin @('DataItem','Text','Hyperlink')){continue}
    $name=[string]$node.name
    if($name -ceq $Target){return $name}
    if($Accept -and $name -and (& $Accept $name)){$null=$accepted.Add($name)}
  }
  if($accepted.Count -eq 1){return @($accepted)[0]}
  $null
}

function Get-SSESearchListLayout {
  param([AllowEmptyCollection()]$Nodes)
  $table=Find-SSEContainerNode $Nodes 'DialogSearchResultsTableView' 'Table'
  $queries=@($Nodes | Where-Object {
    $_.type -ceq 'Edit' -and ([string]$_.aid).EndsWith('.SearchFrameSSE.QWidget.SearchSSE.QLineEdit',[StringComparison]::Ordinal)
  })
  if(-not $table -or $queries.Count -ne 1){return $null}
  $query=$queries[0]
  foreach($node in @($table,$query)) {
    if(-not $node.on -or -not [string]$node.rid){return $null}
    foreach($key in @('x','y','w','h')) {
      try{$number=[double]$node.$key}catch{return $null}
      if([double]::IsNaN($number) -or [double]::IsInfinity($number) -or [Math]::Abs($number) -gt 1000000){return $null}
    }
    if($node.w -le 0 -or $node.h -le 0){return $null}
  }
  [pscustomobject]@{nodes=@($Nodes);table=$table;query=$query;hit=$null;title=$null;fullyVisible=$false}
}

function Get-SSESearchHitLayout {
  param([AllowEmptyCollection()]$Nodes,[string]$Target,[scriptblock]$Accept=$null)
  $list=Get-SSESearchListLayout $Nodes
  $hit=Select-SSESearchHit $Nodes $Target -Accept $Accept
  if(-not $list -or -not $hit -or -not $hit.on -or -not [string]$hit.rid){return $null}
  foreach($key in @('x','y','w','h')) {
    try{$number=[double]$hit.$key}catch{return $null}
    if([double]::IsNaN($number) -or [double]::IsInfinity($number) -or [Math]::Abs($number) -gt 1000000){return $null}
  }
  if($hit.w -le 0 -or $hit.h -le 0){return $null}
  $table=$list.table;$query=$list.query
  $title=Get-SSESearchHitTitle $Nodes $hit $Target -Accept $Accept
  if(-not $title){return $null}
  $pointX=[int]($hit.x+$hit.w/2);$pointY=[int]($hit.y+$hit.h/2)
  $fullyVisible=[bool]($hit.x -ge $table.x -and $hit.y -ge $table.y -and
    $hit.x+$hit.w -le $table.x+$table.w -and $hit.y+$hit.h -le $table.y+$table.h -and
    $pointX -ge $hit.x -and $pointX -lt $hit.x+$hit.w -and $pointY -ge $hit.y -and $pointY -lt $hit.y+$hit.h -and
    $pointX -ge $table.x -and $pointX -lt $table.x+$table.w -and $pointY -ge $table.y -and $pointY -lt $table.y+$table.h)
  [pscustomobject]@{nodes=@($Nodes);table=$table;hit=$hit;query=$query;title=$title;
    fullyVisible=$fullyVisible;pointX=$pointX;pointY=$pointY}
}

function Get-SSESearchExpansionButton {
  param($Layout)
  if(-not $Layout){return $null}
  $nodes=@($Layout.nodes)
  $buttons=@($nodes | Where-Object {
    $_.type -ceq 'Button' -and $_.name -ceq 'Trefferliste aus-/einklappen' -and
    ([string]$_.aid).EndsWith('.SearchSplitter.SearchFrameSSE.QWidget.HoverButton',[StringComparison]::Ordinal)
  })
  if($buttons.Count -ne 1){return $null}
  $button=$buttons[0]
  if(-not $button.on -or $button.w -le 0 -or $button.h -le 0 -or -not [string]$button.rid){return $null}
  $frameSuffix='.SearchSplitter.SearchFrameSSE'
  $tableFrame=Get-SSESearchAncestor $nodes $Layout.table $frameSuffix 'Group'
  $queryFrame=Get-SSESearchAncestor $nodes $Layout.query $frameSuffix 'Group'
  $buttonFrame=Get-SSESearchAncestor $nodes $button $frameSuffix 'Group'
  $parents=@($nodes | Where-Object {[int]$_.i -eq [int]$button.p})
  if(-not $tableFrame -or -not $queryFrame -or -not $buttonFrame -or $parents.Count -ne 1){return $null}
  # The two QWidget groups can share an AutomationId. Only their exact parent
  # indices prove that this button and the table belong to the same frame.
  $parent=$parents[0]
  if($tableFrame.i -ne $queryFrame.i -or $tableFrame.i -ne $buttonFrame.i -or
    $parent.type -cne 'Group' -or [int]$parent.p -ne [int]$tableFrame.i -or
    $parent.aid -cne ([string]$tableFrame.aid+'.QWidget')){return $null}
  $button
}

<#
Name des ausgewaehlten Navigationsknotens.

Unabhaengige Gegenprobe zur Seitenueberschrift; auf Hauptseiten stimmen beide
ueberein. Bei keiner oder mehrdeutiger Auswahl wird $null geliefert - die
Auswahl ist eine Zusatzangabe und darf nie geraten werden.
#>
function Get-SSENavigationSelectionFromNodes {
  param([Parameter(Mandatory)][AllowEmptyCollection()]$Nodes)
  $gewaehlt = @(@($Nodes) | Where-Object { $_.type -eq 'TreeItem' -and $_.selected -eq $true })
  if ($gewaehlt.Count -ne 1) { return $null }
  [string]$gewaehlt[0].name
}
