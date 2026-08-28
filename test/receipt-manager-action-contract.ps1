# Der BelegManager bleibt ohne freie Selektoren: zwei reversible Navigationen
# sowie getrennte, gebundene Lese-, Befuell-, Import- und Loeschoperationen.
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
$detailCloseName = 'Detailansicht  schlie' + [char]0x00DF + 'en'
Assert-True ($policy.controls.deleteReceipt.automationIdSuffix -ceq '.btn_delete' -and $policy.controls.deleteReceipt.expectedName -ceq $deleteName) 'Loeschschalter-Bindung fehlt.'
Assert-True ($policy.controls.detailClose.automationIdSuffix -ceq '.pushButton_detailsClose' -and $policy.controls.detailClose.expectedName -ceq $detailCloseName) 'Detailansicht-Schliessen-Bindung fehlt.'
Assert-True ($policy.deleteConfirmation.title -ceq $deleteTitle) 'Loeschdialogtitel ist nicht exakt profiliert.'
Assert-True ([string]$policy.deleteConfirmation.fingerprint -match '^[A-Fa-f0-9]{64}$') 'Loeschdialogfingerprint fehlt.'
Assert-True ($policy.importDialog.title -ceq $openTitle -and $policy.importDialog.class -ceq '#32770') 'Belegimport-Dialog ist nicht exakt profiliert.'
Assert-True ([string]$policy.importDialog.fingerprint -match '^[A-Fa-f0-9]{64}$') 'Belegimport-Dialogfingerprint fehlt.'
$editableFields = @($policy.controls.editableFields.PSObject.Properties.Name | Sort-Object)
Assert-True (($editableFields -join ',') -ceq 'amount,date,documentNumber,net,note,title,vatRate') 'Editierbare Belegfelder sind nicht exakt allowlisted.'
Assert-True ($policy.controls.editableFields.date.automationIdSuffix -ceq '.dateEdit_datum.AAVDateLineEdit') 'Datumfeld ist nicht exakt profiliert.'
Assert-True ($policy.controls.editableFields.amount.valueKind -ceq 'currency') 'Betragsfeld hat nicht den erwarteten Werttyp.'
Assert-True ($policy.controls.editableFields.net.controlType -ceq 'CheckBox') 'Nettofeld ist nicht als Checkbox gebunden.'
Assert-True ([int]$policy.list.primaryTextColumn -eq 2) 'Primaertext-Spalte ist nicht auf den live gemessenen Grid-Index 2 profiliert.'
Assert-True ([int]$policy.list.documentNumberColumn -eq 8) 'Belegnummer-Spalte ist nicht auf den live gemessenen Grid-Index 8 profiliert.'
Assert-True ([string]$policy.list.searchAutomationIdSuffix -ceq '.widget_mainWindowInfoBar.frame_container.lineEdit_suche') 'Beleglisten-Suche ist nicht profiliert.'
Assert-True ([bool]$policy.controls.linkManagement.directToggleSupported -eq $false) 'Wirkungsloses TogglePattern darf fuer SSE 31.0.1 nicht aktiviert sein.'

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
Assert-True ([int64]$listState.window -eq 5252) 'BelegManager-Zustand behaelt das exakt gelesene Fenster nicht fuer die Grid-Projektion.'

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

$projectionStart = $worker.IndexOf('function Get-SSEReceiptManagerListProjection(')
$projectionEnd = $worker.IndexOf('function Resolve-SSEReceiptManagerVisibleRowTarget(', $projectionStart)
Assert-True ($projectionStart -ge 0 -and $projectionEnd -gt $projectionStart) 'BelegManager-Listenprojektion ist nicht eindeutig abgrenzbar.'
$projectionBlock = $worker.Substring($projectionStart, $projectionEnd - $projectionStart)
foreach ($required in @(
  '[Windows.Automation.GridPattern]::Pattern',
  '$gridRowCount -eq $count',
  '$filterText.Length -gt 0',
  '$projectionExpectedCount = $gridRowCount',
  '$grid.GetItem($gridRow, $gridColumn)',
  '$projectedCellGroups.Count -ne $count'
)) {
  Assert-True ($projectionBlock.Contains($required)) "BelegManager-Listenprojektion enthaelt den Virtualisierungs-Guard '$required' nicht."
}
foreach ($forbidden in @('SetScrollPercent(', 'ScrollIntoView(', 'Click-VerifiedPoint')) {
  Assert-True (-not $projectionBlock.Contains($forbidden)) "BelegManager-Gridprojektion ist nicht rein lesend: '$forbidden'."
}

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

$receiptReadStart = $listReadEnd
$receiptReadEnd = $worker.IndexOf("  'receipt_manager_update' {", $receiptReadStart)
Assert-True ($receiptReadStart -ge 0 -and $receiptReadEnd -gt $receiptReadStart) 'receipt_manager_read-Operationsblock ist nicht eindeutig abgrenzbar.'
$receiptReadBlock = $worker.Substring($receiptReadStart, $receiptReadEnd - $receiptReadStart)
Assert-True ($receiptReadBlock.Contains('Get-SSEReceiptManagerState $toolHwnd $policy -WithValues')) 'receipt_manager_read muss sichtbare Detailwerte und ReadOnly-Zustaende mit ValuePattern lesen.'
Assert-True ($receiptReadBlock.Contains('$expectedSemanticRows')) 'receipt_manager_read muss nach dem Schliessen Runtime-ID-Drift ueber fachliche Zeilenfingerprints tolerieren.'
Assert-True ($receiptReadBlock.Contains('| Sort-Object')) 'receipt_manager_read muss eine reine Qt-Neusortierung als inhaltlich unveraendertes Multiset behandeln.'
Assert-True ($receiptReadBlock.Contains('$semanticRowAfterMatches.Count -eq 1')) 'receipt_manager_read muss die Zielzeile nach einer Qt-Neusortierung ueber die exakte fachliche Identitaet rebound binden.'
Assert-True ($receiptReadBlock.Contains('$detailIdentityMatchesTarget')) 'receipt_manager_read darf Detailwerte nur fuer exakt denselben Titel und dieselbe Belegnummer bestaetigen.'
Assert-True ($receiptReadBlock.Contains('Resolve-SSEReceiptManagerVisibleRowTarget')) 'receipt_manager_read muss virtualisierte Offscreen-Belege vor dem Klick sicher sichtbar binden.'

$visibleRowStart = $worker.IndexOf('function Resolve-SSEReceiptManagerVisibleRowTarget(')
$visibleRowEnd = $worker.IndexOf('function Get-SSEReceiptManagerDetailProjection(', $visibleRowStart)
Assert-True ($visibleRowStart -ge 0 -and $visibleRowEnd -gt $visibleRowStart) 'Offscreen-Belegbindung ist nicht eindeutig abgrenzbar.'
$visibleRowBlock = $worker.Substring($visibleRowStart, $visibleRowEnd - $visibleRowStart)
foreach ($required in @(
  '[Windows.Automation.GridPattern]::Pattern',
  '[Windows.Automation.ScrollItemPattern]::Pattern',
  '[Windows.Automation.SelectionItemPattern]::Pattern',
  '[Windows.Automation.SelectionPattern]::Pattern',
  'Current.IsSelected',
  'Current.CanSelectMultiple',
  '$preparationClickBinding = Click-VerifiedPoint',
  'detailOpened=$true',
  '$projectedSelectedRows.Count -ne 1',
  '$AE::FromPoint',
  '[SW]::WindowFromPoint($point)',
  '[SW]::mouse_event(0x0800',
  'Get-SSEPointObstruction $ToolHwnd',
  '$expectedRowsJson',
  '$expectedTargetCellsJson',
  'Get-SSEReceiptManagerStableCellNames',
  "`$scrollMethod = 'verified-wheel'"
)) {
  Assert-True ($visibleRowBlock.Contains($required)) "Offscreen-Belegbindung fehlt der Guard '$required'."
}

$updateStart = $receiptReadEnd
$updateEnd = $worker.IndexOf("  'receipt_manager_import' {", $updateStart)
Assert-True ($updateStart -ge 0 -and $updateEnd -gt $updateStart) 'receipt_manager_update-Operationsblock ist nicht eindeutig abgrenzbar.'
$updateBlock = $worker.Substring($updateStart, $updateEnd - $updateStart)
foreach ($required in @(
  "Arg `$a 'acknowledgeUpdate'",
  'rowFingerprint',
  'expectedListFingerprint',
  'expectedDetailFingerprint',
  'Resolve-SSEReceiptManagerEditableFieldNode',
  'Get-SSEReceiptManagerLiveEditableField',
  'Wait-SSEReceiptManagerLiveFieldValue',
  'Commit-TrackedValue',
  'Click-VerifiedPoint',
  'rollbackEntries',
  'otherRowsUnchanged',
  'dirtyStateUnchanged'
)) {
  Assert-True ($updateBlock.Contains($required)) "receipt_manager_update enthaelt den Guard '$required' nicht."
}
foreach ($forbidden in @("Arg `$a 'name'", "Arg `$a 'aid'", "Arg `$a 'rid'", "Arg `$a 'x'", "Arg `$a 'y'")) {
  Assert-True (-not $updateBlock.Contains($forbidden)) "receipt_manager_update akzeptiert den freien Selektor '$forbidden'."
}
$updateOnlyEnd = $worker.IndexOf("  'receipt_manager_classification_options' {", $updateStart)
$updateOnlyBlock = $worker.Substring($updateStart, $updateOnlyEnd - $updateStart)
Assert-True (
  ($updateOnlyBlock.Split(@('Get-SSEReceiptManagerState $toolHwnd $policy -WithValues'), [StringSplitOptions]::None).Count - 1) -eq 3
) 'receipt_manager_update darf Vollbaum-Readbacks nur fuer Ausgangsbindung, Detailbindung und Abschlusszustand verwenden.'

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
Assert-True (-not $importBlock.Contains('$oldRowIds')) 'Belegimport darf neue Entwuerfe nicht ueber fluechtige UIA-Runtime-IDs erkennen.'
Assert-True ($importBlock.Contains('$createdRows = @($createdList.rows | Where-Object { [bool]$_.draft })')) 'Belegimport muss den nach der entwurfsfreien Vorbedingung eindeutigen neuen Entwurf binden.'
Assert-True ($importBlock.Contains('$afterCreatedRows = @($listAfter.rows | Where-Object { [bool]$_.draft })')) 'Belegimport muss den Entwurf nach der Dateiauswahl erneut semantisch binden.'
Assert-True ($importBlock.Contains('$oldContentFingerprints | Sort-Object | ConvertTo-Json -Compress')) 'Belegimport muss bestehende Inhalte als exaktes Multiset statt in fluechtiger visueller Reihenfolge vergleichen.'

$classificationToggleStart = $worker.IndexOf('function Get-SSEReceiptManagerClassificationToggleElement(')
$classificationToggleEnd = $worker.IndexOf('function Close-SSEReceiptManagerClassificationDialog(', $classificationToggleStart)
Assert-True ($classificationToggleStart -ge 0 -and $classificationToggleEnd -gt $classificationToggleStart) 'Kategorien-Toggle-Bindung ist nicht eindeutig abgrenzbar.'
$classificationToggleBlock = $worker.Substring($classificationToggleStart, $classificationToggleEnd - $classificationToggleStart)
foreach ($required in @(
  'ScrollItemPattern',
  'ScrollPattern',
  '$outsideTable',
  '$cellY -ge ([double]$tableRect.Y + [double]$tableRect.Height)',
  '[SW]::WindowFromPoint($point)',
  '[SW]::mouse_event(0x0800',
  'ist verdeckt; die Auswahltabelle wurde nicht gerollt'
)) {
  Assert-True ($classificationToggleBlock.Contains($required)) "Kategorien-Toggle fehlt der Sichtbarkeits-/Scroll-Guard '$required'."
}

Assert-True (@($policy.linkValueTransferDialog.fingerprints).Count -eq 3) 'Die drei live gemessenen Belegwerte-Dialogvarianten fehlen im Profil.'
Assert-True (-not @($policy.linkValueTransferDialog.fingerprints | Where-Object {
  [string]$_ -notmatch '^[A-Fa-f0-9]{64}$'
}).Count) 'Belegwerte-Dialogvarianten enthalten keinen gueltigen Fingerprintvertrag.'
Assert-True ($worker.Contains('[string]$descriptor.fingerprint -cnotin $acceptedTransferFingerprints')) 'Link-Operation akzeptiert die profilierten Belegwerte-Dialogvarianten nicht fail-closed.'
$linkStart = $worker.IndexOf("  'receipt_manager_link' {")
$linkEnd = $worker.IndexOf("  'receipt_manager_import' {", $linkStart)
Assert-True ($linkStart -ge 0 -and $linkEnd -gt $linkStart) 'Link-Operation ist nicht eindeutig abgrenzbar.'
$linkBlock = $worker.Substring($linkStart, $linkEnd - $linkStart)
foreach ($required in @(
  '$linkItems.Count -gt 20',
  'expectedDocumentNumber',
  '$projectionsBefore.Add',
  '$setListSearch',
  '$cancelStagedMode',
  '[Windows.Automation.ValuePattern]::Pattern',
  'Commit-TrackedValue $modeBefore.hwnd $searchNodes[0]',
  'Get-SSEReceiptManagerState $modeBefore.hwnd $policy -WithValues',
  'Vollstaendige Belegliste kehrte nach dem Batch nicht exakt',
  '[Windows.Automation.InvokePattern]::Pattern',
  "method='invoke-pattern'",
  'Select-Object -Unique',
  'foreach ($itemIndex in $changes)',
  '[Windows.Automation.ScrollItemPattern]::Pattern',
  '[Windows.Automation.ScrollPattern]::Pattern',
  'SetScrollPercent(',
  'ScrollIntoView()',
  "[Windows.Forms.SendKeys]::SendWait('^{HOME}')",
  "'{PGDN}'",
  "'{PGUP}'",
  '[Windows.Automation.SelectionItemPattern]::Pattern',
  '$selectedTogglePoint',
  '$focusCandidates',
  'fuer den begrenzten Tastatur-Fokus',
  '$previousExpectedCount',
  '$retryClick = Click-VerifiedPoint',
  '$projectionBefore = & $readMode $stagedMode $item',
  '$applyClick = & $closeMode',
  '$projectionsAfter.Add',
  "'ambiguous'",
  'changedCount=$changes.Count'
)) {
  Assert-True ($linkBlock.Contains($required)) "receipt_manager_link enthaelt den Batch-Guard '$required' nicht."
}
Assert-True (-not $linkBlock.Contains("Arg `$a 'force'")) 'Mehrdeutige Belegtitel duerfen nicht mit force umgangen werden.'
Assert-True (($linkBlock.Split(@('$applyClick = & $closeMode'), [StringSplitOptions]::None).Count - 1) -eq 1) 'Batch-Link darf nur einmal Uebernehmen ausloesen.'
Assert-True (($linkBlock.Split(@('$modeAfter = & $openMode'), [StringSplitOptions]::None).Count - 1) -eq 1) 'Batch-Link darf nur einen Persistenz-Readback-Zyklus oeffnen.'
$dialogImportStart = $worker.IndexOf('function Invoke-SSEReceiptManagerOpenFileDialog(')
$dialogImportEnd = $worker.IndexOf('function Resolve-SSEPageObject(', $dialogImportStart)
Assert-True ($dialogImportStart -ge 0 -and $dialogImportEnd -gt $dialogImportStart) 'Gebundener Belegimport-Dialogweg ist nicht eindeutig abgrenzbar.'
$dialogImportBlock = $worker.Substring($dialogImportStart, $dialogImportEnd - $dialogImportStart)
Assert-True ($dialogImportBlock.Contains('Resolve-SSEDialogFieldHandle $dialogHwnd $field')) 'Belegimport muss das native Dateiname-Control binden.'
Assert-True ($dialogImportBlock.Contains("Set-SSEDialogFieldText `$dialogHwnd `$fieldHandle `$field `$Path 'Dateiname-Feld'")) 'Belegimport muss den gemeinsamen Unicode- und Readback-gesicherten Dialogfeldweg verwenden.'
Assert-True ($dialogImportBlock.Contains('dialogProfileFingerprintMatched=$profileFingerprintMatched')) 'Belegimport muss generische Windows-Dialogdrift im Readback ausweisen.'
Assert-True (-not $dialogImportBlock.Contains("Fail 'Belegimport-Dialog stimmt nicht mit dem gemessenen Fingerprint ueberein")) 'Ordnerabhaengige Windows-Dialogdrift darf einen strukturell exakt gebundenen Import nicht technisch sperren.'
Assert-True ($dialogImportBlock.Contains('TryGetCurrentPattern([Windows.Automation.InvokePattern]::Pattern')) 'Der native Oeffnen-Schalter muss vor dem physischen Fallback per InvokePattern bedient werden.'
Assert-True ($dialogImportBlock.Contains('[SW]::GetDlgItem($dialogHwnd, 1)')) 'Der native Oeffnen-Fallback muss exakt an Control-ID 1 gebunden sein.'
Assert-True ($dialogImportBlock.Contains('0x00F5')) 'Der geometrisch und textuell verifizierte native Oeffnen-Fallback muss BM_CLICK verwenden.'
Assert-True (-not $dialogImportBlock.Contains('Click-VerifiedPoint $dialogHwnd $openButtons[0]')) 'Der Windows-Hit-Test darf den nativen Oeffnen-Schalter nicht erneut gegen das darunterliegende Qt-Fenster verwerfen.'
Assert-True (-not $dialogImportBlock.Contains("SendKeys]::SendWait('^a')")) 'Belegimport darf Ctrl+A nicht zum Leeren des nativen Dateiname-Felds verwenden.'
Assert-True (-not $dialogImportBlock.Contains('ConvertTo-SendKeysLiteral $Path')) 'Belegimport darf den Dateipfad nicht vom aktiven Tastaturlayout abhaengig eingeben.'

$readStart = $worker.IndexOf("  'receipt_manager_read' {")
$updateStart = $worker.IndexOf("  'receipt_manager_update' {", $readStart)
Assert-True ($readStart -ge 0 -and $updateStart -gt $readStart) 'Beleglesung ist nicht eindeutig abgrenzbar.'
$readBlock = $worker.Substring($readStart, $updateStart - $readStart)
Assert-True ($readBlock.Contains('row=$semanticRowAfterMatches[0]')) 'Beleglesung muss die semantisch reboundene post-selection Zeilenbindung zurueckgeben.'
Assert-True ($readBlock.Contains('$policy.controls.detailClose')) 'Beleglesung muss die Detailansicht ueber den profilierten Schalter wieder schliessen.'
Assert-True ($readBlock.Contains('[bool]$listAfter.rowsComplete')) 'Beleglesung muss vor dem Rueckgabebinding die vollstaendige Tabellenprojektion wiederherstellen.'
Assert-True ($readBlock.Contains('($actualSemanticRows | ConvertTo-Json -Compress) -ceq')) 'Beleglesung muss nach dem Schliessen der Details das fachliche Listen-Multiset beweisen.'
Assert-True ($readBlock.Contains('$semanticRowAfterMatches.Count -eq 1')) 'Beleglesung muss nach dem Schliessen weiterhin exakt dieselbe fachliche Zielzeile binden.'

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
  'Resolve-SSEReceiptManagerVisibleRowTarget',
  '$visibleTarget.detailOpened',
  'NICHT wiederholen'
)) {
  Assert-True ($deleteBlock.Contains($required)) "receipt_manager_delete enthaelt den Guard '$required' nicht."
}
foreach ($forbidden in @("Arg `$a 'name'", "Arg `$a 'aid'", "Arg `$a 'x'", "Arg `$a 'y'")) {
  Assert-True (-not $deleteBlock.Contains($forbidden)) "receipt_manager_delete akzeptiert den freien Selektor '$forbidden'."
}

Write-Output 'BelegManager: gebundene Navigation, Liste, Lesen, Befuellen, Batch-Link, Import und Loeschen.'
