# Ein veralteter Rueckfallweg meldet sich - in jedem Ergebnis und im Protokoll.
#
# `goto_tree` ist der aeltere Navigationsweg ueber den Baum. Er bleibt
# erhalten, weil er traegt, wenn das fokusfreie `goto` eine Seite nicht
# erreicht. Genau darin liegt die Gefahr: Ein Rueckfallweg, der stillschweigend
# funktioniert, wird unbemerkt zum Normalweg.
#
# Drei Eigenschaften duerfen nie verlorengehen:
#
#   1. **Der Weg setzt seine Markierung.** Ohne sie ist er nicht von einem
#      regulaeren Weg zu unterscheiden.
#   2. **Emit traegt sie in JEDES Ergebnis.** Die Markierung sitzt bewusst
#      dort und nicht an den einzelnen Ausgabestellen - `goto_tree` hat fuenf,
#      und ein `Fail` nimmt noch einen anderen Weg. Nur in Emit kann keiner
#      von ihnen sie umgehen.
#   3. **Sie erscheint auch auf der Fehlerausgabe.** Ein Ergebnisfeld sieht
#      nur, wer das Ergebnis liest; ein Protokoll, das den Prozess mitschreibt,
#      sieht nur stderr.
$ErrorActionPreference = 'Stop'

$root = Split-Path $PSScriptRoot -Parent
$workerPath = Join-Path $root 'powershell\sse-worker.ps1'
$workerSource = Get-Content -LiteralPath $workerPath -Raw
$errors = $null
[void][Management.Automation.Language.Parser]::ParseFile($workerPath, [ref]$null, [ref]$errors)
if ($errors.Count) { throw "Worker-Parserfehler: $($errors[0].Message)" }

# 1. goto_tree setzt die Markierung, und zwar mit Begruendung und Alternative.
$blockStart = $workerSource.IndexOf("  'goto_tree' {")
if ($blockStart -lt 0) { throw 'Der Block von goto_tree ist nicht auffindbar.' }
$blockEnde = $workerSource.IndexOf("`n  'help' {", $blockStart)
if ($blockEnde -lt 0) { throw 'Das Ende des goto_tree-Blocks ist nicht auffindbar.' }
$block = $workerSource.Substring($blockStart, $blockEnde - $blockStart)
foreach ($teil in @('$script:SSE_DEPRECATED_FALLBACK', "operation = 'goto_tree'", 'reason =', "preferred = 'goto'")) {
  if (-not $block.Contains($teil)) {
    throw "goto_tree setzt seine Rueckfallmarkierung nicht mehr vollstaendig ('$teil' fehlt)."
  }
}

# 2. Emit traegt sie in jedes Ergebnis - vor der Serialisierung.
$emitStart = $workerSource.IndexOf('function Emit')
if ($emitStart -lt 0) { throw 'Emit ist nicht auffindbar.' }
$emitEnde = $workerSource.IndexOf('function Fail', $emitStart)
if ($emitEnde -lt 0) { throw 'Das Ende von Emit ist nicht auffindbar.' }
$emit = $workerSource.Substring($emitStart, $emitEnde - $emitStart)
if (-not $emit.Contains('if ($script:SSE_DEPRECATED_FALLBACK)')) {
  throw 'Emit prueft die Rueckfallmarkierung nicht mehr; einzelne Ausgabestellen koennten sie umgehen.'
}
if (-not $emit.Contains('-NotePropertyName deprecatedFallback')) {
  throw 'Emit legt das Feld deprecatedFallback nicht mehr an.'
}
$markierung = $emit.IndexOf('if ($script:SSE_DEPRECATED_FALLBACK)')
$serialisierung = $emit.IndexOf('ConvertTo-Json -Depth 24')
if ($serialisierung -lt 0) { throw 'Die Ergebnisserialisierung in Emit ist nicht auffindbar.' }
if ($markierung -gt $serialisierung) {
  throw 'Die Rueckfallmarkierung wird erst nach der Serialisierung gesetzt und landet damit nicht im Ergebnis.'
}

# 3. Sie erscheint auch auf der Fehlerausgabe.
if (-not $emit.Contains('[Console]::Error.WriteLine(')) {
  throw 'Emit meldet den Rueckfallweg nicht mehr auf der Fehlerausgabe.'
}
if (-not $emit.Contains('SSE-WARNUNG: veralteter Rueckfallweg')) {
  throw 'Die Warnzeile des Rueckfallwegs ist nicht mehr eindeutig als solche erkennbar.'
}

# 4. Kein regulaerer Weg setzt die Markierung - sonst verliert sie ihre Aussage.
$treffer = [regex]::Matches($workerSource, [regex]::Escape('$script:SSE_DEPRECATED_FALLBACK ='))
if ($treffer.Count -ne 1) {
  throw "Die Rueckfallmarkierung wird an $($treffer.Count) Stellen gesetzt; genau eine ist vorgesehen."
}

Write-Output 'Veralteter Rueckfallweg: markiert, in jedem Ergebnis und im Protokoll - bestanden'
