<#
Reine Fenster- und Kopfzeilenbindung fuer bereits gelesene Knotenbestaende.

Die Funktionen enthalten absichtlich keine UIA-/Fensterzugriffe. Der Worker
liefert ihnen den Knotenbestand aus Walk-Tree; dadurch laesst sich derselbe
Vertrag mit synthetischen Baeumen testen, ohne eine Steuerdatei oder die
laufende SteuerSparErklaerung zu beruehren.

Hintergrund: UIA haengt ein BESESSENES Fenster als Kind an sein
Besitzerfenster. Ein Baumlauf ab dem Hauptfenster liefert deshalb auch den
kompletten Teilbaum nicht-modaler Fenster wie der Werte-Info. Deren Header-
und DataItem-Knoten liegen geometrisch mitten im Inhaltsbereich und sind
allein ueber X/Y nicht von der Seite zu trennen.
#>

<#
Trennt den Knotenbestand in den EIGENEN Inhalt des gebundenen Fensters und
die Teilbaeume fremder Fenster.

Get-UiSnapshot laeuft in Tiefensuche/Vorordnung; der Elternindex ist immer
kleiner als der Kindindex. Ein einziger Vorwaertslauf reicht deshalb aus, um
einen fremden Fensterknoten samt aller Nachfahren zu markieren.

Das gebundene Fenster selbst ist die Wurzel und taucht im Bestand normalerweise
nicht auf. Liefert ein Baumlauf es doch mit, schuetzt -KeepRid es davor, als
fremd behandelt zu werden.
#>
function Split-SSEWindowScope {
  param(
    [Parameter(Mandatory)][AllowEmptyCollection()]$Nodes,
    [string]$KeepRid = ''
  )

  # Index -> Index der Fremdfenster-Wurzel, zu der dieser Knoten gehoert.
  # Bewusst eine Hashtable: eine [ordered]-Dictionary wuerde einen ganzzahligen
  # Schluessel als POSITION statt als Schluessel lesen.
  $wurzelVon = @{}
  $fremdWurzeln = @{}
  $reihenfolge = New-Object System.Collections.ArrayList
  $eigene = New-Object System.Collections.ArrayList

  foreach ($knoten in @($Nodes)) {
    $index = [int]$knoten.i
    $elternIndex = [int]$knoten.p
    $elternFremd = $wurzelVon.ContainsKey($elternIndex)
    $istFremdesFenster = ($knoten.type -eq 'Window') -and
                         (-not $KeepRid -or [string]$knoten.rid -ne $KeepRid)

    if (-not $elternFremd -and -not $istFremdesFenster) {
      $null = $eigene.Add($knoten)
      continue
    }

    if ($elternFremd) {
      $wurzelIndex = [int]$wurzelVon[$elternIndex]
    } else {
      $wurzelIndex = $index
      $fremdWurzeln[$wurzelIndex] = [pscustomobject]@{
        rid = [string]$knoten.rid
        name = [string]$knoten.name
        aid = [string]$knoten.aid
        x = [int]$knoten.x; y = [int]$knoten.y
        w = [int]$knoten.w; h = [int]$knoten.h
        nodeCount = 0
      }
      $null = $reihenfolge.Add($wurzelIndex)
    }
    $wurzelVon[$index] = $wurzelIndex
    $fremdWurzeln[$wurzelIndex].nodeCount = [int]$fremdWurzeln[$wurzelIndex].nodeCount + 1
  }

  [pscustomobject]@{
    own = @($eigene)
    foreign = @($reihenfolge | ForEach-Object { $fremdWurzeln[$_] })
  }
}

