# sse_page_state muss beschreiben, wie ein Feld zu beschreiben ist - und der
# Epoch-Hash darf davon nichts mitbekommen.
#
# Die Operation meldet den Zustand katalogisierter Felder. Ohne Werkzeugnamen und
# Automation-Endstueck muss der Aufrufer zusaetzlich sse_page_objects lesen und
# paart dann Zustand aus dem einen mit Metadaten aus dem anderen Aufruf - genau
# die Verwechslung, die eine Feldtransaktion unbrauchbar macht.
#
# Der Epoch-Hash bindet dagegen ausschliesslich den Zustand. Kaemen die
# Katalogangaben hinein, wuerde jede Umbenennung einer Beschriftung die Epoche
# aendern und laufende Plaene ohne Sachgrund verwerfen.
$ErrorActionPreference = 'Stop'

$root = Split-Path $PSScriptRoot -Parent
$workerPath = Join-Path $root 'powershell\sse-worker.ps1'
$workerSource = Get-Content -LiteralPath $workerPath -Raw
$errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($workerPath, [ref]$null, [ref]$errors)
if ($errors.Count) { throw "Worker-Parserfehler: $($errors[0].Message)" }

$definition = @($ast.FindAll({
  param($node)
  $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Get-KnownPageState'
}, $true))
if ($definition.Count -ne 1) { throw 'Funktion Get-KnownPageState ist nicht eindeutig vorhanden.' }
$quelltext = $definition[0].Extent.Text

# Die Feldprojektion nennt Werkzeug und Kennung.
foreach ($schluessel in @('controlType=', 'valueKind=', 'writeTool=', 'automationIdSuffix=')) {
  if ($quelltext -notmatch [regex]::Escape($schluessel)) {
    throw "Die Feldprojektion von sse_page_state liefert '$schluessel' nicht."
  }
}
if ($quelltext -notmatch [regex]::Escape("PSObject.Properties['writeTool']")) {
  throw 'writeTool muss optional gelesen werden; nicht jedes Feld traegt eines.'
}

# Der Epoch-Hash bindet ausschliesslich Zustand.
$epochZeile = [regex]::Match($quelltext, '\[pscustomobject\]@\{ id=\$_\.fieldId;[^}]*\}')
if (-not $epochZeile.Success) { throw 'Der Epoch-Rumpf von sse_page_state ist nicht auffindbar.' }
foreach ($statisch in @('controlType', 'valueKind', 'writeTool', 'automationIdSuffix', 'label')) {
  if ($epochZeile.Value -match [regex]::Escape($statisch)) {
    throw "Der Epoch-Hash enthaelt die statische Katalogangabe '$statisch'; er darf nur Zustand binden."
  }
}
foreach ($zustand in @('value', 'enabled', 'readOnly')) {
  if ($epochZeile.Value -notmatch [regex]::Escape($zustand)) {
    throw "Der Epoch-Hash bindet '$zustand' nicht mehr."
  }
}

Write-Output 'sse_page_state: Schreibkennungen in der Projektion, Epoch-Hash nur auf Zustand - bestanden'
