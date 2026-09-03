# Die Antwort auf die Wiederherstellungsfrage haengt an einer einzigen reinen
# Entscheidung: entweder eine exakt gebundene regulaere Falldatei oder ein
# bewiesener Start ohne Falldatei. 'Ja' bleibt immer gesperrt; jede halbe
# Bindung und jede Mischung der beiden Wege muss deterministisch scheitern.
$ErrorActionPreference = 'Stop'

$root = Split-Path $PSScriptRoot -Parent
$workerPath = Join-Path $root 'powershell\sse-worker.ps1'
$tokens = $null
$errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($workerPath, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw "Worker-Parserfehler: $($errors[0].Message)" }

$definition = @($ast.FindAll({
  param($node)
  $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Resolve-SSERecoveryAnswerPolicy'
}, $true))
if ($definition.Count -ne 1) { throw 'Funktion Resolve-SSERecoveryAnswerPolicy ist nicht eindeutig vorhanden.' }
Invoke-Expression $definition[0].Extent.Text

function Assert-Equal($Actual, $Expected, [string]$Message) {
  if ("$Actual" -cne "$Expected") { throw "$Message - erwartet '$Expected', erhalten '$Actual'" }
}

$hash = 'A' * 64
$casePath = 'C:\faelle\fall.Gew2025'

# 1 Kein Recovery-Dialog: neutral, aber das Flag ist dort verboten.
$r = Resolve-SSERecoveryAnswerPolicy $false 'OK' '' '' $false ''
Assert-Equal $r.mode 'not-recovery' 'Nicht-Recovery Modus'
Assert-Equal $r.ok $true 'Nicht-Recovery ok'
$r = Resolve-SSERecoveryAnswerPolicy $false 'OK' '' '' $true ''
Assert-Equal $r.ok $false 'Flag ausserhalb Recovery ok'
Assert-Equal $r.kind 'bad-args' 'Flag ausserhalb Recovery kind'

# 2 Recovery + Ja bleibt gesperrt, auch mit Flag oder Bindung.
$r = Resolve-SSERecoveryAnswerPolicy $true 'Ja' '' '' $true ''
Assert-Equal $r.ok $false 'Ja mit Flag ok'
Assert-Equal $r.kind 'blocked' 'Ja mit Flag kind'
$r = Resolve-SSERecoveryAnswerPolicy $true 'Ja' $casePath $hash $false $casePath
Assert-Equal $r.ok $false 'Ja mit Bindung ok'
Assert-Equal $r.kind 'blocked' 'Ja mit Bindung kind'

# 3 Recovery + Nein ohne Bindung und ohne Flag: bad-args, Text nennt beide Wege.
$r = Resolve-SSERecoveryAnswerPolicy $true 'Nein' '' '' $false ''
Assert-Equal $r.ok $false 'Nein ohne Bindung ok'
Assert-Equal $r.kind 'bad-args' 'Nein ohne Bindung kind'
if ($r.error -notmatch 'expectedCaseRef' -or $r.error -notmatch 'discardUnsavedRecovery') {
  throw "Fehlertext nennt nicht beide Wege: $($r.error)"
}

# 4 Dateigebunden: unveraendert der klassische Weg.
$r = Resolve-SSERecoveryAnswerPolicy $true 'Nein' $casePath $hash $false $casePath
Assert-Equal $r.mode 'file-bound' 'Dateigebunden Modus'
Assert-Equal $r.ok $true 'Dateigebunden ok'

# 5 Unvollstaendige Bindung bleibt bad-args (nur Hash, nur Pfad, Hash falsch geformt).
$r = Resolve-SSERecoveryAnswerPolicy $true 'Nein' '' $hash $false ''
Assert-Equal $r.kind 'bad-args' 'Nur Hash kind'
$r = Resolve-SSERecoveryAnswerPolicy $true 'Nein' $casePath '' $false $casePath
Assert-Equal $r.kind 'bad-args' 'Nur Pfad kind'
$r = Resolve-SSERecoveryAnswerPolicy $true 'Nein' $casePath 'abc' $false $casePath
Assert-Equal $r.kind 'bad-args' 'Kurzer Hash kind'

# 6 Flag zusammen mit Ref oder Hash: bad-args, nie file-less.
$r = Resolve-SSERecoveryAnswerPolicy $true 'Nein' $casePath $hash $true ''
Assert-Equal $r.ok $false 'Flag+Bindung ok'
Assert-Equal $r.kind 'bad-args' 'Flag+Bindung kind'
$r = Resolve-SSERecoveryAnswerPolicy $true 'Nein' '' $hash $true ''
Assert-Equal $r.kind 'bad-args' 'Flag+Hash kind'

# 7 Flag, aber der Prozess wurde mit einer Falldatei gestartet: case-mismatch.
$r = Resolve-SSERecoveryAnswerPolicy $true 'Nein' '' '' $true $casePath
Assert-Equal $r.ok $false 'Flag mit Dateistart ok'
Assert-Equal $r.kind 'case-mismatch' 'Flag mit Dateistart kind'

# 8 Flag und nachweislich dateiloser Start: file-less.
$r = Resolve-SSERecoveryAnswerPolicy $true 'Nein' '' '' $true ''
Assert-Equal $r.mode 'file-less' 'File-less Modus'
Assert-Equal $r.ok $true 'File-less ok'
Assert-Equal $r.kind '' 'File-less kind leer'

Write-Output 'Recovery-Antwort-Policy: dateigebunden, dateilos und alle Verbote bestanden.'
