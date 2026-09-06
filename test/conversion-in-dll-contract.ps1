# Beide Umwandlungen liegen in der DLL - und keine kehrt heimlich zurueck.
#
# Knoten- und Fensterumwandlung liefen frueher als PowerShell-Schleifen. Deren
# Rumpf musste jeder Arbeitsprozess bei seiner ERSTEN Ausfuehrung uebersetzen:
# gemessen 41 ms fuer die Knoten und 19 ms fuer die Fenster, und jeder Arbeiter
# macht mindestens einen Baumlauf und einen Fensterlauf. In kompiliertem Code
# entfaellt das ersatzlos.
#
# Vier Eigenschaften duerfen dabei nie verlorengehen:
#
#   1. **Beide Umwandlungen delegieren an die DLL.** Eine wieder eingefuehrte
#      PowerShell-Schleife brächte die Uebersetzung zurueck.
#   2. **Der Elementzwischenspeicher wird DRUEBEN gefuellt.** Bliebe das
#      Fuellen hier, bliebe auch die Schleife - genau das war der Grund, ihn
#      als Parameter zu uebergeben.
#   3. **Die Aufrufstelle weist zu, bevor sie `@()` bildet.** `@(aufruf)`
#      sammelt Pipeline-Ausgabe und loest eine mit fuehrendem Komma
#      zurueckgegebene Sammlung NICHT auf; ueber einer Variablen schon. Genau
#      daran ist die erste Fassung gescheitert - unbemerkt, weil bei genau
#      einem Fenster die Membersuche den Unterschied verdeckt.
#   4. **Die Sichtklassen tragen kein lebendes Element.** Die Umwandlung ist
#      auch eine Reinigung: Ein AutomationElement darf weder in ein
#      Ergebnis-JSON geraten noch von einem spaeteren Aufrufer festgehalten
#      werden.
$ErrorActionPreference = 'Stop'

$root = Split-Path $PSScriptRoot -Parent
$workerPath = Join-Path $root 'powershell\sse-worker.ps1'
$nativePath = Join-Path $root 'powershell\sse-native.cs'
$workerSource = Get-Content -LiteralPath $workerPath -Raw
$nativeSource = Get-Content -LiteralPath $nativePath -Raw
$errors = $null
[void][Management.Automation.Language.Parser]::ParseFile($workerPath, [ref]$null, [ref]$errors)
if ($errors.Count) { throw "Worker-Parserfehler: $($errors[0].Message)" }

# 1. Beide Umwandlungen delegieren an die DLL.
if ($workerSource -notmatch [regex]::Escape(',[SSEUiaTree]::ToViews($NativeNodes, $script:UIAElementCache)')) {
  throw 'Die Knotenumwandlung delegiert nicht mehr an die DLL; eine PowerShell-Schleife braechte die Uebersetzung zurueck.'
}
if ($workerSource -notmatch [regex]::Escape(',[SSEWindowEnumerator]::ToViews($Described)')) {
  throw 'Die Fensterumwandlung delegiert nicht mehr an die DLL.'
}

# 2. Die DLL fuellt den Elementzwischenspeicher; PowerShell tut es nicht erneut.
if ($nativeSource -notmatch [regex]::Escape('public static SSEUiaNodeView[] ToViews(SSEUiaNode[] nodes, Hashtable elementCache)')) {
  throw 'ToViews nimmt den Elementzwischenspeicher nicht mehr entgegen; das Fuellen fiele nach PowerShell zurueck.'
}
if ($nativeSource -notmatch [regex]::Escape('elementCache[node.RuntimeId] = node.Element')) {
  throw 'ToViews fuellt den Elementzwischenspeicher nicht mehr.'
}
if ($workerSource -match [regex]::Escape('$script:UIAElementCache[$node.RuntimeId]')) {
  throw 'Der Elementzwischenspeicher wird wieder in PowerShell gefuellt; damit kehrt die Schleife zurueck.'
}

# 3. Die Aufrufstelle weist zu, bevor sie @() bildet.
foreach ($falsch in @('@(ConvertTo-SSEWindowDescriptors (', '@(ConvertTo-SSESnapshotNodes (')) {
  if ($workerSource.Contains($falsch)) {
    throw '@(funktionsaufruf) loest die zurueckgegebene Sammlung nicht auf; erst zuweisen, dann @() darum.'
  }
}
if ($workerSource -notmatch [regex]::Escape('$beschrieben = ConvertTo-SSEWindowDescriptors ([SSEWindowEnumerator]::Describe($ids))')) {
  throw 'Get-Windows weist das Ergebnis der Fensterumwandlung nicht mehr zu, bevor es @() bildet.'
}

# 4. Keine Sichtklasse traegt ein lebendes Element.
$sichtStart = $nativeSource.IndexOf('public sealed class SSEUiaNodeView {')
if ($sichtStart -lt 0) { throw 'SSEUiaNodeView ist nicht auffindbar.' }
$sichtEnde = $nativeSource.IndexOf('}', $sichtStart)
$sicht = $nativeSource.Substring($sichtStart, $sichtEnde - $sichtStart)
if ($sicht -match 'AutomationElement' -or $sicht -match '\bElement\b') {
  throw 'SSEUiaNodeView traegt ein lebendes Element; die Umwandlung ist auch eine Reinigung.'
}

Write-Output 'Umwandlungen: in der DLL, Cache dort gefuellt, Aufrufstelle korrekt, Sicht ohne lebendes Element - bestanden'
