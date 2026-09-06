# Die beiden Umwandlungen werden beim Vorwaermen uebersetzt - und dabei wird
# das Produkt nicht angefasst.
#
# PowerShell uebersetzt den Rumpf einer Schleife erst bei ihrer ERSTEN
# Ausfuehrung. Gemessen kostet das im frischen Arbeiter 41 ms fuer die
# Knotenumwandlung und 19 ms fuer die Fensterumwandlung, und jeder Arbeiter
# zahlt beides mindestens einmal. Der Warmlauf im Prewarm zieht das vor.
#
# Vier Eigenschaften duerfen dabei nie verlorengehen:
#
#   1. **Beide Umwandlungen sind eigene Funktionen.** Als Schleife im Rumpf
#      ihres Aufrufers liessen sie sich nicht getrennt vorwaermen.
#   2. **Der Warmlauf steht VOR der Bereitschaftsmeldung.** Danach waere er
#      wirkungslos: Der Arbeiter hat seinen Auftrag dann schon.
#   3. **Er stellt KEINE UIA-Abfrage.** Ein wartender Reservearbeiter darf das
#      nicht - eine vergiftete UIA-Verbindung wuerde an den Auftrag
#      weitergereicht. Die Knoten und Fensterbeschreibungen entstehen deshalb
#      im Speicher.
#   4. **Der Elementzwischenspeicher wird danach geleert.** Get-LiveElement
#      erkennt einen Treffer allein am Schluessel und gaebe sonst ein
#      synthetisches null als lebendes Element zurueck.
#
# Zusaetzlich bewacht dieser Vertrag die Aufrufstelle von
# ConvertTo-SSEWindowDescriptors. `@(funktionsaufruf)` sammelt Pipeline-Ausgabe
# und loest eine mit fuehrendem Komma zurueckgegebene Liste NICHT auf; das
# Ergebnis waere ein Array mit der Liste als einzigem Element. Genau daran ist
# die erste Fassung gescheitert - unbemerkt, weil bei genau einem Fenster die
# Membersuche den Unterschied verdeckt.
$ErrorActionPreference = 'Stop'

$root = Split-Path $PSScriptRoot -Parent
$workerPath = Join-Path $root 'powershell\sse-worker.ps1'
$workerSource = Get-Content -LiteralPath $workerPath -Raw
$errors = $null
[void][Management.Automation.Language.Parser]::ParseFile($workerPath, [ref]$null, [ref]$errors)
if ($errors.Count) { throw "Worker-Parserfehler: $($errors[0].Message)" }

# 1. Beide Umwandlungen sind eigene Funktionen.
foreach ($name in @('ConvertTo-SSESnapshotNodes', 'ConvertTo-SSEWindowDescriptors')) {
  if ($workerSource -notmatch [regex]::Escape("function $name(")) {
    throw "Die Umwandlung '$name' ist keine eigene Funktion mehr und laesst sich damit nicht vorwaermen."
  }
}

# 2. Der Warmlauf steht vor der Bereitschaftsmeldung.
$bereit = $workerSource.IndexOf("prewarm='ready'")
if ($bereit -lt 0) { throw 'Die Bereitschaftsmeldung des Reservearbeiters ist nicht auffindbar.' }
foreach ($aufruf in @(
  '$null = ConvertTo-SSESnapshotNodes $warmupNodes.ToArray()',
  '$null = ConvertTo-SSEWindowDescriptors $warmupWindows.ToArray()'
)) {
  $stelle = $workerSource.IndexOf($aufruf)
  if ($stelle -lt 0) { throw "Der Warmlauf '$aufruf' fehlt." }
  if ($stelle -gt $bereit) { throw "Der Warmlauf '$aufruf' steht hinter der Bereitschaftsmeldung und ist wirkungslos." }
}

# 3. Der Warmlaufblock stellt keine UIA-Abfrage.
$blockStart = $workerSource.IndexOf('$warmupNodes = New-Object')
if ($blockStart -lt 0) { throw 'Der Warmlaufblock ist nicht auffindbar.' }
$blockEnde = $workerSource.IndexOf('$null = ConvertTo-SSEWindowDescriptors $warmupWindows.ToArray()', $blockStart)
if ($blockEnde -lt 0) { throw 'Das Ende des Warmlaufblocks ist nicht auffindbar.' }
$block = $workerSource.Substring($blockStart, $blockEnde - $blockStart)
# Kommentarzeilen zaehlen nicht: Sie duerfen die verbotenen Namen nennen, um zu
# erklaeren, warum sie hier nichts zu suchen haben. Genau daran ist
# `test/product-gate.mjs` schon einmal falsch angeschlagen.
$blockOhneKommentare = (
  $block -split "`n" | Where-Object { -not $_.TrimStart().StartsWith('#') }
) -join "`n"
foreach ($verboten in @('$AE::', 'FromHandle', '[SSEUiaTree]::', '[SSEWindowEnumerator]::', 'Get-Windows', 'Get-Process')) {
  if ($blockOhneKommentare.Contains($verboten)) {
    throw "Der Warmlauf des Reservearbeiters greift mit '$verboten' auf das Produkt zu; er darf nur im Speicher arbeiten."
  }
}

# 4. Der Elementzwischenspeicher wird nach dem Warmlauf geleert.
$leeren = $workerSource.IndexOf('$script:UIAElementCache.Clear()')
if ($leeren -lt 0) { throw 'Der Elementzwischenspeicher wird nach dem Warmlauf nicht geleert.' }
if ($leeren -lt $blockStart -or $leeren -gt $bereit) {
  throw 'Das Leeren des Elementzwischenspeichers liegt nicht zwischen Warmlauf und Bereitschaftsmeldung.'
}

# 5. Die Aufrufstelle weist zu, bevor sie @() bildet.
if ($workerSource -match [regex]::Escape('@(ConvertTo-SSEWindowDescriptors (')) {
  throw '@(funktionsaufruf) loest die zurueckgegebene Liste nicht auf; erst zuweisen, dann @() darum.'
}
if ($workerSource -notmatch [regex]::Escape('$beschrieben = ConvertTo-SSEWindowDescriptors ([SSEWindowEnumerator]::Describe($ids))')) {
  throw 'Get-Windows weist das Ergebnis der Fensterumwandlung nicht mehr zu, bevor es @() bildet.'
}

Write-Output 'Prewarm-Umwandlungen: eigene Funktionen, vor der Bereitschaft, ohne Produktzugriff, Cache geleert - bestanden'
