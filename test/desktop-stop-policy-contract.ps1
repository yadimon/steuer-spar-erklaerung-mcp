# desktop_stop bindet nur die eigene markierte PID. Zeigt sie kein breites
# Hauptfenster mehr (nur noch Dialog oder Startbild), ist sanftes Schliessen
# unmoeglich: mit discardChanges darf genau diese PID hart enden, ohne bleibt
# es fail-closed. Mehr als ein Hauptfenster bleibt in jedem Fall mehrdeutig.
$ErrorActionPreference = 'Stop'

$root = Split-Path $PSScriptRoot -Parent
$workerPath = Join-Path $root 'powershell\sse-worker.ps1'
$tokens = $null
$errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($workerPath, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw "Worker-Parserfehler: $($errors[0].Message)" }

$definition = @($ast.FindAll({
  param($node)
  $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Resolve-SSEDesktopStopPolicy'
}, $true))
if ($definition.Count -ne 1) { throw 'Funktion Resolve-SSEDesktopStopPolicy ist nicht eindeutig vorhanden.' }
Invoke-Expression $definition[0].Extent.Text

function Assert-Equal($Actual, $Expected, [string]$Message) {
  if ("$Actual" -cne "$Expected") { throw "$Message - erwartet '$Expected', erhalten '$Actual'" }
}

# 1 Genau ein Hauptfenster: immer der sanfte Weg, unabhaengig vom Flag.
$r = Resolve-SSEDesktopStopPolicy 1 $false
Assert-Equal $r.action 'graceful' 'Ein Fenster ohne Flag'
Assert-Equal $r.kind '' 'Ein Fenster ohne Flag kind leer'
$r = Resolve-SSEDesktopStopPolicy 1 $true
Assert-Equal $r.action 'graceful' 'Ein Fenster mit Flag'

# 2 Kein Hauptfenster ohne Flag: fail-closed mit Hinweis auf discardChanges.
$r = Resolve-SSEDesktopStopPolicy 0 $false
Assert-Equal $r.action 'fail' 'Kein Fenster ohne Flag'
Assert-Equal $r.kind 'confirmation-required' 'Kein Fenster ohne Flag kind'
if ($r.error -notmatch 'discardChanges') { throw "Fehlertext nennt discardChanges nicht: $($r.error)" }

# 3 Kein Hauptfenster mit Flag: harter Stop genau dieser PID.
$r = Resolve-SSEDesktopStopPolicy 0 $true
Assert-Equal $r.action 'hard-kill' 'Kein Fenster mit Flag'
Assert-Equal $r.kind '' 'Kein Fenster mit Flag kind leer'

# 4 Mehrere Hauptfenster bleiben mehrdeutig, auch mit Flag.
$r = Resolve-SSEDesktopStopPolicy 2 $false
Assert-Equal $r.action 'fail' 'Zwei Fenster ohne Flag'
Assert-Equal $r.kind 'ambiguous' 'Zwei Fenster ohne Flag kind'
$r = Resolve-SSEDesktopStopPolicy 3 $true
Assert-Equal $r.action 'fail' 'Drei Fenster mit Flag'
Assert-Equal $r.kind 'ambiguous' 'Drei Fenster mit Flag kind'

Write-Output 'desktop_stop-Policy: sanft, hart und beide Verweigerungen bestanden.'
