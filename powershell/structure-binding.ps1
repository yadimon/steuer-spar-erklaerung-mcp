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
    [string]$Name
  )
  if (-not $Name) { return $null }
  $baumEndung = 'NavWidgetSSE'
  $baum = Find-SSEContainerNode $Nodes $baumEndung 'Tree'
  if (-not $baum -or $baum.w -le 0 -or $baum.h -le 0) { return $null }
  $treffer = @(Get-SSEContainerDescendants $Nodes $baumEndung 'TreeItem' 'Tree' |
    Where-Object { [string]$_.name -ceq $Name })
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
Zelle, die diesen Text traegt. Kein oder mehr als ein Treffer liefert $null.
#>
function Select-SSESearchHit {
  param(
    [Parameter(Mandatory)][AllowEmptyCollection()]$Nodes,
    [string]$Target
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
  foreach ($knoten in @($Nodes)) {
    $index = [int]$knoten.i
    if ($index -eq [int]$tabelle.i -or -not $zelleVon.ContainsKey([int]$knoten.p)) { continue }
    $zelle = $(if ($titelZellen.ContainsKey($index)) { $titelZellen[$index] } else { $zelleVon[[int]$knoten.p] })
    $zelleVon[$index] = $zelle
    if ($zelle -and [string]$knoten.name -ceq $Target -and $knoten.type -in @('DataItem', 'Text', 'Hyperlink') -and
        -not ($treffer -contains $zelle)) {
      $null = $treffer.Add($zelle)
    }
  }
  if ($treffer.Count -ne 1) { return $null }
  $treffer[0]
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
