$ErrorActionPreference = 'Stop'

$root = Split-Path $PSScriptRoot -Parent
$workerPath = Join-Path $root 'powershell\sse-worker.ps1'
$tokens = $null
$errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($workerPath, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw "Worker-Parserfehler: $($errors[0].Message)" }

$definition = @($ast.FindAll({
  param($node)
  $node -is [Management.Automation.Language.FunctionDefinitionAst] -and
    $node.Name -eq 'Test-SSEExperimentalDialogAnswerAllowed'
}, $true))
if ($definition.Count -ne 1) { throw 'Experimental-Dialogpolicy ist nicht eindeutig vorhanden.' }
Invoke-Expression $definition[0].Extent.Text
$workerSource = Get-Content -LiteralPath $workerPath -Raw
$dialogBranch = $workerSource.IndexOf("  'dialog_answer' {")
$policyCall = $workerSource.IndexOf('Test-SSEExperimentalDialogAnswerAllowed $dialog $buttonName', $dialogBranch)
$buttonInvoke = $workerSource.IndexOf('Invoke-DialogButtonInfo $dialog $buttonInfo[0]', $dialogBranch)
if ($dialogBranch -lt 0 -or $policyCall -lt $dialogBranch -or $buttonInvoke -lt 0 -or $policyCall -gt $buttonInvoke) {
  throw 'Experimental-Dialogpolicy muss im dialog_answer-Zweig vor dem ersten Button-Invoke laufen.'
}

function Dialog([string]$Title, [string[]]$Texts, [string[]]$Buttons) {
  [pscustomobject]@{
    title = $Title
    texts = @($Texts)
    buttons = @($Buttons | ForEach-Object { [pscustomobject]@{ name = $_; enabled = $true } })
  }
}
function Assert-True([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw $Message }
}

$profitNotice = Dialog 'Gewinn aktualisiert!' @('Der Gewinn des Betriebs »Muster« wurde aktualisiert.') @('OK')
Assert-True (Test-SSEExperimentalDialogAnswerAllowed $profitNotice 'OK') `
  'Exakt bekannte passive Gewinnnotiz wurde gesperrt.'

foreach ($case in @(
  @{ dialog = (Dialog 'Speichern' @('Änderungen speichern?') @('Ja', 'Nein')); button = 'Ja' },
  @{ dialog = (Dialog 'Export für das Finanzamt (*.csv)' @('Daten exportieren') @('Klicken Sie hier, um Ihre Daten zu exportieren')); button = 'Klicken Sie hier, um Ihre Daten zu exportieren' },
  @{ dialog = (Dialog 'Steuerprogramm' @('Es wurde eine Wiederherstellungsdatei gefunden.') @('Ja', 'Nein')); button = 'Nein' },
  @{ dialog = (Dialog 'Aktualisierung fehlgeschlagen!' @('Der importierte Steuerfall konnte nicht aktualisiert werden.') @('OK')); button = 'OK' },
  @{ dialog = (Dialog 'Aktualisierung fehlgeschlagen!' @('Anderer Inhalt') @('OK')); button = 'OK' },
  @{ dialog = (Dialog 'Gewinn aktualisiert!' @('Anderer Inhalt') @('OK')); button = 'OK' },
  @{ dialog = (Dialog 'Gewinn aktualisiert!' @('Der Gewinn des Betriebs »Muster« wurde aktualisiert.') @('OK', 'Details')); button = 'OK' },
  @{ dialog = (Dialog 'Steuerprogramm' @('Änderungen speichern?') @('Nein')); button = 'Nein' }
)) {
  Assert-True (-not (Test-SSEExperimentalDialogAnswerAllowed $case.dialog $case.button)) `
    "Unbekannter oder mutierender Dialog '$($case.dialog.title)'/'$($case.button)' wurde freigegeben."
}

Write-Output 'Experimental-Dialogpolicy: nur die exakt bekannte passive Gewinnnotiz erlaubt.'
