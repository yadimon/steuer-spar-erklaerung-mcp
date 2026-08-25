# Der BelegManager bleibt ohne freie Selektoren: zwei reversible Navigationen
# sowie getrennte, gebundene Lese-, Import- und Loeschoperationen.
$ErrorActionPreference = 'Stop'

$root = Split-Path $PSScriptRoot -Parent
$workerPath = Join-Path $root 'powershell\sse-worker.ps1'
$catalogPath = Join-Path $root 'profiles\2025\page-objects.json'
$worker = Get-Content -LiteralPath $workerPath -Raw -Encoding UTF8
$catalog = Get-Content -LiteralPath $catalogPath -Raw -Encoding UTF8 | ConvertFrom-Json

function Assert-True([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw $Message }
}

$tokens = $null
$errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($workerPath, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw "Worker-Parserfehler: $($errors[0].Message)" }
foreach ($functionName in @(
  'Get-SSEReceiptManagerPolicy',
  'Get-SSEReceiptManagerState',
  'Get-SSEReceiptManagerListProjection',
  'Get-SSEReceiptManagerWindowSet'
)) {
  $definitions = @($ast.FindAll({
    param($node)
    $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $functionName
  }, $true))
  Assert-True ($definitions.Count -eq 1) "$functionName ist nicht eindeutig vorhanden."
  if ($functionName -in @('Get-SSEReceiptManagerState','Get-SSEReceiptManagerListProjection')) {
    Invoke-Expression $definitions[0].Extent.Text
  }
}

$policy = $catalog.windows.receiptManager
Assert-True ($policy.role -ceq 'nonmodal-tool-window') 'BelegManager hat nicht die erwartete Werkzeugfensterrolle.'
Assert-True ('Qt692QWindow' -match [string]$policy.classPattern) 'Die gemessene Qt-Klasse passt nicht zur Profilbindung.'
Assert-True ('Qt692QWindowIcon' -notmatch [string]$policy.classPattern) 'Das Hauptfenster passt faelschlich zur BelegManager-Klasse.'
Assert-True (@($policy.actions.PSObject.Properties).Count -eq 2) 'Der Profilkatalog enthaelt mehr oder weniger als zwei BelegManager-Aktionen.'
Assert-True (@($policy.actions.PSObject.Properties.Name | Sort-Object) -join ',' -ceq 'goHome,showAllReceipts') 'Die BelegManager-Aktionsliste ist nicht exakt allowlisted.'
Assert-True ($policy.actions.showAllReceipts.fromState -ceq 'start' -and $policy.actions.showAllReceipts.toState -ceq 'list') 'showAllReceipts hat keine reversible Start-zu-Liste-Bindung.'
Assert-True ($policy.actions.goHome.fromState -ceq 'list' -and $policy.actions.goHome.toState -ceq 'start') 'goHome hat keine reversible Liste-zu-Start-Bindung.'
Assert-True ($policy.actions.showAllReceipts.automationIdSuffix -ceq '.btn_alleBelegeAnzeigen') 'showAllReceipts zielt nicht auf den gemessenen Schalter.'
Assert-True ($policy.actions.goHome.automationIdSuffix -ceq '.pushButton_home') 'goHome zielt nicht auf den gemessenen Startseiten-Schalter.'
Assert-True ($policy.controls.newReceipt.automationIdSuffix -ceq '.btn_new' -and $policy.controls.newReceipt.expectedName -ceq 'Neuer Beleg') 'Neuer-Beleg-Bindung fehlt.'
Assert-True ($policy.controls.attachFile.automationIdSuffix -ceq '.panel_asset.DetailPagePreview.panel_asset') 'Dateiflaechen-Bindung fehlt.'
$deleteName = 'L' + [char]0x00F6 + 'schen'
$deleteTitle = $deleteName + ' best' + [char]0x00E4 + 'tigen'
$openTitle = [char]0x00D6 + 'ffnen'
Assert-True ($policy.controls.deleteReceipt.automationIdSuffix -ceq '.btn_delete' -and $policy.controls.deleteReceipt.expectedName -ceq $deleteName) 'Loeschschalter-Bindung fehlt.'
Assert-True ($policy.deleteConfirmation.title -ceq $deleteTitle) 'Loeschdialogtitel ist nicht exakt profiliert.'
Assert-True ([string]$policy.deleteConfirmation.fingerprint -match '^[A-Fa-f0-9]{64}$') 'Loeschdialogfingerprint fehlt.'
Assert-True ($policy.importDialog.title -ceq $openTitle -and $policy.importDialog.class -ceq '#32770') 'Belegimport-Dialog ist nicht exakt profiliert.'
Assert-True ([string]$policy.importDialog.fingerprint -match '^[A-Fa-f0-9]{64}$') 'Belegimport-Dialogfingerprint fehlt.'

function Get-SSETextSha256([string]$Text) { 'A' * 64 }
function Walk-Tree([IntPtr]$Window, [int]$MaxNodes) {
  [pscustomobject]@{ nodes=$script:ReceiptNodes; stats=[pscustomobject]@{ n=$script:ReceiptNodes.Count } }
}
function ReceiptNode([string]$Suffix, [bool]$Enabled = $true) {
  [pscustomobject]@{
    aid="SSE_Application.BMMainWindow$Suffix"; name=''; type='Button'; on=$Enabled
    checked=$null; selected=$null; x=10; y=10; w=20; h=20
  }
}
$script:ReceiptNodes = @($policy.states.start.requiredAutomationIdSuffixes | ForEach-Object { ReceiptNode ([string]$_) })
$startState = Get-SSEReceiptManagerState ([IntPtr]5252) $policy
Assert-True ($startState.state -ceq 'start') "Startzustand wurde als '$($startState.state)' erkannt."
$script:ReceiptNodes = @($policy.states.list.requiredAutomationIdSuffixes | ForEach-Object { ReceiptNode ([string]$_) })
$listState = Get-SSEReceiptManagerState ([IntPtr]5252) $policy
Assert-True ($listState.state -ceq 'list') "Listenzustand wurde als '$($listState.state)' erkannt."

$tableAid = 'SSE_Application.BMMainWindow.BMMainWindow.frame.stackedWidget.page_mainTable.tableWidget_mainTabel'
$listState.nodes = @(
  [pscustomobject]@{ aid=$tableAid; name=''; type='Table'; rid='table'; on=$true; x=80; y=233; w=900; h=400 },
  [pscustomobject]@{ aid='SSE_Application.BMMainWindow.BMMainWindow.frame.stackedWidget.page_mainTable.widget_mainWindowInfoBar.frame_container.label_infoText1'; name='MEINE BELEGE (1)'; type='Text'; rid='count'; on=$true; x=60; y=130; w=200; h=30 },
  [pscustomobject]@{ aid='SSE_Application.BMMainWindow.BMMainWindow.frame.stackedWidget.page_mainTable.widget_mainWindowInfoBar.frame_container.label_infoText2'; name=''; type='Text'; rid='count2'; on=$true; x=-1; y=-1; w=0; h=0 },
  [pscustomobject]@{ aid='SSE_Application.BMMainWindow.BMMainWindow.frame.stackedWidget.page_mainTable.widget_mainWindowInfoBar.frame_container.label_infoText3'; name=''; type='Text'; rid='count3'; on=$true; x=-1; y=-1; w=0; h=0 },
  [pscustomobject]@{ aid=$tableAid; name='Bezeichnung'; type='HeaderItem'; rid='head'; on=$true; x=100; y=233; w=300; h=30 },
  [pscustomobject]@{ aid=$tableAid; name='Neuer Beleg*'; type='DataItem'; rid='row-a'; on=$true; selected=$true; x=158; y=273; w=300; h=30 },
  [pscustomobject]@{ aid=$tableAid; name='0'; type='DataItem'; rid='row-b'; on=$true; selected=$null; x=539; y=273; w=83; h=30 }
)
$projection = Get-SSEReceiptManagerListProjection $listState $policy
Assert-True ($projection.count -eq 1 -and $projection.rows.Count -eq 1 -and $projection.rowsComplete) 'BelegManager-Liste wurde nicht vollstaendig projiziert.'
Assert-True ($projection.draftCount -eq 1 -and $projection.rows[0].draft) 'Leerer Belegentwurf wurde nicht markiert.'
Assert-True ([string]$projection.rows[0].rowRid -ceq 'row-a') 'Zeilenbindung verwendet nicht die erste sichtbare Zelle.'
Assert-True ([string]$projection.rows[0].rowFingerprint -match '^[A-Fa-f0-9]{64}$') 'Zeilenfingerprint fehlt.'
Assert-True ([string]$projection.rows[0].contentFingerprint -match '^[A-Fa-f0-9]{64}$') 'Stabiler Inhaltsfingerprint fehlt.'

$listReadStart = $worker.IndexOf("  'receipt_manager_list' {")
$listReadEnd = $worker.IndexOf("  'receipt_manager_read' {", $listReadStart)
Assert-True ($listReadStart -ge 0 -and $listReadEnd -gt $listReadStart) 'receipt_manager_list-Operationsblock ist nicht eindeutig abgrenzbar.'
$listReadBlock = $worker.Substring($listReadStart, $listReadEnd - $listReadStart)
foreach ($required in @('Get-SSEReceiptManagerListProjection','rowsComplete','physicalInputUsed=$false')) {
  Assert-True ($listReadBlock.Contains($required)) "receipt_manager_list enthaelt den Guard '$required' nicht."
}
foreach ($forbidden in @('Click-VerifiedPoint','SendKeys','Invoke-DialogButtonInfo')) {
  Assert-True (-not $listReadBlock.Contains($forbidden)) "receipt_manager_list ist nicht rein lesend: '$forbidden'."
}

$start = $worker.IndexOf("  'receipt_manager_action' {")
$end = $worker.IndexOf("  'ui_state' {", $start)
Assert-True ($start -ge 0 -and $end -gt $start) 'receipt_manager_action-Operationsblock ist nicht eindeutig abgrenzbar.'
$block = $worker.Substring($start, $end - $start)
foreach ($required in @(
  'Resolve-SSEMainWindowDescriptor',
  "Resolve-SSEToolWindowHandle 'receiptManager'",
  'Get-SSEReceiptManagerState',
  'Get-DialogInventory',
  'Test-Versand',
  'Get-LiveElement $toolHwnd $freshMatches[0].rid',
  'Click-VerifiedPoint $toolHwnd $freshTarget $inputTick -RequireForeground',
  'windowSetUnchanged',
  'dirtyStateUnchanged',
  "kind='postcondition-failed'",
  'keine Wiederholung'
)) {
  Assert-True ($block.Contains($required)) "receipt_manager_action enthaelt den Guard '$required' nicht."
}
foreach ($forbidden in @("Arg `$a 'name'", "Arg `$a 'aid'", "Arg `$a 'rid'", "Arg `$a 'x'", "Arg `$a 'y'")) {
  Assert-True (-not $block.Contains($forbidden)) "receipt_manager_action akzeptiert den freien Selektor '$forbidden'."
}

$importStart = $worker.IndexOf("  'receipt_manager_import' {")
$deleteStart = $worker.IndexOf("  'receipt_manager_delete' {", $importStart)
Assert-True ($importStart -ge 0 -and $deleteStart -gt $importStart) 'Import- und Loeschoperation sind nicht eindeutig angeordnet.'
$importBlock = $worker.Substring($importStart, $deleteStart - $importStart)
foreach ($required in @(
  "Arg `$a 'acknowledgeImport'",
  'expectedListFingerprint',
  'expectedCountBefore',
  'draftCount',
  'Get-SSEWindowRegionPixelFingerprint',
  'Invoke-SSEReceiptManagerOpenFileDialog',
  'sourceHashStable',
  'previewChanged',
  'cleanupRequired=$true',
  'NICHT wiederholen'
)) {
  Assert-True ($importBlock.Contains($required)) "receipt_manager_import enthaelt den Guard '$required' nicht."
}
foreach ($forbidden in @("Arg `$a 'name'", "Arg `$a 'aid'", "Arg `$a 'rid'", "Arg `$a 'x'", "Arg `$a 'y'")) {
  Assert-True (-not $importBlock.Contains($forbidden)) "receipt_manager_import akzeptiert den freien Selektor '$forbidden'."
}
$dialogImportStart = $worker.IndexOf('function Invoke-SSEReceiptManagerOpenFileDialog(')
$dialogImportEnd = $worker.IndexOf('function Resolve-SSEPageObject(', $dialogImportStart)
Assert-True ($dialogImportStart -ge 0 -and $dialogImportEnd -gt $dialogImportStart) 'Gebundener Belegimport-Dialogweg ist nicht eindeutig abgrenzbar.'
$dialogImportBlock = $worker.Substring($dialogImportStart, $dialogImportEnd - $dialogImportStart)
Assert-True ($dialogImportBlock.Contains('Resolve-SSEDialogFieldHandle $dialogHwnd $field')) 'Belegimport muss das native Dateiname-Control binden.'
Assert-True ($dialogImportBlock.Contains("Set-SSEDialogFieldText `$dialogHwnd `$fieldHandle `$field `$Path 'Dateiname-Feld'")) 'Belegimport muss den gemeinsamen Unicode- und Readback-gesicherten Dialogfeldweg verwenden.'
Assert-True (-not $dialogImportBlock.Contains("SendKeys]::SendWait('^a')")) 'Belegimport darf Ctrl+A nicht zum Leeren des nativen Dateiname-Felds verwenden.'
Assert-True (-not $dialogImportBlock.Contains('ConvertTo-SendKeysLiteral $Path')) 'Belegimport darf den Dateipfad nicht vom aktiven Tastaturlayout abhaengig eingeben.'

$actionStart = $worker.IndexOf("  'receipt_manager_action' {", $deleteStart)
Assert-True ($deleteStart -ge 0 -and $actionStart -gt $deleteStart) 'Loeschoperation ist nicht eindeutig abgrenzbar.'
$deleteBlock = $worker.Substring($deleteStart, $actionStart - $deleteStart)
foreach ($required in @(
  "Arg `$a 'acknowledgeDelete'",
  'rowFingerprint',
  'expectedListFingerprint',
  'expectedCountBefore',
  'deleteConfirmation.fingerprint',
  'Invoke-DialogButtonInfo',
  'remainingRowsUnchanged',
  'NICHT wiederholen'
)) {
  Assert-True ($deleteBlock.Contains($required)) "receipt_manager_delete enthaelt den Guard '$required' nicht."
}
foreach ($forbidden in @("Arg `$a 'name'", "Arg `$a 'aid'", "Arg `$a 'x'", "Arg `$a 'y'")) {
  Assert-True (-not $deleteBlock.Contains($forbidden)) "receipt_manager_delete akzeptiert den freien Selektor '$forbidden'."
}

Write-Output 'BelegManager: zwei reversible Navigationen sowie gebundene Liste-, Lese-, Import- und Loeschvertraege.'
