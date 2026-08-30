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
  'Invoke-SSESpeculativeProbe',
  'Fail',
  'Get-SSEReceiptManagerPolicy',
  'Get-SSEReceiptManagerStateFingerprint',
  'Get-SSEReceiptManagerState',
  'Get-SSEReceiptManagerListProjection',
  'Get-SSEReceiptManagerWindowSet',
  'ConvertTo-SSEReceiptManagerInputValue',
  'ConvertFrom-SSEReceiptManagerDisplayValue',
  'Get-SSEReceiptManagerDetailIdentityTitle',
  'Test-SSEReceiptManagerPdfHeader'
)) {
  $definitions = @($ast.FindAll({
    param($node)
    $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $functionName
  }, $true))
  Assert-True ($definitions.Count -eq 1) "$functionName ist nicht eindeutig vorhanden."
  if ($functionName -in @('Invoke-SSESpeculativeProbe','Fail','Get-SSEReceiptManagerStateFingerprint','Get-SSEReceiptManagerState','Get-SSEReceiptManagerListProjection','ConvertTo-SSEReceiptManagerInputValue','ConvertFrom-SSEReceiptManagerDisplayValue','Get-SSEReceiptManagerDetailIdentityTitle','Test-SSEReceiptManagerPdfHeader')) {
    Invoke-Expression $definitions[0].Extent.Text
  }
}

$policy = $catalog.windows.receiptManager
$script:SSE_SPECULATIVE_PROBE_ACTIVE = $false
$script:SSE_SPECULATIVE_PROBE_SENTINEL = 'SSE_INTERNAL_SPECULATIVE_PROBE_FAILED_5C88CFBD'
$script:SSE_CAPTURE_SENTINEL = 'SSE_INTERNAL_OPERATION_RESULT_CAPTURED'
$script:SSE_CAPTURE_OPERATION_RESULT = $false
$script:SpeculativeProbeEmitCalls = 0
$script:SpeculativeProbeEmitted = $null
function Emit($Payload) {
  $script:SpeculativeProbeEmitCalls++
  $script:SpeculativeProbeEmitted = $Payload
}

$successfulProbe = Invoke-SSESpeculativeProbe -Probe {
  param([string]$Value)
  [pscustomobject]@{ value=$Value }
} -ArgumentList @('probe-ok')
Assert-True ([string]$successfulProbe.value -ceq 'probe-ok') 'Eine erfolgreiche spekulative Probe gibt ihren Wert nicht zurueck.'
Assert-True (-not $script:SSE_SPECULATIVE_PROBE_ACTIVE) 'Probe-Flag bleibt nach erfolgreicher Probe gesetzt.'

$failedProbe = Invoke-SSESpeculativeProbe -Probe {
  param([string]$Message)
  Fail $Message 'probe-unit'
} -ArgumentList @('candidate-failed')
Assert-True ($null -eq $failedProbe) 'Fail innerhalb der spekulativen Probe muss den Candidate als null verwerfen.'
Assert-True ($script:SpeculativeProbeEmitCalls -eq 0) 'Fail innerhalb der spekulativen Probe darf Emit nicht aufrufen.'
Assert-True (-not $script:SSE_SPECULATIVE_PROBE_ACTIVE) 'Probe-Flag bleibt nach fehlgeschlagener Probe gesetzt.'
$fallbackRequired = $null -eq $failedProbe
Assert-True $fallbackRequired 'Ein verworfener Candidate muss die Fallback-Bedingung erzeugen.'

$script:NestedSpeculativeProbeExecuted = $false
$nestedProbe = {
  $script:NestedSpeculativeProbeExecuted = $true
  'unexpected-nested-value'
}
$nestedProbeResult = Invoke-SSESpeculativeProbe -Probe {
  param([scriptblock]$NestedProbe)
  Invoke-SSESpeculativeProbe -Probe $NestedProbe -ArgumentList @()
} -ArgumentList @($nestedProbe)
Assert-True ($null -eq $nestedProbeResult -and -not $script:NestedSpeculativeProbeExecuted) `
  'Eine verschachtelte spekulative Probe muss fail-closed null liefern, ohne den inneren Block auszufuehren.'
Assert-True (-not $script:SSE_SPECULATIVE_PROBE_ACTIVE) 'Probe-Flag bleibt nach verschachtelter Probe gesetzt.'

$script:SSE_CAPTURE_OPERATION_RESULT = $true
$captureFlagProbe = Invoke-SSESpeculativeProbe -Probe { param([string]$Value) $Value } -ArgumentList @('capture-unchanged')
Assert-True ([string]$captureFlagProbe -ceq 'capture-unchanged' -and $script:SSE_CAPTURE_OPERATION_RESULT) `
  'Die spekulative Probe darf den aeusseren Operations-Capture nicht veraendern.'
$captureSentinelPropagated = $false
try {
  $null = Invoke-SSESpeculativeProbe -Probe {
    param([string]$Sentinel)
    throw [InvalidOperationException]::new($Sentinel)
  } -ArgumentList @($script:SSE_CAPTURE_SENTINEL)
} catch {
  $captureSentinelPropagated = $_.Exception.Message -ceq $script:SSE_CAPTURE_SENTINEL
}
Assert-True $captureSentinelPropagated 'Die spekulative Probe hat den Sentinel des aeusseren Operations-Captures geschluckt.'
Assert-True (-not $script:SSE_SPECULATIVE_PROBE_ACTIVE) 'Probe-Flag bleibt nach propagiertem Capture-Sentinel gesetzt.'
$script:SSE_CAPTURE_OPERATION_RESULT = $false

$script:SpeculativeProbeEmitCalls = 0
$script:SpeculativeProbeEmitted = $null
Fail 'normal-fail' 'normal-kind' ([pscustomobject]@{ retryable=$false })
Assert-True ($script:SpeculativeProbeEmitCalls -eq 1) 'Normaler Fail muss ausserhalb einer Probe weiterhin exakt einmal Emit aufrufen.'
Assert-True (-not [bool]$script:SpeculativeProbeEmitted.ok -and
  [string]$script:SpeculativeProbeEmitted.kind -ceq 'normal-kind' -and
  [string]$script:SpeculativeProbeEmitted.error -ceq 'normal-fail' -and
  $script:SpeculativeProbeEmitted.retryable -eq $false) `
  'Normaler Fail muss seinen bisherigen Payload-Vertrag unveraendert an Emit uebergeben.'

$probeHelperStart = $worker.IndexOf('function Invoke-SSESpeculativeProbe(')
$probeHelperEnd = $worker.IndexOf('function Fail(', $probeHelperStart)
$failHelperEnd = $worker.IndexOf('$script:SSE_INTERNAL_PLAN_OPERATIONS', $probeHelperEnd)
Assert-True ($probeHelperStart -ge 0 -and $probeHelperEnd -gt $probeHelperStart -and $failHelperEnd -gt $probeHelperEnd) `
  'Spekulative Probe und Fail-Helfer sind nicht eindeutig abgrenzbar.'
$probeHelperBlock = $worker.Substring($probeHelperStart, $probeHelperEnd - $probeHelperStart)
$failHelperBlock = $worker.Substring($probeHelperEnd, $failHelperEnd - $probeHelperEnd)
foreach ($required in @(
  'if ($script:SSE_SPECULATIVE_PROBE_ACTIVE) { return $null }',
  '$script:SSE_SPECULATIVE_PROBE_ACTIVE = $true',
  '& $Probe @ArgumentList',
  '$_.Exception.Message -ceq $script:SSE_CAPTURE_SENTINEL',
  'finally {',
  '$script:SSE_SPECULATIVE_PROBE_ACTIVE = $false'
)) {
  Assert-True ($probeHelperBlock.Contains($required)) "Spekulativer Probe-Helfer fehlt der Guard '$required'."
}
Assert-True (-not $probeHelperBlock.Contains('SSE_CAPTURE_OPERATION_RESULT')) `
  'Der spekulative Probe-Helfer darf den aeusseren Capture-Modus nicht lesen oder veraendern.'
foreach ($required in @(
  '$payload = [ordered]@{ ok = $false; kind = $kind; error = "$msg" }',
  "if (`$property.Name -notin @('ok','kind','error','ms'))",
  'throw [InvalidOperationException]::new($script:SSE_SPECULATIVE_PROBE_SENTINEL)',
  'Emit ([pscustomobject]$payload)'
)) {
  Assert-True ($failHelperBlock.Contains($required)) "Fail-Helfer fehlt der normale/probegebundene Vertrag '$required'."
}
Assert-True ($failHelperBlock.IndexOf('SSE_SPECULATIVE_PROBE_SENTINEL') -lt $failHelperBlock.IndexOf('Emit ([pscustomobject]$payload)')) `
  'Fail muss den spekulativen Sentinel vor jedem Emit ausloesen.'
Assert-True ($worker.Contains("`$script:SSE_SPECULATIVE_PROBE_SENTINEL = 'SSE_INTERNAL_SPECULATIVE_PROBE_FAILED_5C88CFBD'")) `
  'Der scriptweite eindeutige Sentinel fuer spekulative Probes fehlt.'
Assert-True ($script:SSE_SPECULATIVE_PROBE_SENTINEL -cne $script:SSE_CAPTURE_SENTINEL) `
  'Probe- und Operations-Capture-Sentinel muessen eindeutig verschieden bleiben.'

$foregroundCatalogStart = $worker.IndexOf('$foregroundRequiredReceiptOps = @(')
$foregroundGateStart = $worker.IndexOf('$profilePolicyOperation -in $foregroundRequiredReceiptOps')
$buildGateStart = $worker.IndexOf('Assert-SSEVerifiedBuildForOperation $profilePolicyOperation $a', $foregroundGateStart)
$dispatcherStart = $worker.IndexOf('function Invoke-SSEWorkerOperation(', $foregroundGateStart)
Assert-True ($foregroundCatalogStart -ge 0) 'Der Worker besitzt keinen zentralen BelegManager-Interaktionskatalog.'
Assert-True ($foregroundGateStart -gt $foregroundCatalogStart) 'Der BelegManager-Interaktionsguard fehlt.'
Assert-True ($buildGateStart -gt $foregroundGateStart) 'Der BelegManager-Interaktionsguard muss vor der Buildaufloesung stoppen.'
Assert-True ($dispatcherStart -gt $buildGateStart) 'Der BelegManager-Interaktionsguard muss vor dem Operationsdispatcher stoppen.'
$foregroundGateEnd = $buildGateStart
Assert-True ($foregroundGateEnd -gt $foregroundGateStart) 'Der BelegManager-Interaktionsguard ist nicht eindeutig abgrenzbar.'
$foregroundGate = $worker.Substring($foregroundGateStart, $foregroundGateEnd - $foregroundGateStart)
foreach ($required in @(
  "'blocked'",
  "reason='foreground-required-operation-disabled'",
  'retryable=$false',
  "interactionRequirement='foreground-required'",
  'mutationStarted=$false',
  "resultingState='unchanged'",
  'cleanupRequired=$false',
  'physicalInputUsed=$false',
  'foregroundLeaseUsed=$false'
)) {
  Assert-True ($foregroundGate.Contains($required)) "Der globale BelegManager-Interaktionsguard enthaelt '$required' nicht."
}
Assert-True ($foregroundGate.Contains('nicht automatisch wiederholen')) 'Der Block muss automatische Wiederholung ausdruecklich ausschliessen.'

$menuClickStart = $worker.IndexOf("  'menu_click' {")
$menuClickEnd = $worker.IndexOf("  'menu_close' {", $menuClickStart)
Assert-True ($menuClickStart -ge 0 -and $menuClickEnd -gt $menuClickStart) `
  'menu_click-Operationsblock ist nicht eindeutig abgrenzbar.'
$menuClickBlock = $worker.Substring($menuClickStart, $menuClickEnd - $menuClickStart)
foreach ($required in @(
  '$receiptPolicy = Get-SSEReceiptManagerPolicy',
  '[string]$match.node.name -ceq [string]$receiptPolicy.title',
  '[int]$_.pid -eq $targetPid',
  '[string]$_.cls -match [string]$receiptPolicy.classPattern',
  '$toolMatches.Count -eq 1',
  'Start-Sleep -Milliseconds 100',
  'else {',
  'Start-Sleep -Milliseconds $waitMs'
)) {
  Assert-True ($menuClickBlock.Contains($required)) "menu_click fehlt der BelegManager-Wartevertrag '$required'."
}

$menuStart = $worker.IndexOf("  'menu' {")
$menuEnd = $worker.IndexOf("  'menu_click' {", $menuStart)
Assert-True ($menuStart -ge 0 -and $menuEnd -gt $menuStart) `
  'menu-Operationsblock ist nicht eindeutig abgrenzbar.'
$menuBlock = $worker.Substring($menuStart, $menuEnd - $menuStart)
$namedMenuIndex = $menuBlock.IndexOf("`$wunsch = [string](Arg `$a 'name')")
$listOnlyIndex = $menuBlock.IndexOf('if (-not $wunsch) {')
$listWalkIndex = $menuBlock.IndexOf('$t = Walk-Tree $hwnd 1200')
$openNamedIndex = $menuBlock.IndexOf('$m = Open-SSEMenuByName $hwnd $wunsch')
Assert-True ($namedMenuIndex -ge 0 -and $listOnlyIndex -gt $namedMenuIndex -and $listWalkIndex -gt $listOnlyIndex) `
  'Die Menuezeilen-Ermittlung ist nicht auf den namenlosen Listenmodus begrenzt.'
Assert-True ($openNamedIndex -gt $listWalkIndex) `
  'Der benannte Menuepfad ist nicht eindeutig hinter dem optionalen Listenmodus gebunden.'
Assert-True (([regex]::Matches($menuBlock, [regex]::Escape('$t = Walk-Tree $hwnd 1200'))).Count -eq 1) `
  'Der menu-Block enthaelt mehr als einen Menuezeilen-Walk.'

$menuOpenStart = $worker.IndexOf('function Open-SSEMenuByName(')
$menuOpenEnd = $worker.IndexOf('function Get-SSEOpenMenuEntryMatches(', $menuOpenStart)
Assert-True ($menuOpenStart -ge 0 -and $menuOpenEnd -gt $menuOpenStart) `
  'Open-SSEMenuByName ist nicht eindeutig abgrenzbar.'
$menuOpenBlock = $worker.Substring($menuOpenStart, $menuOpenEnd - $menuOpenStart)
foreach ($required in @(
  '$openDeadline = [DateTime]::UtcNow.AddMilliseconds(700)',
  'ExpandCollapseState]::Expanded',
  "`$_.cls -match 'PopupDropShadow|SysShadow'",
  'if (($expanded -and $popupReady) -or [DateTime]::UtcNow -ge $openDeadline) { break }',
  'Start-Sleep -Milliseconds 50'
)) {
  Assert-True ($menuOpenBlock.Contains($required)) "Open-SSEMenuByName fehlt der Popup-Bereitschaftsvertrag '$required'."
}
Assert-True (-not $menuOpenBlock.Contains('Start-Sleep -Milliseconds 700')) `
  'Open-SSEMenuByName wartet weiterhin fest statt bis zum beobachteten Popup-Zustand.'

$menuCloseStart = $worker.IndexOf("  'menu_close' {")
$menuCloseEnd = $worker.IndexOf("  'receipt_manager_bulk_upsert' {", $menuCloseStart)
Assert-True ($menuCloseStart -ge 0 -and $menuCloseEnd -gt $menuCloseStart) `
  'menu_close-Operationsblock ist nicht eindeutig abgrenzbar.'
$menuCloseBlock = $worker.Substring($menuCloseStart, $menuCloseEnd - $menuCloseStart)
foreach ($required in @(
  '$closeDeadline = [DateTime]::UtcNow.AddMilliseconds(500)',
  "`$_.cls -match 'PopupDropShadow|SysShadow'",
  'if (-not $after.Count -or [DateTime]::UtcNow -ge $closeDeadline) { break }',
  'Start-Sleep -Milliseconds 50',
  '$verified = [bool]($after.Count -eq 0)'
)) {
  Assert-True ($menuCloseBlock.Contains($required)) "menu_close fehlt der Popup-Postcondition-Vertrag '$required'."
}
Assert-True (-not $menuCloseBlock.Contains('Start-Sleep -Milliseconds 500')) `
  'menu_close wartet weiterhin fest statt bis zur beobachteten Popup-Postcondition.'

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
Assert-True ((ConvertTo-SSEReceiptManagerInputValue 'vatRate' '19' 'vat-rate') -ceq '19 %') 'USt-ComboBox erhaelt nicht den vollstaendigen Qt-Anzeigetext.'
Assert-True ((ConvertFrom-SSEReceiptManagerDisplayValue '15.01.2025' 'date') -ceq '2025-01-15') 'Belegdatum wird am API-Rand nicht kanonisch als ISO-Datum gelesen.'
Assert-True ((ConvertFrom-SSEReceiptManagerDisplayValue '19 %' 'vat-rate') -ceq '19') 'USt-Satz wird am API-Rand nicht kanonisch ohne Anzeigezeichen gelesen.'
Assert-True ((ConvertFrom-SSEReceiptManagerDisplayValue '' 'vat-rate') -ceq '0') 'Leerer Qt-USt-Satz wird am API-Rand nicht kanonisch als Nullsatz gelesen.'
Assert-True ([int]$policy.list.primaryTextColumn -eq 2) 'Primaertext-Spalte ist nicht auf den live gemessenen Grid-Index 2 profiliert.'
Assert-True ([int]$policy.list.documentNumberColumn -eq 8) 'Belegnummer-Spalte ist nicht auf den live gemessenen Grid-Index 8 profiliert.'
Assert-True ([string]$policy.list.searchAutomationIdSuffix -ceq '.widget_mainWindowInfoBar.frame_container.lineEdit_suche') 'Beleglisten-Suche ist nicht profiliert.'
Assert-True ((@($policy.importDialog.supportedExtensions) -join ',') -ceq '.pdf') 'Belegimport muss auf das live belegte PDF-Format begrenzt bleiben.'
$pdfProbe = [IO.Path]::GetTempFileName()
try {
  [IO.File]::WriteAllBytes($pdfProbe, [Text.Encoding]::ASCII.GetBytes("%PDF-1.4`n%%EOF`n"))
  Assert-True (Test-SSEReceiptManagerPdfHeader $pdfProbe) 'Ein PDF-Header wurde nicht erkannt.'
  [IO.File]::WriteAllBytes($pdfProbe, [Text.Encoding]::ASCII.GetBytes("plain text`n"))
  Assert-True (-not (Test-SSEReceiptManagerPdfHeader $pdfProbe)) 'Eine Nicht-PDF-Datei wurde als PDF akzeptiert.'
} finally {
  Remove-Item -LiteralPath $pdfProbe -Force -ErrorAction SilentlyContinue
}
Assert-True ([bool]$policy.controls.linkManagement.directToggleSupported -eq $false) 'Wirkungsloses TogglePattern darf fuer SSE 31.0.1 nicht aktiviert sein.'

function Get-SSETextSha256([string]$Text) {
  $bytes = [Text.Encoding]::UTF8.GetBytes($Text)
  $sha = [Security.Cryptography.SHA256]::Create()
  try { ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-', '') }
  finally { $sha.Dispose() }
}
function Walk-Tree([IntPtr]$Window, [int]$MaxNodes, [switch]$WithValues) {
  [pscustomobject]@{
    nodes=$script:ReceiptNodes
    stats=[pscustomobject]@{ n=$script:ReceiptNodes.Count; truncated=$false; valErr=0 }
  }
}
function ReceiptNode([string]$Suffix, [bool]$Enabled = $true) {
  [pscustomobject]@{
    aid="SSE_Application.BMMainWindow$Suffix"; name=''; type='Button'; on=$Enabled
    checked=$null; selected=$null; x=10; y=10; w=20; h=20
  }
}
$noValueFingerprintNodes = @($policy.states.start.requiredAutomationIdSuffixes | ForEach-Object { ReceiptNode ([string]$_) })
$withValueFingerprintNodes = @($policy.states.start.requiredAutomationIdSuffixes | ForEach-Object { ReceiptNode ([string]$_) })
$withValueFingerprintNodes[0].checked = $true
$withValueFingerprintNodes[0].selected = $false
$noValueFingerprint = Get-SSEReceiptManagerStateFingerprint ([IntPtr]5252) 'start' $noValueFingerprintNodes $policy
$rawWithValueFingerprint = Get-SSEReceiptManagerStateFingerprint ([IntPtr]5252) 'start' $withValueFingerprintNodes $policy
$structuralWithValueFingerprint = Get-SSEReceiptManagerStateFingerprint `
  ([IntPtr]5252) 'start' $withValueFingerprintNodes $policy -Structural
$legacyRelevantSuffixes = @(
  @($policy.states.PSObject.Properties | ForEach-Object { @($_.Value.requiredAutomationIdSuffixes) }) +
  @($policy.actions.PSObject.Properties | ForEach-Object { [string]$_.Value.automationIdSuffix })
) | ForEach-Object { [string]$_ } | Where-Object { $_ } | Select-Object -Unique
$legacyStableNodes = @($noValueFingerprintNodes | Where-Object {
  $aid = [string]$_.aid
  @($legacyRelevantSuffixes | Where-Object { $aid.EndsWith($_, [StringComparison]::Ordinal) }).Count -gt 0
} | Sort-Object aid | ForEach-Object {
  [pscustomobject][ordered]@{
    aid=[string]$_.aid; name=[string]$_.name; type=[string]$_.type
    enabled=[bool]$_.on; checked=$_.checked; selected=$_.selected
    x=[int]$_.x; y=[int]$_.y; w=[int]$_.w; h=[int]$_.h
  }
})
$legacyFingerprint = Get-SSETextSha256 (([pscustomobject][ordered]@{
  hwnd=[int64]5252; state='start'; nodes=$legacyStableNodes
}) | ConvertTo-Json -Depth 8 -Compress)
Assert-True ($noValueFingerprint -ceq $legacyFingerprint) `
  'Der ausgelagerte Standard-Fingerprint muss bytegleich zum bisherigen JSON-/Hash-Aufbau bleiben.'
Assert-True ($rawWithValueFingerprint -cne $noValueFingerprint) `
  'Raw-WithValues-Fingerprint muss sich wegen checked/selected vom No-Values-Fingerprint unterscheiden.'
Assert-True ($structuralWithValueFingerprint -ceq $noValueFingerprint) `
  'Structural-WithValues-Fingerprint muss checked/selected exakt wie der No-Values-Fingerprint normalisieren.'

$nameFingerprintNodes = @($policy.states.start.requiredAutomationIdSuffixes | ForEach-Object { ReceiptNode ([string]$_) })
$nameFingerprintNodes[0].name = 'Geaenderter Name'
$enabledFingerprintNodes = @($policy.states.start.requiredAutomationIdSuffixes | ForEach-Object { ReceiptNode ([string]$_) })
$enabledFingerprintNodes[0].on = $false
$geometryFingerprintNodes = @($policy.states.start.requiredAutomationIdSuffixes | ForEach-Object { ReceiptNode ([string]$_) })
$geometryFingerprintNodes[0].x++
Assert-True ((Get-SSEReceiptManagerStateFingerprint ([IntPtr]5252) 'start' $nameFingerprintNodes $policy -Structural) -cne $noValueFingerprint) `
  'Structural-Fingerprint darf Name-Aenderungen nicht normalisieren.'
Assert-True ((Get-SSEReceiptManagerStateFingerprint ([IntPtr]5252) 'start' $enabledFingerprintNodes $policy -Structural) -cne $noValueFingerprint) `
  'Structural-Fingerprint darf Enabled-Aenderungen nicht normalisieren.'
Assert-True ((Get-SSEReceiptManagerStateFingerprint ([IntPtr]5252) 'start' $geometryFingerprintNodes $policy -Structural) -cne $noValueFingerprint) `
  'Structural-Fingerprint darf Geometrie-Aenderungen nicht normalisieren.'
Assert-True ((Get-SSEReceiptManagerStateFingerprint ([IntPtr]5252) 'list' $noValueFingerprintNodes $policy -Structural) -cne $noValueFingerprint) `
  'Structural-Fingerprint darf Zustandsaenderungen nicht normalisieren.'

$script:ReceiptNodes = $noValueFingerprintNodes
$startState = Get-SSEReceiptManagerState ([IntPtr]5252) $policy
Assert-True ($startState.state -ceq 'start') "Startzustand wurde als '$($startState.state)' erkannt."
Assert-True ($startState.fingerprint -ceq $noValueFingerprint) `
  'Get-SSEReceiptManagerState muss im Standardmodus exakt den ausgelagerten Fingerprint verwenden.'
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
Assert-True ((Get-SSEReceiptManagerDetailIdentityTitle $projection.rows[0] $policy) -ceq 'Neuer Beleg') 'Profilierter Draft-Marker wurde fuer die Detailidentitaet nicht exakt entfernt.'
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
Assert-True ($receiptReadBlock.Contains('-not [string]$rowBefore.documentNumber')) 'Eine im Grid nachweislich nicht exponierte Belegnummer darf die exakte Titel-/Zeilenbindung nicht kuenstlich stale machen.'
Assert-True ($receiptReadBlock.Contains('Resolve-SSEReceiptManagerVisibleRowTarget')) 'receipt_manager_read muss virtualisierte Offscreen-Belege vor dem Klick sicher sichtbar binden.'
Assert-True ($receiptReadBlock.Contains("method='already-open-detail'")) 'receipt_manager_read muss eine exakt gebundene bereits offene Detailansicht ohne erneuten Zeilenklick lesen.'
Assert-True ($receiptReadBlock.IndexOf('$detailState = Get-SSEReceiptManagerState $toolHwnd $policy -WithValues') -lt
  $receiptReadBlock.IndexOf('Resolve-SSEReceiptManagerVisibleRowTarget')) 'receipt_manager_read muss eine offene Detailansicht mit vollstaendigen Werten pruefen, bevor es die Tabellenzeile erneut bindet.'
$candidateProbeIndex = $receiptReadBlock.IndexOf('$detailCandidateProbe = Invoke-SSESpeculativeProbe -Probe {')
$detailCandidateIndex = $receiptReadBlock.IndexOf('$detailCandidate = Get-SSEReceiptManagerState $ProbeToolHwnd $ProbePolicy -WithValues', $candidateProbeIndex)
$candidateListIndex = $receiptReadBlock.IndexOf('$detailCandidateList = Get-SSEReceiptManagerListProjection $detailCandidate $ProbePolicy', $detailCandidateIndex)
$candidateGateIndex = $receiptReadBlock.IndexOf('reusable=[bool](', $candidateListIndex)
$candidateArgumentsIndex = $receiptReadBlock.IndexOf('} -ArgumentList @(', $candidateGateIndex)
$reuseCandidateIndex = $receiptReadBlock.IndexOf('$reuseDetailCandidate = [bool]($detailCandidateProbe -and [bool]$detailCandidateProbe.reusable)', $candidateArgumentsIndex)
$fastBranchIndex = $receiptReadBlock.IndexOf('if ($reuseDetailCandidate) {', $reuseCandidateIndex)
$fallbackFreshIndex = $receiptReadBlock.IndexOf('$freshState = Get-SSEReceiptManagerState $toolHwnd $policy', $fastBranchIndex)
$fallbackStaleIndex = $receiptReadBlock.IndexOf('if ([string]$freshStateFingerprint -cne [string]$stateBefore.fingerprint', $fallbackFreshIndex)
$fallbackDetailIndex = $receiptReadBlock.IndexOf('$detailState = Get-SSEReceiptManagerState $toolHwnd $policy -WithValues', $fallbackStaleIndex)
Assert-True ($candidateProbeIndex -ge 0 -and $detailCandidateIndex -gt $candidateProbeIndex -and
  $candidateListIndex -gt $detailCandidateIndex -and $candidateGateIndex -gt $candidateListIndex -and
  $candidateArgumentsIndex -gt $candidateGateIndex -and $reuseCandidateIndex -gt $candidateArgumentsIndex -and
  $fastBranchIndex -gt $reuseCandidateIndex) `
  'receipt_manager_read muss den gesamten WithValues-Candidate innerhalb genau einer spekulativen Probe aufbauen und erst danach wiederverwenden.'
Assert-True ((($receiptReadBlock.Split(@('$detailCandidate = Get-SSEReceiptManagerState $ProbeToolHwnd $ProbePolicy -WithValues'), [StringSplitOptions]::None).Count - 1) -eq 1)) `
  'receipt_manager_read darf nur einen initialen WithValues-detailCandidate lesen.'
Assert-True ($fallbackFreshIndex -gt $fastBranchIndex -and $fallbackStaleIndex -gt $fallbackFreshIndex -and
  $fallbackDetailIndex -gt $fallbackStaleIndex) `
  'Der Fallback muss unveraendert No-Values-Freshness und Stale-Guard vor einem neuen WithValues-Detailread ausfuehren.'
foreach ($required in @(
  '[IntPtr]$ProbeToolHwnd',
  '$ProbePolicy',
  '[string]$ProbeRowRid',
  '[string]$ProbeRowFingerprint',
  '[string]$ProbeStateBeforeFingerprint',
  '[string]$ProbeExpectedListFingerprint',
  '[IntPtr]$toolHwnd,',
  '$policy,',
  '$rowRid,',
  '$rowFingerprint,',
  '[string]$stateBefore.fingerprint,',
  '$expectedListFingerprint',
  '$candidateSearchNodes.Count -eq 1',
  '$null -ne $candidateSearchNodes[0].val',
  "[string]`$candidateSearchNodes[0].val -ceq ''",
  '$null -ne $detailCandidate.stats.PSObject.Properties[''truncated'']',
  '$null -ne $detailCandidate.stats.PSObject.Properties[''valErr'']',
  '-not [bool]$detailCandidate.stats.truncated',
  '[int]$detailCandidate.stats.valErr -eq 0',
  'Get-SSEReceiptManagerStateFingerprint',
  '-Structural',
  '[string]$detailCandidateStructuralFingerprint -ceq $ProbeStateBeforeFingerprint',
  '[bool]$detailCandidateList.rowsComplete',
  '$null -eq $detailCandidateList.gridProjectionError',
  '[string]$detailCandidateList.listFingerprint -ceq $ProbeExpectedListFingerprint',
  '$detailCandidateRows.Count -eq 1',
  '$freshStateFingerprint = $detailCandidateProbe.structuralFingerprint',
  '$reuseDetailCandidate = [bool]($detailCandidateProbe -and [bool]$detailCandidateProbe.reusable)',
  'if (-not $reuseDetailCandidate) {'
)) {
  Assert-True ($receiptReadBlock.Contains($required)) "receipt_manager_read fehlt der enge Candidate-/Fallback-Guard '$required'."
}

$updateStart = $receiptReadEnd
$updateEnd = $worker.IndexOf("  'receipt_manager_import' {", $updateStart)
Assert-True ($updateStart -ge 0 -and $updateEnd -gt $updateStart) 'receipt_manager_update-Operationsblock ist nicht eindeutig abgrenzbar.'
$updateBlock = $worker.Substring($updateStart, $updateEnd - $updateStart)
Assert-True ($updateBlock.Contains("[string]`$transaction.name -ceq 'vatRate'")) 'USt-Feld muss eine eigene typisierte Auswahl verwenden.'
Assert-True ($updateBlock.Contains('Set-SSEReceiptManagerVatRateSelection')) 'USt-Feld muss ueber die profilierte ComboBox-Option statt freien Text gesetzt werden.'
Assert-True ($updateBlock.Contains("Resolve-SSEReceiptManagerEditableFieldNode `$vatState `$policy 'vatRate'")) 'USt-Feld muss vor der Auswahl aus einem frischen Zustandsbaum aufgeloest werden.'

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
  '$postClickSelectionObject',
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
  'Get-LiveElement $ToolHwnd ([string]$Row.rowRid)',
  'Get-SSEReceiptManagerStableCellNames',
  'Test-SSEPointElementWithinExactReceiptTitle',
  '([string]$rowNow[0].rowRid)',
  "`$scrollMethod = 'verified-wheel'"
)) {
  Assert-True ($visibleRowBlock.Contains($required)) "Offscreen-Belegbindung fehlt der Guard '$required'."
}

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
  'Close-SSEReceiptManagerDetailView',
  'Get-SSEReceiptManagerDetailIdentityTitle',
  '$titleIdentityMatchCount -eq 1',
  '-not $documentNumberCellIndices.Count',
  'rollbackEntries',
  'offeneBedingungen=@($openConditions)',
  'otherRowsUnchanged',
  'dirtyStateUnchanged'
)) {
  Assert-True ($updateBlock.Contains($required)) "receipt_manager_update enthaelt den Guard '$required' nicht."
}
foreach ($forbidden in @("Arg `$a 'name'", "Arg `$a 'aid'", "Arg `$a 'rid'", "Arg `$a 'x'", "Arg `$a 'y'")) {
  Assert-True (-not $updateBlock.Contains($forbidden)) "receipt_manager_update akzeptiert den freien Selektor '$forbidden'."
}
$missingGridNumberFallback = $updateBlock.IndexOf(
  'if ([bool]$finalList.rowsComplete -and $titleIdentityMatchCount -eq 1 -and')
$identityDeadlineCheck = $updateBlock.IndexOf(
  'if ([DateTime]::UtcNow -ge $identityDeadline) { break }', $missingGridNumberFallback)
$identityRepoll = $updateBlock.IndexOf(
  '$finalState = Get-SSEReceiptManagerState $toolHwnd $policy', $identityDeadlineCheck)
Assert-True ($missingGridNumberFallback -ge 0 -and
  $identityDeadlineCheck -gt $missingGridNumberFallback -and $identityRepoll -gt $identityDeadlineCheck) `
  'Eine vollstaendige, eindeutig titelgebundene Liste ohne exponierte Belegnummer muss vor Deadline und Vollbaum-Repoll rebound werden.'
$updateOnlyEnd = $worker.IndexOf("  'receipt_manager_classification_options' {", $updateStart)
$updateOnlyBlock = $worker.Substring($updateStart, $updateOnlyEnd - $updateStart)
Assert-True (
  ($updateOnlyBlock.Split(@('Get-SSEReceiptManagerState $toolHwnd $policy -WithValues'), [StringSplitOptions]::None).Count - 1) -eq 5
) 'receipt_manager_update darf Vollbaum-Readbacks nur fuer Ausgangsbindung, typisierte USt-Auswahl/Rollback, Detailbindung und Abschlusszustand verwenden.'

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
  'supportedExtensions',
  'Test-SSEReceiptManagerPdfHeader',
  "'unsupported-format'",
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
Assert-True ($importBlock.IndexOf('supportedExtensions') -lt $importBlock.IndexOf('Resolve-SSEMainWindowDescriptor')) 'Nicht unterstuetzte Belegformate muessen vor jeder UI-Bindung abgewiesen werden.'
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
  '$actualStartText',
  "gelesen '`$actualStartText'",
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
Assert-True ($readBlock.Contains('offeneBedingungen=@($openConditions)')) 'Beleglesung muss gerissene Sammelpostconditions einzeln und wertfrei diagnostizieren.'

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

Write-Output 'BelegManager: focusless Liste aktiv; neun historische Vordergrundpfade vor Dispatcher und UI blockiert.'
