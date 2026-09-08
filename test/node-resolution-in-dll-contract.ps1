# Die Knotenauswahl liegt in der DLL - und kehrt nicht heimlich zurueck.
#
# Resolve-Nodes war eine Kette aus Where-Object und einem Sort-Object mit zwei
# Skriptbloecken. Deren Uebersetzung kostete jeden Arbeitsprozess bei der
# ERSTEN Ausfuehrung rund 89 Millisekunden - und zwar fast unabhaengig von der
# Knotenzahl: gemessen 67 ms fuer zwei Knoten, 87 ms fuer 600. Fast jede
# Operation loest Knoten auf, und jeder Auftrag bekommt einen frischen Prozess,
# also fiel der Betrag jedes Mal an. In kompiliertem Code sind daraus 3 ms
# geworden.
#
# Einschraenkung, damit die Zahl nicht ueberliest: Rund 50 der 89 Millisekunden
# sind einmalige Prozesskosten, die sich PowerShell mit jeder anderen
# Sortierung und jeder anderen Schleife teilt - gemessen kostet derselbe Sort
# nach einer vorherigen Sortierung nur noch 22 ms, und ein Ersatz durch
# [Array]::Sort war mit 83 ms sogar langsamer, weil die Schluesselschleife
# ihrerseits uebersetzt werden muss. Der Auftragsgewinn ist also kleiner als
# die isolierte Zahl, solange irgendein anderer PowerShell-Schritt im selben
# Prozess dieselbe Maschinerie anwirft.
#
# Vier Eigenschaften duerfen dabei nie verlorengehen:
#
#   1. **Die Auswahl delegiert an die DLL.** Ein wieder eingefuehrtes
#      Sort-Object mit Skriptbloecken brächte die Uebersetzung zurueck.
#   2. **Kein fuehrendes Komma an der Rueckgabe.** Die Aufrufer schreiben
#      `@(Resolve-Nodes ...)`; `@()` ueber einem Funktionsaufruf sammelt
#      Pipeline-Ausgabe, eine mit Komma zurueckgegebene Sammlung bliebe EIN
#      Objekt. Genau umgekehrt zu den Umwandlungsfunktionen, deren Aufrufer
#      direkt zuweisen.
#   3. **PowerShell-Vergleichsregeln.** `-eq` und `-like` sind dort ohne
#      Ruecksicht auf Gross-/Kleinschreibung, ebenso der Hashtable-Zugriff auf
#      die Rangfolge. Eine Portierung mit Ordinalvergleich haette die Auswahl
#      still veraendert.
#   4. **Die AutomationId faellt vom genauen Treffer auf das Suffix zurueck.**
#      Ohne diesen zweiten Schritt findet kein einziger verkuerzter Bezeichner
#      mehr sein Feld.
$ErrorActionPreference = 'Stop'

$root = Split-Path $PSScriptRoot -Parent
$workerSource = Get-Content -LiteralPath (Join-Path $root 'powershell\sse-worker.ps1') -Raw

# --- 1. Delegation, kein Rueckfall in die Pipeline-Kette ---
$muster = [regex]::Match($workerSource, '(?ms)^function Resolve-Nodes \{.*?\n\}')
if (-not $muster.Success) { throw 'Resolve-Nodes ist nicht auffindbar.' }
$rumpf = $muster.Value
if ($rumpf -notmatch '\[SSEUiaTree\]::Resolve\(') {
  throw 'Resolve-Nodes delegiert nicht mehr an die DLL.'
}
if ($rumpf -match 'Sort-Object' -or $rumpf -match 'Where-Object') {
  throw 'Resolve-Nodes filtert oder sortiert wieder in PowerShell; die Uebersetzung waere zurueck.'
}
if ($rumpf -match '(?m)^\s*,\s*\[SSEUiaTree\]::Resolve') {
  throw 'Resolve-Nodes gibt mit fuehrendem Komma zurueck; @(Resolve-Nodes ...) ergaebe ein verschachteltes Array.'
}

# --- 2. Die Methode gehoert zur gepinnten Oberflaeche ---
foreach ($datei in @('powershell\build-native.ps1', 'powershell\load-native.ps1')) {
  $inhalt = Get-Content -LiteralPath (Join-Path $root $datei) -Raw
  if ($inhalt -notmatch "SSEUiaTree=@\([^)]*'Resolve'") {
    throw "Resolve fehlt in der gepinnten DLL-Oberflaeche von $datei."
  }
}

# --- 3. Verhalten gegen die gebaute Bibliothek ---
. (Join-Path $root 'powershell\load-native.ps1')
$null = Import-SSENativeInterop

function Neuer-Knoten([string]$rid, [string]$aid, [string]$name, [string]$type, [bool]$on) {
  $v = New-Object SSEUiaNodeView
  $v.rid = $rid; $v.aid = $aid; $v.name = $name; $v.type = $type; $v.on = $on
  $v
}

$knoten = [SSEUiaNodeView[]]@(
  (Neuer-Knoten 'r1' 'Form.Betrag'   'Betrag'      'Edit'     $true),
  (Neuer-Knoten 'r2' 'Form.Weiter'   'Weiter'      'Button'   $false),
  (Neuer-Knoten 'r3' 'Form.Zurueck'  'Zurueck'     'Button'   $true),
  (Neuer-Knoten 'r4' 'Andere.Betrag' 'Betrag'      'Text'     $true),
  (Neuer-Knoten 'r5' ''              'Ohne Kennung' 'CheckBox' $true))

function Ids($treffer) { (@($treffer | ForEach-Object { [string]$_.rid }) -join ',') }

# Gross-/Kleinschreibung bleibt gleichgueltig - wie -eq in PowerShell.
if ((Ids ([SSEUiaTree]::Resolve($knoten, '', '', 'BETRAG', 'Edit', $false))) -ne 'r1') {
  throw 'Namensvergleich achtet auf Gross-/Kleinschreibung.'
}
if ((Ids ([SSEUiaTree]::Resolve($knoten, 'R2', '', '', '', $false))) -ne 'r2') {
  throw 'RuntimeId-Vergleich achtet auf Gross-/Kleinschreibung.'
}
if ((Ids ([SSEUiaTree]::Resolve($knoten, '', '', '', 'BUTTON', $false))) -ne 'r3,r2') {
  throw 'Typvergleich oder Rangfolge stimmt nicht.'
}

# Genauer Treffer schlaegt Suffix; ohne genauen Treffer greift das Suffix.
if ((Ids ([SSEUiaTree]::Resolve($knoten, '', 'Form.Betrag', '', '', $false))) -ne 'r1') {
  throw 'Genauer AutomationId-Treffer wird nicht bevorzugt.'
}
if ((Ids ([SSEUiaTree]::Resolve($knoten, '', 'Betrag', '', '', $false))) -ne 'r4,r1') {
  throw 'Suffix-Rueckfall der AutomationId fehlt oder ordnet falsch.'
}

# Teilstring nur mit contains.
if ((Ids ([SSEUiaTree]::Resolve($knoten, '', '', 'etra', '', $false))) -ne '') {
  throw 'Namensvergleich trifft ohne contains einen Teilstring.'
}
if ((Ids ([SSEUiaTree]::Resolve($knoten, '', '', 'etra', '', $true))) -ne 'r4,r1') {
  throw 'contains findet den Teilstring nicht.'
}

# Rangfolge: bedienbare Typen zuerst, darin sichtbare vor unsichtbaren,
# bei Gleichstand die Baumreihenfolge.
if ((Ids ([SSEUiaTree]::Resolve($knoten, '', '', '', '', $false))) -ne 'r3,r2,r5,r4,r1') {
  throw 'Rangfolge oder Gleichstandsordnung stimmt nicht.'
}

Write-Output 'Knotenauswahl: Delegation, gepinnte Oberflaeche, PowerShell-Vergleichsregeln, Suffix-Rueckfall und Rangfolge geprueft'
