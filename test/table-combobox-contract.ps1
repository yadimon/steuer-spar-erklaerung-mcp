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
  tree=[pscustomobject]@{ nodes=@($list,$current,$wanted,$other) }
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
  popupBinding=[pscustomobject]@{
    ok=$false; kind='option-binding-not-found'; error='Keine exakte Liste.'
    candidates=@([pscustomobject]@{ sourceHwnd=100; options=$diagnosticOptions })
  }
})
Assert-True ($diagnostic.kind -eq 'option-binding-not-found' -and -not $diagnostic.mutationStarted -and -not $diagnostic.interference) 'ComboBox-Fehlerart/-zustand wurde nicht projiziert.'
Assert-True ($diagnostic.error.Length -le 2060 -and $diagnostic.popupBinding.candidates[0].options.Count -eq 65) 'ComboBox-Diagnose wurde nicht reproduzierbar begrenzt.'
Assert-True ($diagnostic.openEvidence.verifiedPointAttempted -and $diagnostic.editorClosed -eq $false) 'Open-/Editor-Diagnose ging bei der Projektion verloren.'

$bound = Resolve-SSETableComboPopup @($mainSource) $cell 'Sonst. Leistung EU' 'Noch nicht zugeordnet' $tableBinding
Assert-True $bound.ok 'Exakt zellgebundene Hauptbaum-Liste wurde nicht akzeptiert.'
Assert-True ($bound.target.rid -eq 'option-1') 'Zieloption wurde nicht exakt gebunden.'
Assert-True ($bound.rollback.rid -eq 'option-0') 'Ausgangsoption wurde nicht fuer Rollback gebunden.'
Assert-True ($bound.binding.profileEvidence -eq 'summary-region-scope-prefix') 'Echter grpEmpf13b-Snapshot wurde nicht ueber die Summenregion gebunden.'
Assert-True ($bound.binding.observedScopePrefix -ceq 'Root/.grpEmpf13b./.grpEmpf13b.') 'Echter grpEmpf13b-Scope wurde nicht unveraendert ausgewiesen.'
Assert-True ($bound.binding.source -eq 'main-tree') 'Quellbindung der Optionsliste ist falsch.'
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
  tree=[pscustomobject]@{ nodes=@($unrelatedList,$current,$wanted,$other) }
}
$unrelated = Resolve-SSETableComboPopup @($unrelatedSource) $cell 'Sonst. Leistung EU' 'Noch nicht zugeordnet' $tableBinding
Assert-True (-not $unrelated.ok) 'Geometrisch fremde Liste wurde faelschlich akzeptiert.'

$duplicateWanted = [pscustomobject]@{ i=4; p=0; type='ListItem'; name='Sonst. Leistung EU'; aid='category-options.3'; rid='option-3'; x=300; y=250; w=260; h=35 }
$duplicateSource = [pscustomobject]@{
  hwnd=100; isMain=$true; isNewPopup=$false; window=$null
  tree=[pscustomobject]@{ nodes=@($list,$current,$wanted,$other,$duplicateWanted) }
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

Write-Output 'OK: Tabellen-ComboBox-Popup ist an Profil, Zelle, Liste, Ziel- und Rollbackoption gebunden.'
