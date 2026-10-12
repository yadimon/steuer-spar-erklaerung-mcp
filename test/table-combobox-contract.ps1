$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '..\powershell\table-combobox.ps1')

function Assert-True([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw $Message }
}

function Test-EmptyCheckerBinding {
  param([Parameter(Mandatory)][AllowEmptyCollection()][object[]]$CheckerMessagesBefore)
  @($CheckerMessagesBefore).Count
}

Assert-True ((Test-EmptyCheckerBinding -CheckerMessagesBefore @()) -eq 0) `
  'Windows PowerShell 5.1 lehnt eine leere Checker-Nachrichtenliste weiterhin ab.'
$stableWindows = [pscustomobject]@{ fingerprint='synthetic-stable-window-set' }
$boundAfter = [pscustomobject]@{ ok=$true; interference=$false; heading='Synthetic page'; rowCellCount=6 }
for ($mask=0; $mask -lt 16; $mask++) {
  $inputChanged = [bool]($mask -band 1); $windowChanged = [bool]($mask -band 2)
  $popupOpen = [bool]($mask -band 4); $cellInvalid = [bool]($mask -band 8)
  $observedTick = $(if ($inputChanged) { 11 } else { 10 })
  $afterWindows = [pscustomobject]@{ fingerprint=$(if ($windowChanged) { 'synthetic-changed-set' } else { $stableWindows.fingerprint }) }
  $afterState = $(if ($cellInvalid) { [pscustomobject]@{ ok=$false; interference=$true; error='Synthetic row is not visible' } } else { $boundAfter })
  $evidence = Get-SSETableComboInterferenceEvidence $true 10 $observedTick $stableWindows $afterWindows (-not $popupOpen) $afterState 100 3
  Assert-True ($evidence.interference -eq [bool]($inputChanged -or $windowChanged -or $popupOpen -or $cellInvalid)) 'Getrennte Ursachenevidenz veraenderte die bisherigen Guard-Bedingungen.'
  Assert-True ($evidence.inputEpoch.changed -eq $inputChanged -and $evidence.cellReadbackInvalid -eq $cellInvalid) 'Zell-/Fensterfehler wurde als Eingabewechsel gemeldet.'
}
$unreadableEpoch = Get-SSETableComboInterferenceEvidence $true 10 $null $stableWindows $stableWindows $true $boundAfter 100 3
Assert-True ($unreadableEpoch.interference -and -not $unreadableEpoch.inputEpoch.readable -and -not $unreadableEpoch.inputEpoch.changed) 'Unlesbare Epoche wurde freigegeben oder als bewiesene Fremdeingabe bezeichnet.'
$workerSource = [IO.File]::ReadAllText((Join-Path $PSScriptRoot '..\powershell\sse-worker.ps1'))
Assert-True ($workerSource.Contains('[Parameter(Mandatory)][AllowEmptyCollection()][object[]]$CheckerMessagesBefore')) `
  'Der produktive typed-Combo-Helfer erlaubt leere Checker-Nachrichtenlisten nicht explizit.'

$emptyArgs = '{"comboExpectedBefore":{"3":""}}' | ConvertFrom-Json
$emptyExpected = Get-SSETableComboExpectedBefore $emptyArgs 3
Assert-True $emptyExpected.present 'Leerer ComboBox-Vorwert wurde mit fehlender Property verwechselt.'
Assert-True ($emptyExpected.value -ceq '') 'Leerer ComboBox-Vorwert wurde veraendert.'
$missingExpected = Get-SSETableComboExpectedBefore $emptyArgs 4
Assert-True (-not $missingExpected.present) 'Tatsaechlich fehlende ComboBox-Spalte wurde als vorhanden gemeldet.'
$hashExpected = Get-SSETableComboExpectedBefore ([pscustomobject]@{ comboExpectedBefore=@{ '3'='' } }) 3
Assert-True ($hashExpected.present -and $hashExpected.value -ceq '') 'Leerer Hashtable-Vorwert wurde nicht portabel erkannt.'

$cell = [pscustomobject]@{
  i=99; p=10; type='DataItem'; name='Noch nicht zugeordnet'
  # Exakte AID-Form der zweiten Tabelle aus dem produktiven UIA-Snapshot.
  aid='Root/.grpEmpf13b./.grpEmpf13b.Empf13b'
  rid='cell-3'; x=300; y=100; w=220; h=40
}
$list = [pscustomobject]@{ i=0; p=-1; type='List'; name=''; aid='category-options'; rid='list-1'; x=300; y=140; w=260; h=180 }
$current = [pscustomobject]@{ i=1; p=0; type='ListItem'; name='Noch nicht zugeordnet'; aid='category-options.0'; rid='option-0'; x=300; y=145; w=260; h=35 }
$wanted = [pscustomobject]@{ i=2; p=0; type='ListItem'; name='Sonst. Leistung EU'; aid='category-options.1'; rid='option-1'; x=300; y=180; w=260; h=35 }
$other = [pscustomobject]@{ i=3; p=0; type='ListItem'; name='Waren EU'; aid='category-options.2'; rid='option-2'; x=300; y=215; w=260; h=35 }
$mainSource = [pscustomobject]@{
  hwnd=100; isMain=$true; isNewPopup=$false; window=$null
  tree=[pscustomobject]@{
    nodes=@($list,$current,$wanted,$other); stats=[pscustomobject]@{ truncated=$false; depthLimited=$false; err=0; cyc=0 }
  }
}
$tableBinding = [pscustomobject]@{
  known=$true; automationIdSection='grpEmpf13b'; aidBound=$true; aidFallback=$false
  observedScopePrefix='Root/.grpEmpf13b./.grpEmpf13b.'
}
$initialOpenState = [pscustomobject]@{
  ok=$true; heading='Innergem. Erwerb, § 13b UStG und Einfuhr'; value='Noch nicht zugeordnet'
  cell=$cell; region=[pscustomobject]@{ scopePrefix='Root/.grpEmpf13b./.grpEmpf13b.' }
  sumRead=[pscustomobject]@{ selected=[pscustomobject]@{ rid='sum-occurrence-2' } }
}
$freshOpenState = [pscustomobject]@{
  ok=$true; heading='Innergem. Erwerb, § 13b UStG und Einfuhr'; value='Noch nicht zugeordnet'
  cell=$cell.PSObject.Copy(); region=[pscustomobject]@{ scopePrefix='Root/.grpEmpf13b./.grpEmpf13b.' }
  sumRead=[pscustomobject]@{ selected=[pscustomobject]@{ rid='sum-occurrence-2' } }
}
$openBinding = Test-SSETableComboOpenFallbackBinding $initialOpenState $freshOpenState $tableBinding 'Noch nicht zugeordnet' 3 2
Assert-True $openBinding.ok 'Identische page+sum+scope+row+column+rid-Bindung wurde fuer den sichtbaren Open-Fallback abgelehnt.'
Assert-True ($openBinding.evidence.fresh.cellRid -eq 'cell-3' -and $openBinding.evidence.fresh.columnIndex -eq 3 -and $openBinding.evidence.expected.sumOccurrence -eq 2) 'Open-Fallback weist Summen-/RID-/Spaltenbeweis nicht aus.'
$staleOpenState = $freshOpenState.PSObject.Copy()
$staleOpenState.cell = $cell.PSObject.Copy()
$staleOpenState.cell.rid = 'foreign-cell'
$staleOpenBinding = Test-SSETableComboOpenFallbackBinding $initialOpenState $staleOpenState $tableBinding 'Noch nicht zugeordnet' 3 2
Assert-True (-not $staleOpenBinding.ok) 'Gewechselte Runtime-ID wurde vor dem Open-Fallback nicht fail-closed abgewiesen.'
Assert-True ($staleOpenBinding.reason -match 'cellRidSame' -and -not $staleOpenBinding.evidence.checks.cellRidSame) 'RID-Wechsel wird in reason/checks nicht diagnostiziert.'
Assert-True ($staleOpenBinding.evidence.initial.cellRid -eq 'cell-3' -and $staleOpenBinding.evidence.fresh.cellRid -eq 'foreign-cell') 'Initiale/frische Zellidentitaet ging in der Diagnose verloren.'
$aidFallbackBinding = [pscustomobject]@{
  known=$true; automationIdSection='grpEmpf13b'; aidBound=$false; aidFallback=$true; observedScopePrefix=$null
}
$aidFallbackInitial = $initialOpenState.PSObject.Copy()
$aidFallbackInitial.region = [pscustomobject]@{ scopePrefix=$null }
$aidFallbackFresh = $freshOpenState.PSObject.Copy()
$aidFallbackFresh.region = [pscustomobject]@{ scopePrefix=$null }
$aidFallbackOpen = Test-SSETableComboOpenFallbackBinding $aidFallbackInitial $aidFallbackFresh $aidFallbackBinding 'Noch nicht zugeordnet' 3 2
Assert-True ($aidFallbackOpen.ok -and $aidFallbackOpen.evidence.profileEvidence.method -eq 'initial+fresh-cell-automation-id-fragment') 'Leerer Regions-Scope mit exaktem initialen/frischen Zell-AID-Fragment wurde nicht profilgebunden akzeptiert.'
$costCategoryBinding = [pscustomobject]@{
  known=$true; automationIdSection='grpEmpf13b'; aidBound=$true; aidFallback=$false
  observedScopePrefix='Root/.grpEmpf13b./.grpEmpf13b.'
}
$costCategoryOpen = Test-SSETableComboOpenFallbackBinding $initialOpenState $freshOpenState $costCategoryBinding 'Noch nicht zugeordnet' 3 1
Assert-True ($costCategoryOpen.ok -and $costCategoryOpen.evidence.expected.sumOccurrence -eq 1) 'Wiederholte Kostenkategorie-§13b-Tabelle wurde am ersten Summenvorkommen nicht gebunden.'
$materialOccurrenceOne = $freshOpenState.PSObject.Copy()
$materialOccurrenceOne.cell = $cell.PSObject.Copy()
$materialOccurrenceOne.cell.aid = 'Root/.grp13bErwerb./.grp13bErwerb.IGErwerb'
$materialOccurrenceOne.region = [pscustomobject]@{ scopePrefix='Root/.grp13bErwerb./.grp13bErwerb.' }
$materialProfileMismatch = [pscustomobject]@{
  known=$true; automationIdSection='grpEmpf13b'; aidBound=$false; aidFallback=$false
  observedScopePrefix='Root/.grp13bErwerb./.grp13bErwerb.'
}
$materialOpen = Test-SSETableComboOpenFallbackBinding $materialOccurrenceOne $materialOccurrenceOne $materialProfileMismatch 'Noch nicht zugeordnet' 3 1
Assert-True (-not $materialOpen.ok -and -not $materialOpen.evidence.checks.profileEvidenceBound) 'Material-occurrence1 grp13bErwerb wurde als generische Kostenkategorie-§13b-Tabelle akzeptiert.'
$profiledEmptyRow = @(
  [pscustomobject]@{ x=10; w=100; name='' },
  [pscustomobject]@{ x=110; w=100; name='' },
  [pscustomobject]@{ x=210; w=180; name='' },
  [pscustomobject]@{ x=390; w=180; name='Sonst. Leistung EU' },
  [pscustomobject]@{ x=570; w=60; name='19' },
  [pscustomobject]@{ x=630; w=120; name='0,00' }
)
$emptyRowProfile = [pscustomobject]@{
  known=$true; bindingOk=$true
  columns=@([pscustomobject]@{ index=3; emptyRowDefault='Sonst. Leistung EU' })
}
Assert-True (Test-SSETableRowFreeWithProfileDefaults $profiledEmptyRow $emptyRowProfile) 'Profilierter Kategorie-/Steuersatz-/Nullbetrag-Default wurde nicht als eine freie Zeile erkannt.'
$realEuRow = @($profiledEmptyRow | ForEach-Object { $_.PSObject.Copy() })
$realEuRow[2].name = 'OpenAI Rechnung'
Assert-True (-not (Test-SSETableRowFreeWithProfileDefaults $realEuRow $emptyRowProfile)) 'Echte EU-Zeile mit Beschreibung wurde als frei erkannt.'
$differentCategoryRow = @($profiledEmptyRow | ForEach-Object { $_.PSObject.Copy() })
$differentCategoryRow[3].name = 'Werklieferung'
Assert-True (-not (Test-SSETableRowFreeWithProfileDefaults $differentCategoryRow $emptyRowProfile)) 'Abweichende Kategorie wurde als profilierter Leerzeilen-Default neutralisiert.'
$nonzeroRow = @($profiledEmptyRow | ForEach-Object { $_.PSObject.Copy() })
$nonzeroRow[5].name = '181,58'
Assert-True (-not (Test-SSETableRowFreeWithProfileDefaults $nonzeroRow $emptyRowProfile)) 'Nichtnullbetrag wurde als freie Zeile erkannt.'
Assert-True (-not (Test-SSETableRowFreeWithProfileDefaults $profiledEmptyRow ([pscustomobject]@{ known=$false; bindingOk=$true; columns=@() }))) 'Unprofilierte Tabelle neutralisierte den Kategorie-Default.'
Assert-True (-not (Test-SSETableRowFreeWithProfileDefaults $profiledEmptyRow ([pscustomobject]@{ known=$true; bindingOk=$false; columns=$emptyRowProfile.columns }))) 'Nicht gebundene Materialtabelle neutralisierte den Kategorie-Default.'
$catalog = Get-Content -LiteralPath (Join-Path $PSScriptRoot '..\profiles\2025\page-objects.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$secondTable = $catalog.pages.'gew.innergem_erwerb_13b_einfuhr'.tables.sonstige_leistung_eu
$confirmedProfile = [pscustomobject]@{
  known=$true; bindingOk=$true; aidBound=$true; columns=$secondTable.columns
  confirmedEmptyRowCategoryDefaults=$secondTable.confirmedEmptyRowCategoryDefaults
}
$confirmedArgs = [pscustomobject]@{ comboExpectedBefore=@{ '3'='Sonst. Leistung EU' } }
Assert-True (Test-SSETableRowFreeWithProfileDefaults $profiledEmptyRow $confirmedProfile $confirmedArgs) `
  'Exakt bestaetigter EU-Default in der zweiten profilierten leeren Tabelle wurde als belegt behandelt.'
Assert-True (-not (Test-SSETableRowFreeWithProfileDefaults $profiledEmptyRow $confirmedProfile)) 'Nicht bestaetigter EU-Default wurde neutralisiert.'
Assert-True (-not (Test-SSETableRowFreeWithProfileDefaults $nonzeroRow $confirmedProfile $confirmedArgs)) 'Bestaetigte Kategorie neutralisierte einen Betrag.'
Assert-True (-not (Test-SSETableRowFreeWithProfileDefaults $realEuRow $confirmedProfile $confirmedArgs)) 'Bestaetigte Kategorie neutralisierte eine Beschreibung.'
$datedRow = @($profiledEmptyRow | ForEach-Object { $_.PSObject.Copy() }); $datedRow[1].name='01.02.2025'
Assert-True (-not (Test-SSETableRowFreeWithProfileDefaults $datedRow $confirmedProfile $confirmedArgs)) 'Teilweise erfasste Datumszeile wurde als Anlegezeile behandelt.'
$valuedRow = @($profiledEmptyRow | ForEach-Object { $_.PSObject.Copy() })
$valuedRow[5] | Add-Member -NotePropertyName val -NotePropertyValue '1,00' -Force
Assert-True (-not (Test-SSETableRowFreeWithProfileDefaults $valuedRow $confirmedProfile $confirmedArgs)) 'Ein nichtleerer ValuePattern-Betrag wurde hinter dem Anzeigenamen verborgen.'
$wrongExpectedCategory = [pscustomobject]@{ comboExpectedBefore=@{ '3'='Sonst. Leistung Drittland' } }
Assert-True (-not (Test-SSETableRowFreeWithProfileDefaults $profiledEmptyRow $confirmedProfile $wrongExpectedCategory)) 'Abweichender Kategorien-Vorwert wurde akzeptiert.'
$unboundConfirmed = $confirmedProfile.PSObject.Copy(); $unboundConfirmed.aidBound=$false
Assert-True (-not (Test-SSETableRowFreeWithProfileDefaults $profiledEmptyRow $unboundConfirmed $confirmedArgs)) 'Unbelegter AID-Scope neutralisierte die Kategorie.'
$cellScopedProfile=$unboundConfirmed.PSObject.Copy()
$cellScopedProfile | Add-Member -NotePropertyName aidFallback -NotePropertyValue $true
$cellScopedProfile | Add-Member -NotePropertyName automationIdSection -NotePropertyValue 'grpEmpf13b'
$cellScopedEmptyRow=@(for ($i=0;$i -lt 6;$i++) {
  $node=$profiledEmptyRow[$i].PSObject.Copy()
  $node | Add-Member -NotePropertyName type -NotePropertyValue 'DataItem'
  $node | Add-Member -NotePropertyName aid -NotePropertyValue 'Synthetic/.grpEmpf13b./.grpEmpf13b.Empf13b'
  $node | Add-Member -NotePropertyName rid -NotePropertyValue "synthetic-default-cell-$i"
  $node
})
$publicExpected='{"comboExpectedBefore":{"3":"Sonst. Leistung EU"}}' | ConvertFrom-Json
Assert-True (Test-SSETableRowFreeWithProfileDefaults $cellScopedEmptyRow $cellScopedProfile $publicExpected) `
  'Exakte sechs Zell-AIDs plus JSON-Vorwert ersetzen den fehlenden Regions-Scope nicht beweiskraeftig.'
$tokens=$null; $errors=$null
$workerAst=[Management.Automation.Language.Parser]::ParseInput($workerSource,[ref]$tokens,[ref]$errors)
$resolver=@($workerAst.FindAll({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq 'Resolve-SSETableProfile'},$true))
Assert-True ($errors.Count -eq 0 -and $resolver.Count -eq 1) 'Produktiver Tabellenprofil-Resolver fehlt oder ist nicht parsebar.'
. ([scriptblock]::Create($resolver[0].Extent.Text))
function Get-SSEPageObjects { $catalog }
function Fail($Message,$Kind) { throw "$Kind`: $Message" }
$profileHeading=[string]$catalog.pages.'gew.innergem_erwerb_13b_einfuhr'.heading
$resolved=Resolve-SSETableProfile $profileHeading 'Summe' 2 ([pscustomobject]@{scopePrefix=$null})
Assert-True ($resolved.known -and $resolved.bindingOk -and $resolved.aidFallback -and -not $resolved.aidBound) `
  'Produktiver Resolver und echter Katalog liefern nicht den erwarteten Scope-freien Profilvertrag.'
Assert-True (Test-SSETableRowFreeWithProfileDefaults $cellScopedEmptyRow $resolved $publicExpected) `
  'Vom echten Resolver gebundener Default wird weiterhin als belegte Zeile behandelt.'
$wrongScope=Resolve-SSETableProfile $profileHeading 'Summe' 2 ([pscustomobject]@{scopePrefix='Synthetic/.other./.other.'})
Assert-True (-not (Test-SSETableRowFreeWithProfileDefaults $cellScopedEmptyRow $wrongScope $publicExpected)) `
  'Exakte Zell-AIDs ueberstimmten einen ausdruecklich widersprechenden Regions-Scope.'
foreach ($changedColumn in @(0,1,2,4,5)) {
  $changed=@($cellScopedEmptyRow | ForEach-Object { $_.PSObject.Copy() })
  $changed[$changedColumn].name='1'
  Assert-True (-not (Test-SSETableRowFreeWithProfileDefaults $changed $cellScopedProfile $publicExpected)) `
    'Zell-AID-Bindung neutralisierte eine nichtleere Nummer/Datum/Bezeichnung, falschen Satz oder einen Betrag.'
}
foreach ($badCell in @(0,3,5)) {
  $changed=@($cellScopedEmptyRow | ForEach-Object { $_.PSObject.Copy() })
  $changed[$badCell].aid='Synthetic/.grpEmpf13bX./.grpEmpf13bX.Empf13b'
  $evidence=Get-SSETableRowDefaultEvidence $changed $cellScopedProfile $publicExpected
  Assert-True (-not $evidence.free -and -not $evidence.checks.aidBound) 'Einzelne fremde Zell-AID wurde als exakter Scope akzeptiert.'
}
$duplicated=@($cellScopedEmptyRow | ForEach-Object { $_.PSObject.Copy() }); $duplicated[5].rid=$duplicated[4].rid
Assert-True (-not (Test-SSETableRowFreeWithProfileDefaults $duplicated $cellScopedProfile $publicExpected)) 'Doppelte Zell-RID neutralisierte die Anlegezeile.'
$evidence=Get-SSETableRowDefaultEvidence $cellScopedEmptyRow $cellScopedProfile $wrongExpectedCategory
Assert-True (-not $evidence.free -and -not $evidence.checks.categoryMatches) 'Vorwertabweichung wird nicht getrennt diagnostiziert.'
$semanticProfile=$confirmedProfile.PSObject.Copy()
$semanticProfile | Add-Member -NotePropertyName automationIdSection -NotePropertyValue 'grpEmpf13b'
$semanticProfile | Add-Member -NotePropertyName observedScopePrefix -NotePropertyValue 'Root/.grpEmpf13b./.grpEmpf13b.'
$semanticBeforeRow=@(0..5 | ForEach-Object {
  [pscustomobject]@{ i=1+$_;p=0;on=$true;x=100 + 100 * $_; y=200; w=90; h=24; type='DataItem'; rid="before-$_"
    aid='Root/.grpEmpf13b./.grpEmpf13b.Empf13b'; name=@('','','','Sonst. Leistung EU','19','0,00')[$_]; val='' }
})
$semanticTable=[pscustomobject]@{i=0;p=-1;on=$true;type='Table';rid='synthetic-table';aid='Root/.grpEmpf13b./.grpEmpf13b.Empf13b';x=100;y=160;w=600;h=120}
$semanticAfterRow=@($semanticBeforeRow | ForEach-Object { $_.PSObject.Copy() })
for ($column=0; $column -lt 6; $column++) { $semanticAfterRow[$column].y=160; $semanticAfterRow[$column].rid="after-$column" }
$semanticAfterRow[0].name='7'; $semanticAfterRow[3].name='Sonst. Leistung Drittland'
$semanticSum=[pscustomobject]@{ value='12,34'; selected=[pscustomobject]@{ aid='Root/.grpEmpf13b./.grpEmpf13b.SummeTab.Wert' } }
$semanticInitial=[pscustomobject]@{ ok=$true; heading='Synthetic page'; sumRead=$semanticSum; rowCells=$semanticBeforeRow
  region=[pscustomobject]@{ ok=$true; scopePrefix=$semanticProfile.observedScopePrefix; cells=$semanticBeforeRow } }
$semanticFresh=[pscustomobject]@{ ok=$false; interference=$true; heading='Synthetic page'; sumRead=$semanticSum
  tree=[pscustomobject]@{ nodes=$semanticAfterRow; stats=[pscustomobject]@{ truncated=$false; depthLimited=$false; err=0; cyc=0 } }
  region=[pscustomobject]@{ ok=$true; scopePrefix=$semanticProfile.observedScopePrefix; cells=$semanticAfterRow } }
$semanticProof=Resolve-SSETableComboSelectedRow $semanticInitial $semanticFresh $semanticProfile 'Sonst. Leistung EU' 'Sonst. Leistung Drittland' 3
Assert-True ($semanticProof.ok -and $semanticProof.rowY -eq 160 -and $semanticProof.assignedNumber) 'Exakte verschobene und nummerierte Kategoriezeile wurde nicht frisch gebunden.'
$scopeFreeInitial=$semanticInitial.PSObject.Copy(); $scopeFreeInitial.region=$semanticInitial.region.PSObject.Copy()
$scopeFreeInitial.region.scopePrefix=''
$scopeFreeFresh=$semanticFresh.PSObject.Copy(); $scopeFreeFresh.region=$semanticFresh.region.PSObject.Copy()
$scopeFreeFresh.region.scopePrefix=''
Assert-True (Resolve-SSETableComboSelectedRow $scopeFreeInitial $scopeFreeFresh $resolved 'Sonst. Leistung EU' 'Sonst. Leistung Drittland' 3).ok `
  'Complete exact-cell scope proof was discarded after a shifted typed selection.'
$unnumberedShiftedRow=@($semanticBeforeRow | ForEach-Object { $copy=$_.PSObject.Copy(); $copy.y=185; $copy })
$unnumberedShiftedRow[3].name='Sonst. Leistung Drittland'
$followingDefaultRow=@($semanticBeforeRow | ForEach-Object { $copy=$_.PSObject.Copy(); $copy.y=218; $copy.rid='new-default-'+$copy.rid; $copy })
$unnumberedShiftedFresh=$scopeFreeFresh.PSObject.Copy(); $unnumberedShiftedFresh.region=$scopeFreeFresh.region.PSObject.Copy()
$unnumberedShiftedFresh.region.cells=@($unnumberedShiftedRow)+@($followingDefaultRow)
$unnumberedShiftedProof=Resolve-SSETableComboSelectedRow $scopeFreeInitial $unnumberedShiftedFresh $resolved 'Sonst. Leistung EU' 'Sonst. Leistung Drittland' 3
Assert-True ($unnumberedShiftedProof.ok -and $unnumberedShiftedProof.rowY -eq 185 -and -not $unnumberedShiftedProof.assignedNumber -and
  @($unnumberedShiftedProof.row).Count -eq 6 -and (@($unnumberedShiftedProof.row.rid) -join ',') -ceq (@($semanticBeforeRow.rid) -join ',')) `
  'A unique six-cell row shifted by the new default row required a new number despite unchanged empty number and cell identities.'
$secondUnnumberedRow=@($unnumberedShiftedRow | ForEach-Object { $copy=$_.PSObject.Copy(); $copy.y=152; $copy.rid='duplicate-'+$copy.rid; $copy })
$unnumberedDuplicate=$unnumberedShiftedFresh.PSObject.Copy(); $unnumberedDuplicate.region=$unnumberedShiftedFresh.region.PSObject.Copy()
$unnumberedDuplicate.region.cells=@($unnumberedShiftedRow)+@($secondUnnumberedRow)+@($followingDefaultRow)
Assert-True (-not (Resolve-SSETableComboSelectedRow $scopeFreeInitial $unnumberedDuplicate $resolved 'Sonst. Leistung EU' 'Sonst. Leistung Drittland' 3).ok) `
  'Identical unnumbered category-only rows were guessed instead of rejecting the ambiguous full-row proof.'
$scopeFreeWrong=$scopeFreeFresh.PSObject.Copy(); $scopeFreeWrong.region=$scopeFreeFresh.region.PSObject.Copy()
$scopeFreeWrong.region.cells=@($semanticAfterRow | ForEach-Object { $_.PSObject.Copy() })
$scopeFreeWrong.region.cells[4].aid='Root/.grpEmpf13bX./.grpEmpf13bX.Empf13b'
Assert-True (-not (Resolve-SSETableComboSelectedRow $scopeFreeInitial $scopeFreeWrong $resolved 'Sonst. Leistung EU' 'Sonst. Leistung Drittland' 3).ok) `
  'A mismatched full-row cell aid was accepted after a scope-free selection.'
$noopState=$scopeFreeInitial.PSObject.Copy()
$noopState | Add-Member -NotePropertyName tree -NotePropertyValue ([pscustomobject]@{nodes=@($semanticTable)+@($semanticBeforeRow);stats=$semanticFresh.tree.stats})
$noopState | Add-Member -NotePropertyName cell -NotePropertyValue $semanticBeforeRow[3]
$noopState | Add-Member -NotePropertyName value -NotePropertyValue 'Sonst. Leistung EU'
$noopState | Add-Member -NotePropertyName rowCellCount -NotePropertyValue 6
$noopState | Add-Member -NotePropertyName checkerMessages -NotePropertyValue @()
$noopState.sumRead=$semanticSum.PSObject.Copy(); $noopState.sumRead.selected=$semanticSum.selected.PSObject.Copy()
$noopState.sumRead.selected | Add-Member -NotePropertyName rid -NotePropertyValue 'synthetic-noop-summary'
$noopProof=Resolve-SSETableComboNoopRow $noopState $resolved 'Sonst. Leistung EU' 3
Assert-True ($noopProof.ok -and @($noopProof.row).Count -eq 6) 'Already-target no-op lost its six-cell row source.'
$noopDuplicate=$noopState.PSObject.Copy(); $noopDuplicate.rowCells=@($semanticBeforeRow | ForEach-Object { $_.PSObject.Copy() })
$noopDuplicate.rowCells[0].rid=$noopDuplicate.rowCells[1].rid
Assert-True (-not (Resolve-SSETableComboNoopRow $noopDuplicate $resolved 'Sonst. Leistung EU' 3).ok) 'No-op accepted duplicate cell identities.'
$invokeFunction=@($workerAst.FindAll({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq 'Invoke-SSETableComboSelection'},$true))
Assert-True ($invokeFunction.Count -eq 1) 'Productive typed selector is missing.'
. ([scriptblock]::Create($invokeFunction[0].Extent.Text))
function Read-SSETableComboCellState { $noopState }
function Get-SSETableLiveInputState { [pscustomobject]@{ok=$true;editorClosed=$true} }
$noopResult=Invoke-SSETableComboSelection -Hwnd ([IntPtr]100) -ProcessId 7 -ExpectedPage 'Synthetic page' `
  -SumLabel 'Summe' -SumOccurrence 2 -RowY 200 -ColumnIndex 3 -TableProfile $resolved -ColumnProfile $resolved.columns[0] `
  -ExpectedCurrent 'Sonst. Leistung EU' -Wanted 'Sonst. Leistung EU' -CheckerMessagesBefore @() -InputBaseline 10
Assert-True ($noopResult.ok -and -not $noopResult.mutationStarted -and @($noopResult.rowAfter).Count -eq 6) `
  'Productive no-op return omitted rowAfter, causing the PowerShell @($null).Count=1 rebinding failure.'
$closedNoopState=$noopState
$noopState=$closedNoopState.PSObject.Copy();$noopState.tree=$closedNoopState.tree.PSObject.Copy()
$noopState.tree.nodes+=@([pscustomobject]@{i=7;p=0;on=$true;type='ComboBox';rid='synthetic-active-editor';aid=$semanticTable.aid+'.Delegate';x=400;y=200;w=90;h=24})
$activeNoop=Invoke-SSETableComboSelection -Hwnd ([IntPtr]100) -ProcessId 7 -ExpectedPage 'Synthetic page' `
  -SumLabel 'Summe' -SumOccurrence 2 -RowY 200 -ColumnIndex 3 -TableProfile $resolved -ColumnProfile $resolved.columns[0] `
  -ExpectedCurrent 'Sonst. Leistung EU' -Wanted 'Sonst. Leistung EU' -CheckerMessagesBefore @() -InputBaseline 10
Assert-True (-not $activeNoop.ok -and -not $activeNoop.mutationStarted -and -not $activeNoop.editorClosed) `
  'An already-target value claimed editor closure while a category delegate remained active.'
$noopState=$closedNoopState
$bindFunction=@($workerAst.FindAll({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq 'Bind-SSEPreparedTableRowAfterCombo'},$true))
. ([scriptblock]::Create($bindFunction[0].Extent.Text))
$preparedCombo=[pscustomobject]@{spalte=3;mode='combo';cell=$semanticBeforeRow[3];rowY=200}
Assert-True (Bind-SSEPreparedTableRowAfterCombo ([IntPtr]100) @($preparedCombo) $noopResult.rowAfter).ok `
  'Actual already-target selector and subsequent rebinder do not share the complete row contract.'
$updateInitial=@($semanticBeforeRow | ForEach-Object { $_.PSObject.Copy() }); $updateInitial[3].name='Sonst. Leistung Drittland'
$sameCategoryPopulated=@($updateInitial | ForEach-Object { $copy=$_.PSObject.Copy(); $copy.y=120; $copy.rid='other-'+$copy.rid; $copy })
$sameCategoryPopulated[0].name='2'; $sameCategoryPopulated[2].name='Synthetic other receipt'; $sameCategoryPopulated[5].name='10,00'
$freshUpdateRow=@($updateInitial | ForEach-Object { $copy=$_.PSObject.Copy(); $copy.y=160; $copy.rid='fresh-'+$copy.rid; $copy })
$freshUpdateRegion=[pscustomobject]@{ok=$true;cells=@($sameCategoryPopulated)+@($freshUpdateRow)}
$focusRow=Resolve-SSETableUpdateFocusRow $updateInitial[3] $updateInitial $freshUpdateRegion
Assert-True ($focusRow.ok -and $focusRow.row.Count -eq 6 -and $focusRow.target.rid -ceq 'fresh-before-3') `
  'Repeated category text prevented a unique full-row target/column binding after RID changes.'
$duplicateUpdate=@($freshUpdateRow | ForEach-Object { $copy=$_.PSObject.Copy(); $copy.y=80; $copy.rid='duplicate-'+$copy.rid; $copy })
Assert-True (-not (Resolve-SSETableUpdateFocusRow $updateInitial[3] $updateInitial ([pscustomobject]@{ok=$true;cells=@($freshUpdateRow)+@($duplicateUpdate)})).ok) `
  'Identical complete row duplicates were guessed after focus acquisition.'
$changedUpdate=@($freshUpdateRow | ForEach-Object { $_.PSObject.Copy() }); $changedUpdate[5].name='1,00'
Assert-True (-not (Resolve-SSETableUpdateFocusRow $updateInitial[3] $updateInitial ([pscustomobject]@{ok=$true;cells=$changedUpdate})).ok) `
  'A changed amount was accepted while rebinding the complete initial target row.'
$semanticMutated=$semanticFresh.PSObject.Copy(); $semanticMutated.region=$semanticFresh.region.PSObject.Copy()
$semanticMutated.region.cells=@($semanticAfterRow | ForEach-Object { $_.PSObject.Copy() }); $semanticMutated.region.cells[2].name='Unexpected description'
Assert-True (-not (Resolve-SSETableComboSelectedRow $semanticInitial $semanticMutated $semanticProfile 'Sonst. Leistung EU' 'Sonst. Leistung Drittland' 3).ok) 'Eine geaenderte uebrige Zelle wurde bei semantischer Neubindung akzeptiert.'
$semanticDuplicate=$semanticFresh.PSObject.Copy(); $semanticDuplicate.region=$semanticFresh.region.PSObject.Copy()
$secondSemanticRow=@($semanticAfterRow | ForEach-Object { $copy=$_.PSObject.Copy(); $copy.y=120; $copy })
$semanticDuplicate.region.cells=@($semanticAfterRow)+@($secondSemanticRow)
Assert-True (-not (Resolve-SSETableComboSelectedRow $semanticInitial $semanticDuplicate $semanticProfile 'Sonst. Leistung EU' 'Sonst. Leistung Drittland' 3).ok) 'Doppelte Kategoriezeilen wurden semantisch mehrdeutig gebunden.'
$semanticTruncated=$semanticFresh.PSObject.Copy(); $semanticTruncated.tree=$semanticFresh.tree.PSObject.Copy()
$semanticTruncated.tree.stats=[pscustomobject]@{ truncated=$true; depthLimited=$false; err=0; cyc=0 }
Assert-True (-not (Resolve-SSETableComboSelectedRow $semanticInitial $semanticTruncated $semanticProfile 'Sonst. Leistung EU' 'Sonst. Leistung Drittland' 3).ok) 'Abgeschnittener Zellbestand erlaubte semantische Neubindung.'
$semanticInvalidNumber=$semanticFresh.PSObject.Copy(); $semanticInvalidNumber.region=$semanticFresh.region.PSObject.Copy()
$semanticInvalidNumber.region.cells=@($semanticAfterRow | ForEach-Object { $_.PSObject.Copy() }); $semanticInvalidNumber.region.cells[0].name='unknown'
Assert-True (-not (Resolve-SSETableComboSelectedRow $semanticInitial $semanticInvalidNumber $semanticProfile 'Sonst. Leistung EU' 'Sonst. Leistung Drittland' 3).ok) 'Unbewiesene neue Datensatznummer wurde als materialisierte Zeile akzeptiert.'
$semanticNonpositiveNumber=$semanticFresh.PSObject.Copy(); $semanticNonpositiveNumber.region=$semanticFresh.region.PSObject.Copy()
$semanticNonpositiveNumber.region.cells=@($semanticAfterRow | ForEach-Object { $_.PSObject.Copy() }); $semanticNonpositiveNumber.region.cells[0].name='0'
Assert-True (-not (Resolve-SSETableComboSelectedRow $semanticInitial $semanticNonpositiveNumber $semanticProfile 'Sonst. Leistung EU' 'Sonst. Leistung Drittland' 3).ok) 'A changed nonpositive number was accepted as newly assigned.'
$otherNumberedRow=@($semanticAfterRow | ForEach-Object { $copy=$_.PSObject.Copy(); $copy.y=120; $copy.rid='other-number-'+$copy.rid; $copy })
$otherNumberedRow[2].name='Synthetic unrelated row'
$semanticFreshNumberDuplicate=$semanticFresh.PSObject.Copy(); $semanticFreshNumberDuplicate.region=$semanticFresh.region.PSObject.Copy()
$semanticFreshNumberDuplicate.region.cells=@($semanticAfterRow)+@($otherNumberedRow)
Assert-True (-not (Resolve-SSETableComboSelectedRow $semanticInitial $semanticFreshNumberDuplicate $semanticProfile 'Sonst. Leistung EU' 'Sonst. Leistung Drittland' 3).ok) `
  'A newly assigned positive number also present on a different fresh row was accepted as unique.'
$semanticRepeatedRid=$semanticFresh.PSObject.Copy(); $semanticRepeatedRid.region=$semanticFresh.region.PSObject.Copy()
$semanticRepeatedRid.region.cells=@($semanticAfterRow | ForEach-Object { $_.PSObject.Copy() }); $semanticRepeatedRid.region.cells[1].rid=$semanticRepeatedRid.region.cells[0].rid
Assert-True (-not (Resolve-SSETableComboSelectedRow $semanticInitial $semanticRepeatedRid $semanticProfile 'Sonst. Leistung EU' 'Sonst. Leistung Drittland' 3).ok) 'Mehrdeutige frische Zellidentitaeten wurden als sechs unabhängige Zellen gebunden.'
$semanticExistingNumber=$semanticInitial.PSObject.Copy(); $semanticExistingNumber.region=$semanticInitial.region.PSObject.Copy()
$oldNumberedRow=@($semanticBeforeRow | ForEach-Object { $copy=$_.PSObject.Copy(); $copy.y=120; $copy }); $oldNumberedRow[0].name='7'
$semanticExistingNumber.region.cells=@($oldNumberedRow)+@($semanticBeforeRow)
Assert-True (-not (Resolve-SSETableComboSelectedRow $semanticExistingNumber $semanticFresh $semanticProfile 'Sonst. Leistung EU' 'Sonst. Leistung Drittland' 3).ok) 'Eine bereits vorhandene Datensatznummer wurde als neu materialisierte Anlegezeile verwendet.'
$semanticUpdateInitial=$semanticInitial.PSObject.Copy(); $semanticUpdateInitial.region=$semanticInitial.region.PSObject.Copy()
$semanticUpdateInitial.rowCells=@($semanticBeforeRow | ForEach-Object { $_.PSObject.Copy() })
$semanticUpdateInitial.rowCells[0].name='2'; $semanticUpdateInitial.rowCells[1].name='02.02.2025'; $semanticUpdateInitial.rowCells[2].name='Synthetic existing row'; $semanticUpdateInitial.rowCells[5].name='10,00'
$semanticUpdateInitial.region.cells=$semanticUpdateInitial.rowCells
$semanticUpdateFresh=$semanticFresh.PSObject.Copy(); $semanticUpdateFresh.region=$semanticFresh.region.PSObject.Copy()
$semanticUpdateFresh.region.cells=@($semanticUpdateInitial.rowCells | ForEach-Object { $copy=$_.PSObject.Copy(); $copy.y=160; $copy })
$semanticUpdateFresh.region.cells[3].name='Sonst. Leistung Drittland'
Assert-True (Resolve-SSETableComboSelectedRow $semanticUpdateInitial $semanticUpdateFresh $semanticProfile 'Sonst. Leistung EU' 'Sonst. Leistung Drittland' 3).ok 'Eine vollstaendige geaenderte Kategoriezeile mit unveraenderten uebrigen Werten wurde nicht frisch gebunden.'
$semanticUpdateFresh.region.cells[0].name='3'
Assert-True (-not (Resolve-SSETableComboSelectedRow $semanticUpdateInitial $semanticUpdateFresh $semanticProfile 'Sonst. Leistung EU' 'Sonst. Leistung Drittland' 3).ok) 'Bestehender Datensatz durfte waehrend der Neubindung seine Zeilennummer wechseln.'
$nearAidFresh = $aidFallbackFresh.PSObject.Copy()
$nearAidFresh.cell = $cell.PSObject.Copy()
$nearAidFresh.cell.aid = 'Root/.grpEmpf13bX./.grpEmpf13bX.Empf13b'
$nearAidOpen = Test-SSETableComboOpenFallbackBinding $aidFallbackInitial $nearAidFresh $aidFallbackBinding 'Noch nicht zugeordnet' 3 2
Assert-True (-not $nearAidOpen.ok -and -not $nearAidOpen.evidence.checks.profileEvidenceBound) 'AID-Nahmatch wurde als exaktes doppeltes Profilfragment akzeptiert.'
$nextCell = [pscustomobject]@{ x=520; y=100; w=100; h=40 }
$arrowPoint = Get-SSETableComboDropArrowPoint $cell $nextCell
Assert-True ($arrowPoint.ok -and $arrowPoint.x -eq 508 -and $arrowPoint.y -eq 120 -and $arrowPoint.inset -eq 12) 'Drop-Arrow-Hotspot wurde nicht deterministisch aus der rechten Zellkante abgeleitet.'
Assert-True ($arrowPoint.x -gt $cell.x -and $arrowPoint.x -lt ($cell.x + $cell.w) -and $arrowPoint.x -lt $nextCell.x) 'Drop-Arrow-Hotspot liegt nicht innerhalb der Zelle vor der naechsten Spalte.'
$overlappingNext = [pscustomobject]@{ x=505; y=100; w=100; h=40 }
$unsafeArrowPoint = Get-SSETableComboDropArrowPoint $cell $overlappingNext
Assert-True (-not $unsafeArrowPoint.ok -and $unsafeArrowPoint.reason -eq 'point-not-before-next-column') 'Hotspot an/unter der naechsten Spalte wurde nicht fail-closed abgewiesen.'
$diagnosticOptions = @(0..79 | ForEach-Object { "Option-$_" })
$diagnostic = Get-SSETableComboDiagnosticProjection ([pscustomobject]@{
  ok=$false; error=('x' * 3000); mutationStarted=$false; interference=$false; editorClosed=$false
  openEvidence=[pscustomobject]@{ invokeAttempted=$true; verifiedPointAttempted=$true }
  interferenceEvidence=(Get-SSETableComboInterferenceEvidence $true 10 10 $stableWindows $stableWindows $true ([pscustomobject]@{ ok=$false; interference=$true; error='Synthetic row is not visible' }) 100 3)
  popupBinding=[pscustomobject]@{
    ok=$false; kind='option-binding-not-found'; error='Keine exakte Liste.'
    candidates=@([pscustomobject]@{ sourceHwnd=100; options=$diagnosticOptions })
  }
})
Assert-True ($diagnostic.kind -eq 'option-binding-not-found' -and -not $diagnostic.mutationStarted -and -not $diagnostic.interference) 'ComboBox-Fehlerart/-zustand wurde nicht projiziert.'
Assert-True ($diagnostic.error.Length -le 2060 -and $diagnostic.popupBinding.candidates[0].options.Count -eq 65) 'ComboBox-Diagnose wurde nicht reproduzierbar begrenzt.'
Assert-True ($diagnostic.openEvidence.verifiedPointAttempted -and $diagnostic.editorClosed -eq $false) 'Open-/Editor-Diagnose ging bei der Projektion verloren.'
Assert-True ($diagnostic.interferenceEvidence.cellReadbackInvalid -and -not $diagnostic.interferenceEvidence.inputEpoch.changed) 'Getrennte Ursachenevidenz ging bei der begrenzten Projektion verloren.'

$bound = Resolve-SSETableComboPopup @($mainSource) $cell 'Sonst. Leistung EU' 'Noch nicht zugeordnet' $tableBinding
Assert-True $bound.ok 'Exakt zellgebundene Hauptbaum-Liste wurde nicht akzeptiert.'
Assert-True ($bound.target.rid -eq 'option-1') 'Zieloption wurde nicht exakt gebunden.'
Assert-True ($bound.rollback.rid -eq 'option-0') 'Ausgangsoption wurde nicht fuer Rollback gebunden.'
Assert-True ($bound.binding.profileEvidence -eq 'summary-region-scope-prefix') 'Echter grpEmpf13b-Snapshot wurde nicht ueber die Summenregion gebunden.'
Assert-True ($bound.binding.observedScopePrefix -ceq 'Root/.grpEmpf13b./.grpEmpf13b.') 'Echter grpEmpf13b-Scope wurde nicht unveraendert ausgewiesen.'
Assert-True ($bound.binding.source -eq 'main-tree') 'Quellbindung der Optionsliste ist falsch.'
Assert-True ($bound.sourceDiagnostics[0].captureComplete -and $bound.sourceDiagnostics[0].lists[0].attachedToCell) `
  'Vollstaendige Capture- und zellgebundene Listengeometrie wurden nicht diagnostiziert.'
$truncatedSource = $mainSource.PSObject.Copy()
$truncatedSource.tree = $mainSource.tree.PSObject.Copy()
$truncatedSource.tree.stats = [pscustomobject]@{ truncated=$true; depthLimited=$false; err=0; cyc=0 }
$truncatedPopup = Resolve-SSETableComboPopup @($truncatedSource) $cell 'Sonst. Leistung EU' 'Noch nicht zugeordnet' $tableBinding
Assert-True (-not $truncatedPopup.ok -and $truncatedPopup.kind -eq 'popup-snapshot-incomplete') `
  'Eine sichtbare Ziel-/Vorwert-Teilliste im abgeschnittenen Baum wurde als eindeutige Optionsliste akzeptiert.'
Assert-True $truncatedPopup.sourceDiagnostics[0].truncated 'Abgeschnittener Capture verschwand aus der Diagnose.'
$failedCapture = [pscustomobject]@{ hwnd=200; isMain=$false; isNewPopup=$true; tree=$null; captureError='Synthetic capture failure' }
$incompleteMixed = Resolve-SSETableComboPopup @($mainSource,$failedCapture) $cell 'Sonst. Leistung EU' 'Noch nicht zugeordnet' $tableBinding
Assert-True (-not $incompleteMixed.ok -and $incompleteMixed.kind -eq 'popup-snapshot-incomplete') `
  'Ein nicht lesbares zweites Popup liess einen scheinbar eindeutigen Hauptbaum-Erfolg zu.'
Assert-True ($incompleteMixed.sourceDiagnostics[1].captureError -ceq 'Synthetic capture failure') 'Capture-Ausnahme wurde verschluckt.'
$unknownCapture = $mainSource.PSObject.Copy()
$unknownCapture.tree = [pscustomobject]@{ nodes=$mainSource.tree.nodes }
$unknownPopup = Resolve-SSETableComboPopup @($unknownCapture) $cell 'Sonst. Leistung EU' 'Noch nicht zugeordnet' $tableBinding
Assert-True (-not $unknownPopup.ok -and -not $unknownPopup.sourceDiagnostics[0].statsPresent) `
  'Fehlende Capture-Statistik wurde als vollstaendiger Baum ausgegeben.'
$depthLimitedSource = $mainSource.PSObject.Copy()
$depthLimitedSource.tree = $mainSource.tree.PSObject.Copy()
$depthLimitedSource.tree.stats = [pscustomobject]@{ truncated=$false; depthLimited=$true; err=0; cyc=0 }
$depthLimitedPopup = Resolve-SSETableComboPopup @($depthLimitedSource) $cell 'Sonst. Leistung EU' 'Noch nicht zugeordnet' $tableBinding
Assert-True (-not $depthLimitedPopup.ok -and $depthLimitedPopup.sourceDiagnostics[0].depthLimited) 'Tiefenbegrenztes Popup wurde akzeptiert.'

$viewport = [pscustomobject]@{ i=10; p=-1; rid='table-1'; type='Table'; x=200; y=80; w=500; h=55 }
$viewportRegion = [pscustomobject]@{ targetSumY=150; scopePrefix='Root/.grpEmpf13b./.grpEmpf13b.'; cells=@($cell) }
$viewportEvidence = Get-SSETableComboViewportEvidence ([pscustomobject]@{ nodes=@($viewport,$cell) }) $cell $viewportRegion
Assert-True ($viewportEvidence.known -and -not $viewportEvidence.cellFullyContained -and $viewportEvidence.cellCenterInside) `
  'Partiell abgeschnittene Zelle wurde nicht vom innerhalb liegenden Zellmittelpunkt unterschieden.'
Assert-True ($viewportEvidence.tableRectangle.h -eq 55 -and $viewportEvidence.targetSumY -eq 150) 'Gebundene Geometrie ging verloren.'
$noViewportEvidence = Get-SSETableComboViewportEvidence $mainSource.tree $cell $viewportRegion
Assert-True (-not $noViewportEvidence.known -and $null -eq $noViewportEvidence.cellFullyContained) `
  'Nicht nachgewiesener Tabellen-Vorfahre wurde als sichtbarer Viewport erfunden.'
$duplicateViewport = $viewport.PSObject.Copy()
$ambiguousViewport = Get-SSETableComboViewportEvidence ([pscustomobject]@{ nodes=@($viewport,$duplicateViewport,$cell) }) $cell $viewportRegion
Assert-True (-not $ambiguousViewport.known) 'Mehrdeutige Vorfahren-Identitaet wurde fuer Viewport-Diagnose verwendet.'
Assert-True (Test-SSETableComboPopupBindingEquivalent $bound $bound) 'Identische Popup-/ListItem-Bindung wurde nicht erkannt.'
$changedPopupBinding = $bound.PSObject.Copy()
$changedPopupBinding.target = $bound.target.PSObject.Copy()
$changedPopupBinding.target.rid = 'foreign-option'
Assert-True (-not (Test-SSETableComboPopupBindingEquivalent $bound $changedPopupBinding)) 'Gewechselte Zieloption wurde als identische Popup-Bindung akzeptiert.'
Assert-True (Test-SSETableComboBoundListPresent @($mainSource) $bound) 'Exakt gebundene Optionsliste wurde im Quellbaum nicht erkannt.'
$closedPopupSource = [pscustomobject]@{
  hwnd=100; isMain=$true; isNewPopup=$false; window=$null
  tree=[pscustomobject]@{ nodes=@($current,$wanted,$other) }
}
Assert-True (-not (Test-SSETableComboBoundListPresent @($closedPopupSource) $bound)) 'Verschwundene gebundene Liste wurde als offen gemeldet.'

$unrelatedList = [pscustomobject]@{ i=0; p=-1; type='List'; name=''; aid='other-options'; rid='list-x'; x=900; y=140; w=260; h=180 }
$unrelatedSource = [pscustomobject]@{
  hwnd=100; isMain=$true; isNewPopup=$false; window=$null
  tree=[pscustomobject]@{ nodes=@($unrelatedList,$current,$wanted,$other); stats=$mainSource.tree.stats }
}
$unrelated = Resolve-SSETableComboPopup @($unrelatedSource) $cell 'Sonst. Leistung EU' 'Noch nicht zugeordnet' $tableBinding
Assert-True (-not $unrelated.ok) 'Geometrisch fremde Liste wurde faelschlich akzeptiert.'

$duplicateWanted = [pscustomobject]@{ i=4; p=0; type='ListItem'; name='Sonst. Leistung EU'; aid='category-options.3'; rid='option-3'; x=300; y=250; w=260; h=35 }
$duplicateSource = [pscustomobject]@{
  hwnd=100; isMain=$true; isNewPopup=$false; window=$null
  tree=[pscustomobject]@{ nodes=@($list,$current,$wanted,$other,$duplicateWanted); stats=$mainSource.tree.stats }
}
$ambiguous = Resolve-SSETableComboPopup @($duplicateSource) $cell 'Sonst. Leistung EU' 'Noch nicht zugeordnet' $tableBinding
Assert-True (-not $ambiguous.ok -and $ambiguous.kind -eq 'option-binding-not-found') 'Doppelte Zieloption wurde nicht fail-closed abgewiesen.'

$wrongCell = $cell.PSObject.Copy()
$wrongCell.aid = 'Root/.AndereTabelle./.AndereTabelle.Tab.Kategorie'
$profileMismatch = Resolve-SSETableComboPopup @($mainSource) $wrongCell 'Sonst. Leistung EU' 'Noch nicht zugeordnet' ([pscustomobject]@{
  known=$true; automationIdSection='grpEmpf13b'; aidBound=$false; aidFallback=$false; observedScopePrefix=$null
})
Assert-True (-not $profileMismatch.ok -and $profileMismatch.kind -eq 'profile-binding-mismatch') 'Ungebundene Tabellenregion und fremde Zell-AID wurden nicht abgewiesen.'

$genericCell = $cell.PSObject.Copy()
$genericCell.aid = 'QtTable.DataItem.Column3'
$regionBound = Resolve-SSETableComboPopup @($mainSource) $genericCell 'Sonst. Leistung EU' 'Noch nicht zugeordnet' $tableBinding
Assert-True $regionBound.ok 'Generische DataItem-AID wurde trotz exakt profilgebundener Summenregion abgewiesen.'
Assert-True ($regionBound.binding.profileEvidence -eq 'summary-region-scope-prefix') 'Runtime-Regionsbeweis wurde nicht ausgewiesen.'
$cellFallbackBound = Resolve-SSETableComboPopup @($mainSource) $cell 'Sonst. Leistung EU' 'Noch nicht zugeordnet' $aidFallbackBinding
Assert-True ($cellFallbackBound.ok -and $cellFallbackBound.binding.profileEvidence -eq 'cell-automation-id') 'Exaktes Zell-AID-Fragment wurde bei profiliertem aidFallback nicht gebunden.'
$nearPopupCell = $cell.PSObject.Copy()
$nearPopupCell.aid = 'Root/.grpEmpf13bX./.grpEmpf13bX.Empf13b'
$nearPopupBound = Resolve-SSETableComboPopup @($mainSource) $nearPopupCell 'Sonst. Leistung EU' 'Noch nicht zugeordnet' $aidFallbackBinding
Assert-True (-not $nearPopupBound.ok -and $nearPopupBound.kind -eq 'profile-binding-mismatch') 'Popup-Resolver akzeptierte einen Zell-AID-Nahmatch.'

$workerAst = [Management.Automation.Language.Parser]::ParseInput($workerSource, [ref]$null, [ref]$null)
$closurePredicates = @($workerAst.FindAll({
  param($node) $node -is [Management.Automation.Language.AssignmentStatementAst] -and
    $node.Left.Extent.Text -ceq '$popupClosed' -and $node.Right.Extent.Text.Contains('$postPopup.kind')
}, $true))
Assert-True ($closurePredicates.Count -eq 2) 'Semantische und physische Popup-Schliessung muessen Capture-Vollstaendigkeit pruefen.'
foreach ($predicate in $closurePredicates) {
  $postPopup = [pscustomobject]@{ kind='popup-snapshot-incomplete' }; $boundListPresent=$false
  Invoke-Expression $predicate.Extent.Text
  Assert-True (-not $popupClosed) 'Eine fehlende Liste im unvollstaendigen Capture galt als verifiziert geschlossen.'
  $postPopup = [pscustomobject]@{ kind='option-binding-not-found' }; $boundListPresent=$false
  Invoke-Expression $predicate.Extent.Text
  Assert-True $popupClosed 'Eine nach vollstaendigem Capture verschwundene Liste galt weiterhin als offen.'
}
$pointGuard = $workerAst.Find({
  param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and
    $node.Name -ceq 'Test-SSETableComboOptionPoint'
}, $true)
Assert-True ($null -ne $pointGuard) 'Frische Tabellen-Popup-Optionspruefung fehlt.'
Invoke-Expression $pointGuard.Extent.Text
$popupSource = $mainSource.PSObject.Copy()
$popupSource.hwnd = 200
$popupSource.isMain = $false
$popupSource.isNewPopup = $true
$script:CommitSources = @($popupSource)
$script:CommitCellState = $freshOpenState
$script:CommitWindows = @([pscustomobject]@{hwnd=200;pid=9001})
$script:CommitNode = [pscustomobject]@{
  type='ListItem';name=$wanted.name;rid=$wanted.rid;aid=$wanted.aid;on=$true
  x=$wanted.x;y=$wanted.y;w=$wanted.w;h=$wanted.h
}
function Read-SSETableComboCellState { $script:CommitCellState }
function Get-SSETableComboPopupSources { @($script:CommitSources) }
function Get-Windows { @($script:CommitWindows) }
function Get-LiveElement { $script:CommitNode }
function Convert-ExactElementToNode { param($Element) $Element }
$commitPopup = Resolve-SSETableComboPopup @($popupSource) $cell 'Sonst. Leistung EU' 'Noch nicht zugeordnet' $tableBinding
$commitBinding = [pscustomobject]@{
  mainHwnd=[IntPtr]100;processId=9001;popup=$commitPopup;cellState=$initialOpenState
  expectedPage=$initialOpenState.heading;sumLabel='Summe';sumOccurrence=2
  rowY=100;columnIndex=3;tableProfile=$tableBinding
  expectedCurrent='Noch nicht zugeordnet';wanted='Sonst. Leistung EU';windowIdsBefore=@(100)
}
Assert-True (Test-SSETableComboOptionPoint ([IntPtr]100) $commitBinding 430 195) 'Exakt gebundene Popup-Option wurde beim Qt-Hauptfenster-Root abgewiesen.'
Assert-True (Test-SSETableComboOptionPoint ([IntPtr]200) $commitBinding 430 195) 'Exakt gebundene Popup-Option wurde beim Popup-Root abgewiesen.'
Assert-True (-not (Test-SSETableComboOptionPoint ([IntPtr]300) $commitBinding 430 195)) 'Fremder Klick-Root wurde akzeptiert.'
Assert-True (-not (Test-SSETableComboOptionPoint ([IntPtr]100) $commitBinding 290 195)) 'Klickpunkt ausserhalb der frischen Option wurde akzeptiert.'
$script:CommitNode.on = $false
Assert-True (-not (Test-SSETableComboOptionPoint ([IntPtr]100) $commitBinding 430 195)) 'Deaktivierte Popup-Option wurde akzeptiert.'
$script:CommitNode.on = $true
$script:CommitNode.rid = 'replaced-option'
Assert-True (-not (Test-SSETableComboOptionPoint ([IntPtr]100) $commitBinding 430 195)) 'Ausgetauschte Popup-Option wurde akzeptiert.'
$script:CommitNode.rid = $wanted.rid
$script:CommitWindows = @([pscustomobject]@{hwnd=200;pid=9002})
Assert-True (-not (Test-SSETableComboOptionPoint ([IntPtr]100) $commitBinding 430 195)) 'Popup eines anderen Prozesses wurde akzeptiert.'
$script:CommitWindows = @([pscustomobject]@{hwnd=200;pid=9001})
$script:CommitSources = @()
Assert-True (-not (Test-SSETableComboOptionPoint ([IntPtr]100) $commitBinding 430 195)) 'Verschwundenes Popup wurde akzeptiert.'
$script:CommitSources = @($popupSource)
$script:CommitCellState = $staleOpenState
Assert-True (-not (Test-SSETableComboOptionPoint ([IntPtr]100) $commitBinding 430 195)) 'Ausgetauschte Tabellenzelle wurde akzeptiert.'

Write-Output 'OK: Tabellen-ComboBox-Popup ist an Profil, Zelle, Liste, Ziel- und Rollbackoption gebunden.'
