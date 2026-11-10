$ErrorActionPreference = 'Stop'

$root = Split-Path $PSScriptRoot -Parent
$workerPath = Join-Path $root 'powershell\sse-worker.ps1'
$tokens = $null
$errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($workerPath, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw "Worker-Parserfehler: $($errors[0].Message)" }

$experimentalDefinition = @($ast.FindAll({
  param($node)
  $node -is [Management.Automation.Language.FunctionDefinitionAst] -and
    $node.Name -eq 'Test-SSEExperimentalDialogAnswerAllowed'
}, $true))
if ($experimentalDefinition.Count -ne 1) { throw 'Experimental-Dialogpolicy ist nicht eindeutig vorhanden.' }
Invoke-Expression $experimentalDefinition[0].Extent.Text
$cancellationDefinition = @($ast.FindAll({
  param($node)
  $node -is [Management.Automation.Language.FunctionDefinitionAst] -and
    $node.Name -eq 'Test-SSESafeTransmissionDialogCancellation'
}, $true))
if ($cancellationDefinition.Count -ne 1) { throw 'Sicherer Abbruch fuer Uebermittlungsdialoge ist nicht eindeutig vorhanden.' }
Invoke-Expression $cancellationDefinition[0].Extent.Text
foreach ($functionName in @('Test-SSERecoveryPromptWindowCandidate', 'Test-SSERecoveryPromptDescriptor', 'Test-SSEEntryDeletionPromptDescriptor')) {
  $definition = @($ast.FindAll({
    param($node)
    $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $functionName
  }, $true))
  if ($definition.Count -ne 1) { throw "Recovery-Dialogpolicy $functionName ist nicht eindeutig vorhanden." }
  Invoke-Expression $definition[0].Extent.Text
}
$workerSource = Get-Content -LiteralPath $workerPath -Raw
$dialogBranch = $workerSource.IndexOf("  'dialog_answer' {")
$policyCall = $workerSource.IndexOf('Test-SSEExperimentalDialogAnswerAllowed $dialog $buttonName', $dialogBranch)
$cancellationCall = $workerSource.IndexOf('Test-SSESafeTransmissionDialogCancellation $buttonName', $dialogBranch)
$recoveryPolicyCall = $workerSource.IndexOf('Test-SSERecoveryPromptDescriptor $dialog', $dialogBranch)
$recoveryCaseBinding = $workerSource.IndexOf('Test-CaseBinding $targetWindows[0] $expectedCasePath', $dialogBranch)
$recoveryHashBinding = $workerSource.IndexOf('$recoveryHashBefore = Get-Sha256 $expectedCasePath', $dialogBranch)
$buttonInvoke = $workerSource.IndexOf('Invoke-DialogButtonInfo $dialog $buttonInfo[0]', $dialogBranch)
if ($dialogBranch -lt 0 -or $policyCall -lt $dialogBranch -or $cancellationCall -lt $dialogBranch -or
    $recoveryPolicyCall -lt $dialogBranch -or $recoveryCaseBinding -lt $dialogBranch -or
    $recoveryHashBinding -lt $dialogBranch -or $buttonInvoke -lt 0 -or
    $policyCall -gt $buttonInvoke -or $cancellationCall -gt $buttonInvoke -or
    $recoveryPolicyCall -gt $buttonInvoke -or $recoveryCaseBinding -gt $buttonInvoke -or
    $recoveryHashBinding -gt $buttonInvoke) {
  throw 'Dialogpolicy und sicherer Abbruch muessen vor dem ersten Button-Invoke laufen.'
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

$script:SSE_TAX_YEAR = 2025
function RecoveryDialog([string]$Text, [string[]]$Buttons = @('Ja', 'Nein')) {
  [pscustomobject]@{
    # Der Test selbst ist absichtlich BOM-los. Windows PowerShell 5.1 liest
    # solche Dateien in der System-Codepage; Codepoints halten die live
    # gemessenen Unicode-Zeichen deshalb auch dort exakt.
    title = ('SteuerSparErkl' + [char]0x00E4 + 'rung f' + [char]0x00FC + 'r das Steuerjahr 2025')
    cls = 'Qt692QWindowIcon'; w = 518; h = 260; kind = 'qt-dialog'
    uiaReadOk = $true
    texts = @($Text)
    buttons = @($Buttons | ForEach-Object { [pscustomobject]@{ name = $_; enabled = $true } })
    unsupportedButtons = @()
  }
}
$recoveryText = (
  'Es wurde eine Wiederherstellungsdatei gefunden. ' +
  'Vermutlich wurde das Programm zuvor nicht ordnungsgem' + [char]0x00E4 + 'ss beendet. ' +
  'M' + [char]0x00F6 + 'chten Sie diese Wiederherstellungsdatei jetzt laden?'
)
$recoveryDialog = RecoveryDialog $recoveryText
Assert-True (Test-SSERecoveryPromptDescriptor $recoveryDialog) `
  'Die exakt live gemessene Wiederherstellungsfrage wurde nicht erkannt.'
$partialRecovery = RecoveryDialog $recoveryText
$partialRecovery | Add-Member -NotePropertyName msaaError -NotePropertyValue 'Synthetic.Type'
$partialRecovery | Add-Member -NotePropertyName msaaReadOk -NotePropertyValue $false
Assert-True (-not (Test-SSERecoveryPromptDescriptor $partialRecovery)) 'Unvollstaendige Wiederherstellungsfrage wurde als bekannte Frage markiert.'
$partialRecovery.msaaError=$null; $partialRecovery.msaaReadOk=$true
$partialRecovery | Add-Member -NotePropertyName uiaError -NotePropertyValue 'Synthetic.Type'
Assert-True (Test-SSERecoveryPromptDescriptor $partialRecovery) 'Vollstaendige alternative MSAA-Lese wurde wegen eines UIA-Fehlers verworfen.'
Assert-True (-not (Test-SSERecoveryPromptDescriptor (RecoveryDialog ($recoveryText + ' Zusatz')))) `
  'Recovery-Dialog mit driftendem Text wurde akzeptiert.'
Assert-True (-not (Test-SSERecoveryPromptDescriptor (RecoveryDialog $recoveryText @('Ja', 'Nein', 'Abbrechen')))) `
  'Recovery-Dialog mit drittem Schalter wurde akzeptiert.'
$recoveryDialog.buttons[1].enabled = $false
Assert-True (-not (Test-SSERecoveryPromptDescriptor $recoveryDialog)) `
  'Recovery-Dialog mit deaktiviertem Nein wurde akzeptiert.'

# Execute the actual contiguous production classification guard. No UI entry
# point or button invocation is loaded by these fixtures.
$candidateAssignments = @($ast.FindAll({ param($node)
  $node -is [Management.Automation.Language.AssignmentStatementAst] -and
  $node.Left.Extent.Text -ceq '$isRecoveryWindowCandidate'
}, $true))
Assert-True ($candidateAssignments.Count -eq 1) 'Recovery candidate assignment is not unique.'
$guardStatements = @($candidateAssignments[0].Parent.Statements)
$guardIndex = [array]::IndexOf($guardStatements, $candidateAssignments[0])
Assert-True ($guardStatements[$guardIndex+3] -is [Management.Automation.Language.IfStatementAst]) 'Recovery classification guard is not contiguous.'
$classificationGuard = [scriptblock]::Create((@($guardStatements[$guardIndex..($guardIndex+3)] | ForEach-Object {$_.Extent.Text}) -join "`n"))
function Invoke-ClassificationFixture($Dialog, [bool]$Blocked) {
  function Fail($Message, $Kind) { $failure=[InvalidOperationException]::new($Message); $failure.Data['kind']=$Kind; throw $failure }
  $failure=$null
  try { & $classificationGuard } catch { $failure=$_.Exception }
  Assert-True ([bool]$failure -eq $Blocked) 'Unexpected recovery classification refusal.'
  if ($Blocked) { Assert-True ($failure.Data['kind'] -ceq 'dialog-unreadable') 'Wrong classification failure.' }
}
$deleteText = ('Soll dieser Eintrag wirklich gel' + [char]0x00F6 + 'scht werden? (zum L' + [char]0x00F6 +
  'schen ohne Nachfrage die STRG-Taste gedr' + [char]0x00FC + 'ckt halten.)')
$deleteDialog = RecoveryDialog $deleteText
Assert-True (Test-SSERecoveryPromptWindowCandidate $deleteDialog) 'Fixture must reproduce the title/geometry overlap.'
Assert-True (-not (Test-SSERecoveryPromptDescriptor $deleteDialog)) 'Deletion is not recovery.'
Assert-True (Test-SSEEntryDeletionPromptDescriptor $deleteDialog) 'Exact ordinary entry deletion was not recognized.'
Invoke-ClassificationFixture $deleteDialog $false
Invoke-ClassificationFixture (RecoveryDialog $recoveryText) $false
foreach ($driftingDelete in @(
  (RecoveryDialog ($deleteText+' Zusatz')),
  (RecoveryDialog ''),
  (RecoveryDialog $deleteText @('Ja','Nein','Abbrechen')),
  (RecoveryDialog ($recoveryText+' Zusatz'))
)) {
  Assert-True (-not (Test-SSEEntryDeletionPromptDescriptor $driftingDelete)) 'A drifting deletion descriptor was accepted.'
  Invoke-ClassificationFixture $driftingDelete $true
}
$unreadableDelete=RecoveryDialog $deleteText
$unreadableDelete | Add-Member NoteProperty uiaError 'Synthetic.Type'
$unreadableDelete | Add-Member NoteProperty msaaReadOk $false
Invoke-ClassificationFixture $unreadableDelete $true
$disabledDelete=RecoveryDialog $deleteText
$disabledDelete.buttons[0].enabled=$false
Invoke-ClassificationFixture $disabledDelete $true

Assert-True (Test-SSESafeTransmissionDialogCancellation 'Abbrechen') `
  "Der exakte sichere Dialogabbruch 'Abbrechen' wurde gesperrt."
foreach ($unsafeCancellation in @('OK', 'Ja', 'Nein', 'Schließen', 'Übernehmen')) {
  Assert-True (-not (Test-SSESafeTransmissionDialogCancellation $unsafeCancellation)) `
    "Die Dialogantwort '$unsafeCancellation' wurde als allgemeiner Uebermittlungsabbruch freigegeben."
}

$profitText = 'Der Gewinn des Betriebs {0}Muster{1} wurde aktualisiert.' -f [char]0x00BB, [char]0x00AB
$profitNotice = Dialog 'Gewinn aktualisiert!' @($profitText) @('OK')
Assert-True (Test-SSEExperimentalDialogAnswerAllowed $profitNotice 'OK') `
  'Exakt bekannte passive Gewinnnotiz wurde gesperrt.'

foreach ($case in @(
  @{ dialog = (Dialog 'Speichern' @('Änderungen speichern?') @('Ja', 'Nein')); button = 'Ja' },
  @{ dialog = (Dialog 'Export für das Finanzamt (*.csv)' @('Daten exportieren') @('Klicken Sie hier, um Ihre Daten zu exportieren')); button = 'Klicken Sie hier, um Ihre Daten zu exportieren' },
  @{ dialog = (Dialog 'Steuerprogramm' @('Es wurde eine Wiederherstellungsdatei gefunden.') @('Ja', 'Nein')); button = 'Nein' },
  @{ dialog = (Dialog 'Aktualisierung fehlgeschlagen!' @('Der importierte Steuerfall konnte nicht aktualisiert werden.') @('OK')); button = 'OK' },
  @{ dialog = (Dialog 'Aktualisierung fehlgeschlagen!' @('Anderer Inhalt') @('OK')); button = 'OK' },
  @{ dialog = (Dialog 'Gewinn aktualisiert!' @('Anderer Inhalt') @('OK')); button = 'OK' },
  @{ dialog = (Dialog 'Gewinn aktualisiert!' @($profitText.Substring(0,1).ToLowerInvariant() + $profitText.Substring(1)) @('OK')); button = 'OK' },
  @{ dialog = (Dialog 'Gewinn aktualisiert!' @('Der Gewinn des Betriebs Muster wurde aktualisiert.') @('OK')); button = 'OK' },
  @{ dialog = (Dialog 'Gewinn aktualisiert!' @($profitText) @('OK', 'Details')); button = 'OK' },
  @{ dialog = (Dialog 'Steuerprogramm' @('Änderungen speichern?') @('Nein')); button = 'Nein' }
)) {
  Assert-True (-not (Test-SSEExperimentalDialogAnswerAllowed $case.dialog $case.button)) `
    "Unbekannter oder mutierender Dialog '$($case.dialog.title)'/'$($case.button)' wurde freigegeben."
}

Write-Output "Dialogpolicy: Recovery-Nein fall-/hashgebunden; passive Gewinnnotiz und exaktes 'Abbrechen' eng freigegeben."
