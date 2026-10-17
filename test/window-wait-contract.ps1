# Die Wartezeiten in `window_close` UND `window_restore` sind bedingt, begrenzt
# - und behalten ihr Beobachtungsfenster.
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
$closePath=Join-Path $root 'powershell\window-close.ps1'
$closeErrors=$null
$closeAst=[Management.Automation.Language.Parser]::ParseFile($closePath,[ref]$null,[ref]$closeErrors)
if($closeErrors.Count){throw 'Window-close helper cannot be parsed.'}
$closeFunctions=@($closeAst.FindAll({param($node)
  $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq 'Invoke-SSEWindowCloseTransaction'
},$true))
if($closeFunctions.Count -ne 1){throw 'Expected one production window-close helper.'}
$closeSource=$closeFunctions[0].Extent.Text.Replace("`r`n","`n")
$errors = $null
[void][Management.Automation.Language.Parser]::ParseFile($workerPath, [ref]$null, [ref]$errors)
if ($errors.Count) { throw "Worker-Parserfehler: $($errors[0].Message)" }

# 1. Frist bleibt Obergrenze, mit unveraenderten Grenzen.
if ($closeSource -notmatch [regex]::Escape("`$fristMs = [Math]::Min(10000, [Math]::Max(300, [int](Arg `$a 'waitMs' 800)))")) {
  throw 'Die Frist von window_close traegt nicht mehr dieselben Grenzen (300 ms bis 10 s, Vorgabe 800 ms).'
}
if ($closeSource -notmatch [regex]::Escape('$schliessUhr.ElapsedMilliseconds -lt $fristMs')) {
  throw 'Die Warteschleife von window_close ist nicht mehr durch die Frist begrenzt.'
}

# 2. Beobachtungsfenster: frueher Ausstieg erst ab 300 ms.
if ($closeSource -notmatch [regex]::Escape('if ($schliessUhr.ElapsedMilliseconds -ge 300 -and -not [SW]::IsWindow([IntPtr][int64]$hwndRaw)) { break }')) {
  throw 'Der vorzeitige Ausstieg aus window_close haengt nicht mehr an beidem: 300 ms Mindestbeobachtung UND verschwundenem Fenster.'
}

# 3. Der Befund wird nach der Schleife frisch gelesen.
if ($closeSource -notmatch [regex]::Escape('}
    $closed = -not [SW]::IsWindow([IntPtr][int64]$hwndRaw)')) {
  throw 'window_close liest `closed` nicht mehr unmittelbar nach der Warteschleife.'
}

# 4. Kein Rueckfall auf das pauschale Absitzen - in KEINER der beiden
#    Operationen. `window_restore` trug die feste Zeile bis beta.41 weiter;
#    seine Nachbedingung ist mit `IsIconic` ebenso beobachtbar wie die von
#    `window_close` mit `IsWindow`, also gilt dort dieselbe Behandlung.
$pauschal = [regex]::Escape("Start-Sleep -Milliseconds ([Math]::Min(10000, [Math]::Max(300, [int](Arg `$a 'waitMs' 800))))")
function Get-SSEOperationBlock([string]$Quelle, [string]$Operation, [string]$NaechsteOperation) {
  $start = $Quelle.IndexOf("  '$Operation' {")
  if ($start -lt 0) { throw "Der Block von $Operation ist nicht auffindbar." }
  $ende = $Quelle.IndexOf("  '$NaechsteOperation' {", $start)
  if ($ende -lt 0) { throw "Das Ende des $Operation-Blocks ist nicht auffindbar." }
  $Quelle.Substring($start, $ende - $start)
}
$restoreBlock=Get-SSEOperationBlock $workerSource 'window_restore' 'window_close'
$closeDispatcher=Get-SSEOperationBlock $workerSource 'window_close' 'result_details'
if($closeDispatcher -notmatch [regex]::Escape('Emit (Invoke-SSEWindowCloseTransaction $a)')) {throw 'Public window_close no longer uses the verified close helper.'}
if($restoreBlock -match $pauschal -or $closeSource -match $pauschal) {throw 'Window close/restore sits out its deadline unconditionally.'}

# 5. window_restore wartet auf seine eigene, beobachtbare Nachbedingung.
if ($workerSource -notmatch [regex]::Escape('$wiederherstellUhr.ElapsedMilliseconds -lt $fristMs')) {
  throw 'Die Warteschleife von window_restore ist nicht mehr durch die Frist begrenzt.'
}
if ($workerSource -notmatch [regex]::Escape('if ($wiederherstellUhr.ElapsedMilliseconds -ge 300 -and')) {
  throw 'Der vorzeitige Ausstieg aus window_restore haengt nicht mehr an der 300-ms-Mindestbeobachtung.'
}
if ($workerSource -notmatch [regex]::Escape('-not [SW]::IsIconic([IntPtr]$targetHwnd)) { break }')) {
  throw 'window_restore steigt nicht mehr am nachweislich wiederhergestellten Fenster vorzeitig aus.'
}

Write-Output 'Fensterwartezeiten (close und restore): bedingt, begrenzt, Beobachtungsfenster erhalten - bestanden'
