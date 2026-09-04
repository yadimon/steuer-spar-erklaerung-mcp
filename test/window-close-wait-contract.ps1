# Die Wartezeit in `window_close` ist bedingt, begrenzt - und behaelt ihr
# Beobachtungsfenster.
#
# `waitMs` ist als "Wartezeit auf das Schliessen" zugesagt, also als
# Obergrenze. Die Umsetzung sass sie frueher pauschal ab; gemessen kostete das
# in der grossen Reise rund zwei Sekunden je Aufruf, obwohl das Fenster
# laengst zu war.
#
# Drei Eigenschaften duerfen dabei nie verlorengehen:
#
#   1. **Die Obergrenze.** Ohne sie kann ein haengendes Fenster beliebig lange
#      blockieren; mit ihr ist der Schritt nie langsamer als vorher.
#   2. **Die Untergrenze von 300 ms.** Die Nachbedingung prueft nicht nur, ob
#      das Ziel verschwand, sondern auch, dass daraus kein neues Fenster und
#      kein Dialog entstand. Wer sofort zurueckkehrt, sobald das Fenster weg
#      ist, verkuerzt genau dieses Beobachtungsfenster und macht die Pruefung
#      blind.
#   3. **Die Pruefung NACH der Schleife.** `closed` muss weiterhin frisch
#      gelesen werden, nicht aus dem Schleifenabbruch geschlossen werden.
$ErrorActionPreference = 'Stop'

$root = Split-Path $PSScriptRoot -Parent
$workerPath = Join-Path $root 'powershell\sse-worker.ps1'
$workerSource = Get-Content -LiteralPath $workerPath -Raw
$errors = $null
[void][Management.Automation.Language.Parser]::ParseFile($workerPath, [ref]$null, [ref]$errors)
if ($errors.Count) { throw "Worker-Parserfehler: $($errors[0].Message)" }

# 1. Frist bleibt Obergrenze, mit unveraenderten Grenzen.
if ($workerSource -notmatch [regex]::Escape("`$fristMs = [Math]::Min(10000, [Math]::Max(300, [int](Arg `$a 'waitMs' 800)))")) {
  throw 'Die Frist von window_close traegt nicht mehr dieselben Grenzen (300 ms bis 10 s, Vorgabe 800 ms).'
}
if ($workerSource -notmatch [regex]::Escape('$schliessUhr.ElapsedMilliseconds -lt $fristMs')) {
  throw 'Die Warteschleife von window_close ist nicht mehr durch die Frist begrenzt.'
}

# 2. Beobachtungsfenster: frueher Ausstieg erst ab 300 ms.
if ($workerSource -notmatch [regex]::Escape('if ($schliessUhr.ElapsedMilliseconds -ge 300 -and -not [SW]::IsWindow([IntPtr][int64]$hwndRaw)) { break }')) {
  throw 'Der vorzeitige Ausstieg aus window_close haengt nicht mehr an beidem: 300 ms Mindestbeobachtung UND verschwundenem Fenster.'
}

# 3. Der Befund wird nach der Schleife frisch gelesen.
if ($workerSource -notmatch [regex]::Escape('}
    $closed = -not [SW]::IsWindow([IntPtr][int64]$hwndRaw)')) {
  throw 'window_close liest `closed` nicht mehr unmittelbar nach der Warteschleife.'
}

# 4. Kein Rueckfall auf das pauschale Absitzen - geprueft NUR im Block von
#    window_close. `window_restore` traegt dieselbe Zeile absichtlich weiter;
#    ihre Bedingung ist eine andere und wurde nicht mitgemessen.
$blockStart = $workerSource.IndexOf("  'window_close' {")
if ($blockStart -lt 0) { throw 'Der Block von window_close ist nicht auffindbar.' }
$blockEnde = $workerSource.IndexOf("  'result_details' {", $blockStart)
if ($blockEnde -lt 0) { throw 'Das Ende des window_close-Blocks ist nicht auffindbar.' }
$block = $workerSource.Substring($blockStart, $blockEnde - $blockStart)
if ($block -match [regex]::Escape("Start-Sleep -Milliseconds ([Math]::Min(10000, [Math]::Max(300, [int](Arg `$a 'waitMs' 800))))")) {
  throw 'window_close sitzt die Frist wieder pauschal ab.'
}

Write-Output 'window_close-Wartezeit: bedingt, begrenzt, Beobachtungsfenster erhalten - bestanden'
