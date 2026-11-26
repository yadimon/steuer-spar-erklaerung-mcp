# Appends rows to one exactly bound table through its model coordinates. The
# input slot is the last Grid row; rectangles and runtime IDs are observations,
# never row keys. Nothing here moves a pointer, sends a key or scrolls: a row
# beyond the displayed part of the table is written like any other. Nothing
# watches what the person does either. The evidence is the complete table
# state before and after the writes.

function New-SSEUiaAppendRefusal {
  param([string]$Message,[string]$Kind)
  $refusal=[InvalidOperationException]::new($Message)
  $refusal.Data['kind']=$Kind
  $refusal
}

# Maps the requested values (displayed column order) to model columns and
# proves, before any write, that every target is a plain text cell.
function Get-SSEUiaAppendPlan {
  param($State,[object[]]$Rows,$TableProfile)
  $visible=@($State.scan.headers|Where-Object{$_.visible})
  $slot=[int]$State.scan.rows-1
  if($slot -lt 0){throw (New-SSEUiaAppendRefusal 'Die gebundene Tabelle zeigt keine Anlegezeile.' 'not-found')}
  $planned=New-Object System.Collections.ArrayList
  for($index=0;$index -lt $Rows.Count;$index++){
    $values=@($Rows[$index].werte)
    if($values.Count -gt $visible.Count){
      throw (New-SSEUiaAppendRefusal "Zeile $($index+1) enthaelt $($values.Count) Werte, die Tabelle zeigt $($visible.Count) Spalten." 'bad-args')
    }
    $cells=New-Object System.Collections.ArrayList
    for($position=0;$position -lt $values.Count;$position++){
      $requested=[string]$values[$position]
      if(-not $requested){continue}
      $column=[int]$visible[$position].column
      if(Get-SSETableProfileColumn $TableProfile $position){
        throw (New-SSEUiaAppendRefusal ("Spalte $position ('$($visible[$position].name)') ist im Produktprofil eine Auswahlliste. " +
          'Solche Zeilen einzeln mit sse_table_add anlegen.') 'unsupported-table-combobox')
      }
      if([string]$State.scan.cells[$slot*[int]$State.scan.columns+$column].semantic.type -cne 'text'){
        throw (New-SSEUiaAppendRefusal ("Spalte $position ('$($visible[$position].name)') ist keine Textzelle. " +
          'Solche Zeilen einzeln mit sse_table_add anlegen.') 'unsupported-table-cell')
      }
      $null=$cells.Add([pscustomobject]@{spalte=$position;column=$column;requested=$requested})
    }
    if(-not $cells.Count){throw (New-SSEUiaAppendRefusal "Zeile $($index+1) enthaelt keinen zu schreibenden Wert." 'bad-args')}
    $null=$planned.Add([pscustomobject]@{index=$index;cells=@($cells)})
  }
  [pscustomobject]@{slot=$slot;visible=$visible;rows=@($planned)}
}

function Get-SSEUiaAppendCell {
  param($State,$Grid,[int]$ProcessId,[int]$Row,[int]$Column)
  $cell=$Grid.GetItem($Row,$Column);$item=$null
  if(-not $cell -or [int]$cell.Current.ProcessId -ne $ProcessId -or $cell.Current.ControlType -ne [Windows.Automation.ControlType]::DataItem -or
      -not $cell.Current.IsEnabled -or -not $cell.TryGetCurrentPattern([Windows.Automation.GridItemPattern]::Pattern,[ref]$item)){
    throw 'The append coordinate has no exact enabled data cell.'
  }
  $coordinate=$item.Current;$container=$coordinate.ContainingGrid
  if($coordinate.Row -ne $Row -or $coordinate.Column -ne $Column -or $coordinate.RowSpan -ne 1 -or $coordinate.ColumnSpan -ne 1 -or
      -not $container -or [int]$container.Current.ProcessId -ne $ProcessId -or
      ($container.GetRuntimeId() -join '.') -cne $State.root.rid -or [string]$container.Current.AutomationId -cne $State.root.aid){
    throw 'The append cell has a different containing Grid or coordinate.'
  }
  $cell
}

# Qt keeps the raw value of an amount cell empty and shows the amount in its
# name. The raw value is what a restore writes back; the text is what counts.
function Read-SSEUiaAppendCell {
  param($Cell)
  $pattern=$null;$raw=$null
  if($Cell.TryGetCurrentPattern([Windows.Automation.ValuePattern]::Pattern,[ref]$pattern)){$raw=[string]$pattern.Current.Value}
  [pscustomobject]@{pattern=$pattern;raw=$raw;text=$(if($raw){$raw}else{[string]$Cell.Current.Name})}
}

# The slot row as displayed, in the shape the shared free-row policy expects.
function Test-SSEUiaAppendSlotFree {
  param($State,$Grid,[int]$ProcessId,[int]$Row,$Plan,$TableProfile)
  $cells=@(for($position=0;$position -lt $Plan.visible.Count;$position++){
    $header=$Plan.visible[$position]
    $cell=Get-SSEUiaAppendCell $State $Grid $ProcessId $Row ([int]$header.column)
    [pscustomobject]@{x=$position;name=[string]$cell.Current.Name;w=[int]$header.rect.width}
  })
  [bool](Test-SSETableRowFreeWithProfileDefaults $cells $TableProfile $null)
}

function Wait-SSEUiaAppendRows {
  param($Grid,[int]$ExpectedRows)
  $settle=[Diagnostics.Stopwatch]::StartNew()
  do {
    if([int]$Grid.Current.RowCount -eq $ExpectedRows){return $true}
    Start-Sleep -Milliseconds 25
  } while($settle.ElapsedMilliseconds -lt 1500)
  # A deadline only ends polling; the caller decides from the count it reads.
  $false
}

# Writes one row into the current input slot. Every writable cell's raw value
# is recorded first, so a later restore can hand the slot back as it was. The
# binding is proved once, before the first cell; a row that was begun is
# completed. A stop therefore leaves only complete rows.
function Write-SSEUiaAppendRow {
  param($Binding,$State,$Grid,[int]$Row,$Planned,$Plan,$TableProfile,$Transaction)
  if(-not (Test-SSEUiaDeleteEpoch $Binding)){
    throw (New-SSEUiaAppendRefusal "Fenster oder Fenstersatz der Anwendung aenderte sich vor Zeile $($Planned.index+1)." 'interference')
  }
  if([int]$Grid.Current.RowCount -ne $Row+1){
    throw (New-SSEUiaAppendRefusal 'Die Anlegezeile ist nicht mehr die letzte Modellzeile.' 'postcondition-failed')
  }
  if(-not (Test-SSEUiaAppendSlotFree $State $Grid $Binding.processId $Row $Plan $TableProfile)){
    throw (New-SSEUiaAppendRefusal 'Die letzte Modellzeile ist keine freie Anlegezeile.' 'not-found')
  }
  $restore=New-Object System.Collections.ArrayList
  foreach($header in $Plan.visible){
    $column=[int]$header.column
    $read=Read-SSEUiaAppendCell (Get-SSEUiaAppendCell $State $Grid $Binding.processId $Row $column)
    if($read.pattern -and -not $read.pattern.Current.IsReadOnly -and
        [string]$State.scan.cells[([int]$State.scan.rows-1)*[int]$State.scan.columns+$column].semantic.type -ceq 'text'){
      $null=$restore.Add([pscustomobject]@{column=$column;raw=[string]$read.raw;text=[string]$read.text})
    }
  }
  foreach($cell in $Planned.cells){
    if(-not @($restore|Where-Object{$_.column -eq $cell.column}).Count){
      throw (New-SSEUiaAppendRefusal "Spalte $($cell.spalte) der Anlegezeile ist nicht beschreibbar." 'readonly')
    }
  }
  $record=[pscustomobject]@{row=$Row;index=[int]$Planned.index;cells=@($Planned.cells);restore=@($restore);zellen=(New-Object System.Collections.ArrayList)
    begun=$false;complete=$false}
  # From here on the row belongs to the transaction, whatever a write reports.
  $null=$Transaction.written.Add($record)
  foreach($cell in $Planned.cells){
    $target=Read-SSEUiaAppendCell (Get-SSEUiaAppendCell $State $Grid $Binding.processId $Row ([int]$cell.column))
    $Transaction.started=$true;$record.begun=$true
    $target.pattern.SetValue([string]$cell.requested)
    $settle=[Diagnostics.Stopwatch]::StartNew();$actual=$null
    do {
      $actual=(Read-SSEUiaAppendCell (Get-SSEUiaAppendCell $State $Grid $Binding.processId $Row ([int]$cell.column))).text
      if(Test-SSETableCellEquivalent $actual ([string]$cell.requested)){break}
      Start-Sleep -Milliseconds 25
    } while($settle.ElapsedMilliseconds -lt 1000)
    $matches=[bool](Test-SSETableCellEquivalent $actual ([string]$cell.requested))
    $null=$record.zellen.Add([pscustomobject]@{spalte=[int]$cell.spalte;gewuenscht=[string]$cell.requested;ist=[string]$actual;ok=$matches})
    if(-not $matches){
      throw (New-SSEUiaAppendRefusal "Zeile $($Planned.index+1), Spalte $($cell.spalte) zeigt '$actual' statt '$($cell.requested)'." 'postcondition-failed')
    }
  }
  if(-not (Wait-SSEUiaAppendRows $Grid ($Row+2))){
    throw (New-SSEUiaAppendRefusal "Zeile $($Planned.index+1) erzeugte keine neue Anlegezeile." 'postcondition-failed')
  }
  $record.complete=$true
}

# Restores the values of the written rows, last row first. Qt keeps a
# materialized row when its values are restored: the row stays, empty. Whether
# a row also left the model is read from the complete model afterwards. A row
# is restored only while it still shows exactly the own values.
function Undo-SSEUiaAppendRows {
  param($Binding,$State,$Grid,$Transaction)
  $entries=@($Transaction.written);[array]::Reverse($entries)
  foreach($entry in $entries){
    if([int]$Grid.Current.RowCount -le [int]$entry.row){throw 'A written row is no longer part of the model.'}
    $pending=New-Object System.Collections.ArrayList
    foreach($slotCell in $entry.restore){
      if(-not (Test-SSEUiaDeleteEpoch $Binding)){throw 'The window situation changed during the restore.'}
      $live=Read-SSEUiaAppendCell (Get-SSEUiaAppendCell $State $Grid $Binding.processId $entry.row ([int]$slotCell.column))
      $own=@($entry.cells|Where-Object{$_.column -eq $slotCell.column})
      # The raw value alone is no evidence: an amount cell keeps it empty and
      # shows the amount in its text. Compare both against the recorded slot.
      $asRecorded=[bool]([string]$live.raw -ceq [string]$slotCell.raw -and (Test-SSETableCellEquivalent $live.text ([string]$slotCell.text)))
      if($own.Count -eq 1 -and -not $asRecorded){
        # Own is the requested value or exactly what this transaction read
        # back right after its own write; anything else is foreign.
        $observed=@($entry.zellen|Where-Object{$_.spalte -eq $own[0].spalte})
        if(-not (Test-SSETableCellEquivalent $live.text ([string]$own[0].requested)) -and
            -not ($observed.Count -eq 1 -and [string]$live.text -ceq [string]$observed[0].ist)){
          throw 'A written cell shows a value this transaction did not write.'
        }
      }
      if(-not $asRecorded){$null=$pending.Add([pscustomobject]@{pattern=$live.pattern;raw=[string]$slotCell.raw})}
    }
    $restoreOrder=@($pending);[array]::Reverse($restoreOrder)
    foreach($step in $restoreOrder){
      if(-not (Test-SSEUiaDeleteEpoch $Binding)){throw 'The window situation changed during the restore.'}
      $step.pattern.SetValue([string]$step.raw)
    }
    $settle=[Diagnostics.Stopwatch]::StartNew()
    do {
      if(-not (Test-SSEUiaDeleteEpoch $Binding)){throw 'The window situation changed during the restore.'}
      $differing=@(foreach($slotCell in $entry.restore){
        $live=Read-SSEUiaAppendCell (Get-SSEUiaAppendCell $State $Grid $Binding.processId $entry.row ([int]$slotCell.column))
        if([string]$live.raw -cne [string]$slotCell.raw -or -not (Test-SSETableCellEquivalent $live.text ([string]$slotCell.text))){$slotCell.column}
      })
      if(-not $differing.Count){break}
      Start-Sleep -Milliseconds 25
    } while($settle.ElapsedMilliseconds -lt 1000)
    if($differing.Count){throw 'A restored cell did not return to its recorded value.'}
  }
}

# After a stop the binding no longer holds, but reading is passive. One
# complete read, bound only to the same live window and the window set it
# finds, classifies what stands in the model: exactly the rows this
# transaction completed, or nothing that can be proved.
function Read-SSEUiaAppendStoppedState {
  param($Binding,$Initial,$Transaction,[IntPtr]$Hwnd,[int]$ProcessId,[Diagnostics.Process]$Process)
  # A row that was begun and not completed may stand in the model in part.
  if(@($Transaction.written|Where-Object{$_.begun -and -not $_.complete}).Count){throw 'A row was begun but not completed.'}
  $rowsDone=@($Transaction.written|Where-Object{$_.complete})
  $observer=[pscustomobject]@{hwnd=$Binding.hwnd;processId=$Binding.processId;sumLabel=$Binding.sumLabel
    expectedPage=$Binding.expectedPage;expectedBefore=$Binding.expectedBefore;sumOccurrence=$Binding.sumOccurrence
    summaryAid=$Binding.summaryAid;tableAid=$Binding.tableAid;watch=$Binding.watch;maxReadMs=$Binding.maxReadMs
    maxRawMs=$Binding.maxRawMs;guard=$null
    transaction=[pscustomobject]@{windows=(Get-SSEInteractionWindowSet $ProcessId $Hwnd);editorEvidence=$null}}
  $observer.guard={
    $windowPid=0
    [bool](-not $Process.HasExited -and [SW]::IsWindow($Hwnd) -and
      [SW]::GetWindowThreadProcessId($Hwnd,[ref]$windowPid) -gt 0 -and $windowPid -eq $ProcessId)
  }.GetNewClosure()
  $observed=Read-SSEUiaDeleteState $observer -AllowOwnEditor
  if((Get-SSEGridAppendOutcome $Initial.model $observed.model $rowsDone.Count) -cne 'appended-exact'){
    throw 'The stopped model does not show exactly the completed rows.'
  }
  foreach($entry in $rowsDone){
    foreach($cell in $entry.cells){
      $shown=[string]$observed.scan.cells[[int]$entry.row*[int]$observed.scan.columns+[int]$cell.column].name
      if(-not (Test-SSETableCellEquivalent $shown ([string]$cell.requested))){throw 'A completed row no longer shows its written value.'}
    }
  }
  [pscustomobject]@{completed=[int]$rowsDone.Count;summary=$observed.summary;dirty=$observed.dirty}
}

function Invoke-SSEUiaTableAppendRows {
  param([IntPtr]$Hwnd,[int]$ProcessId,$Arguments,[Diagnostics.Process]$Process)
  $rows=@(Arg $Arguments 'zeilen');$expectedAfter=[string](Arg $Arguments 'expectedAfter')
  # No input is sent that could go astray, so neither the foreground nor the
  # person's input is evidence of anything. The binding only says that the
  # same live window with the same set of program windows is still there;
  # what was written is decided by reading the complete table state.
  $transaction=[pscustomobject]@{started=$false;touched=$false;windows=$null;phase='initial';editorEvidence=$null;
    written=(New-Object System.Collections.ArrayList)}
  $binding=[pscustomobject]@{hwnd=$Hwnd;processId=$ProcessId;sumLabel=[string](Arg $Arguments 'sumLabel');
    expectedPage=[string](Arg $Arguments 'expectedPage');expectedBefore=[string](Arg $Arguments 'expectedBefore');
    sumOccurrence=[int](Arg $Arguments 'sumOccurrence' 1);summaryAid='';tableAid='';watch=[Diagnostics.Stopwatch]::StartNew();
    maxReadMs=0.0;maxRawMs=0.0;guard=$null;transaction=$transaction}
  $transaction.windows=Get-SSEInteractionWindowSet $ProcessId $Hwnd
  $binding.guard={
    $windowPid=0
    [bool]($binding.watch.ElapsedMilliseconds -lt 60000 -and -not $Process.HasExited -and [SW]::IsWindow($Hwnd) -and
      [SW]::GetWindowThreadProcessId($Hwnd,[ref]$windowPid) -gt 0 -and $windowPid -eq $ProcessId)
  }.GetNewClosure()
  $initial=$null;$grid=$null;$checkerBefore=@();$failure=$null;$failureKind=$null
  try {
    if(@($transaction.windows.windows|Where-Object{$_.role -cne 'main'}).Count){
      throw (New-SSEUiaAppendRefusal 'Die Zeilenanlage darf kein weiteres, unbekanntes oder blockierendes Fenster der Anwendung vorfinden.' 'precondition-failed')
    }
    # Page and summary are compared first, so that a wrong page or a stale
    # sum is refused with its own reason.
    $transaction.phase='precondition'
    $passive=Read-LabeledValue $Hwnd $binding.sumLabel $binding.expectedBefore $binding.sumOccurrence
    $passiveHeading=[string](Get-CurrentHeading $Hwnd $passive.tree)
    if($passiveHeading -cne $binding.expectedPage){
      throw (New-SSEUiaAppendRefusal "Vorbedingung verletzt: aktuelle Seite ist '$passiveHeading', erwartet '$($binding.expectedPage)'." 'precondition-failed')
    }
    if(-not $passive.selected){
      throw (New-SSEUiaAppendRefusal "Kontrollsumme '$($binding.sumLabel)' (Vorkommen $($binding.sumOccurrence)) wurde nicht eindeutig gefunden." 'precondition-failed')
    }
    if(-not (Test-SSEScalarEqual $passive.value $binding.expectedBefore)){
      throw (New-SSEUiaAppendRefusal "Vorbedingung verletzt: '$($binding.sumLabel)' ist '$($passive.value)', erwartet '$($binding.expectedBefore)'." 'precondition-failed')
    }
    # The program activates its own window as soon as a cell is written.
    # Raising it once through the foreground lease makes that deterministic,
    # and the lease hands the foreground back when the result is emitted.
    $transaction.phase='activation'
    $transaction.touched=$true
    $null=Show-SSEWindow $Hwnd
    # Showing may move or restore the window; the binding continues from the
    # window set found afterwards, which must still be the main window alone.
    $transaction.windows=Get-SSEInteractionWindowSet $ProcessId $Hwnd
    if(@($transaction.windows.windows|Where-Object{$_.role -cne 'main'}).Count){
      throw (New-SSEUiaAppendRefusal 'Bei der Fensteraktivierung erschien ein weiteres Fenster der Anwendung.' 'interference')
    }
    $transaction.phase='initial-read'
    $initial=Read-SSEUiaDeleteState $binding -AllowOwnEditor
    if(-not (Test-SSEScalarEqual $initial.summary $binding.expectedBefore)){
      throw (New-SSEUiaAppendRefusal "Vorbedingung verletzt: '$($binding.sumLabel)' ist '$($initial.summary)', erwartet '$($binding.expectedBefore)'." 'precondition-failed')
    }
    $binding.summaryAid=$initial.summaryAid;$binding.tableAid=$initial.root.aid
    $profile=Resolve-SSETableProfile $binding.expectedPage $binding.sumLabel $binding.sumOccurrence $initial.region
    if($profile.known -and -not $profile.bindingOk){
      throw (New-SSEUiaAppendRefusal "$($profile.reason) Tabellenprofil '$($profile.pageId)/$($profile.tableId)' nicht gebunden." 'table-profile-mismatch')
    }
    if($initial.region.profileMappingId){
      throw (New-SSEUiaAppendRefusal 'Diese Tabelle hat einen eigenen Zeilenvertrag. Ihre Zeilen einzeln mit sse_table_add anlegen.' 'unsupported-table-cell')
    }
    $plan=Get-SSEUiaAppendPlan $initial $rows $profile
    $checkerBefore=@(Get-SSEPageCheckerMessages $initial.tree $Hwnd)
    if(-not $initial.table.TryGetCurrentPattern([Windows.Automation.GridPattern]::Pattern,[ref]$grid)){throw 'The bound table lost its Grid pattern.'}
    $transaction.phase='write'
    foreach($planned in $plan.rows){
      Write-SSEUiaAppendRow $binding $initial $grid ($plan.slot+[int]$planned.index) $planned $plan $profile $transaction
    }
    $transaction.phase='final-read'
    $final=Read-SSEUiaDeleteState $binding -AllowOwnEditor
    $outcome=Get-SSEGridAppendOutcome $initial.model $final.model $rows.Count
    if($outcome -cne 'appended-exact'){
      throw (New-SSEUiaAppendRefusal 'Das vollstaendige Modell zeigt nicht genau die angeforderten neuen Zeilen ueber einer unveraenderten Anlegezeile.' 'postcondition-failed')
    }
    foreach($entry in $transaction.written){
      foreach($cell in $entry.cells){
        $shown=[string]$final.scan.cells[[int]$entry.row*[int]$final.scan.columns+[int]$cell.column].name
        if(-not (Test-SSETableCellEquivalent $shown ([string]$cell.requested))){
          throw (New-SSEUiaAppendRefusal "Zeile $($entry.index+1), Spalte $($cell.spalte) zeigt im Abschlussmodell '$shown' statt '$($cell.requested)'." 'postcondition-failed')
        }
      }
    }
    if($expectedAfter -and -not (Test-SSEScalarEqual $final.summary $expectedAfter)){
      throw (New-SSEUiaAppendRefusal "Nachsumme '$($binding.sumLabel)' ist '$($final.summary)', erwartet '$expectedAfter'." 'postcondition-failed')
    }
    $checkerAfter=@(Get-SSEPageCheckerMessages $final.tree $Hwnd)
    $newChecker=@(Compare-SSEPageCheckerMessages $checkerBefore $checkerAfter)
    if($newChecker.Count){
      throw (New-SSEUiaAppendRefusal "Neue Pruefermeldung nach der Zeilenanlage: $($newChecker -join ' | ')" 'postcondition-failed')
    }
    return [pscustomobject]@{ok=$true;kind=$null;error=$null;phase='completed';mutationStarted=$true;outcomeUnknown=$false;
      resultingState='completed-verified';sumBefore=$initial.summary;sumAfter=$final.summary
      completed=[int]$rows.Count;retryable=$false
      rows=@($transaction.written|ForEach-Object{[pscustomobject]@{index=[int]$_.index;modelRow=[int]$_.row;zellen=@($_.zellen)}})
      proof=[pscustomobject]@{schemaVersion=1;method='uia-grid-logical-model';outcome=$outcome;rowsBefore=$initial.model.rows;
        rowsAfter=$final.model.rows;beforeFingerprint=$initial.model.fingerprint;afterFingerprint=$final.model.fingerprint}
      checkerBefore=$checkerBefore;checkerAfter=$checkerAfter;newChecker=@();dirtyBefore=$initial.dirty;dirtyAfter=$final.dirty
      rollback=$null}
  } catch {
    if($script:SSE_CAPTURE_OPERATION_RESULT -and $_.Exception.Message -ceq $script:SSE_CAPTURE_SENTINEL){throw}
    $failure=[string]$_.Exception.Message;$failureKind=[string]$_.Exception.Data['kind']
  }
  $failedPhase=[string]$transaction.phase
  # A refusal before the first write keeps its own reason. Once a write was
  # begun, a changed window situation decides: nothing is restored into it.
  $interference=[bool]($failureKind -ceq 'interference' -or
    (-not (Test-SSEUiaDeleteEpoch $binding) -and ($transaction.started -or -not $failureKind)))
  $rollback=$null;$resultingState=$(if($transaction.started){'unknown'}else{'unchanged'})
  $completed=0;$stoppedSummary=$null;$stoppedDirty=$null
  if($transaction.started -and -not $interference -and $initial -and $grid){
    # Only an ordinary, own failure is restored.
    $transaction.phase='restore'
    $rollback=[ordered]@{versucht=$true;methode='raw-value-row-restore';erfolgreich=$false;werteWiederhergestellt=$false
      strukturEntfernt=$false;verbliebeneLeerzeilen=$null;error=$null}
    try {
      Undo-SSEUiaAppendRows $binding $initial $grid $transaction
      $restored=Read-SSEUiaDeleteState $binding -AllowOwnEditor
      $restoreOutcome=Get-SSEGridAppendRestoreOutcome $initial.model $restored.model $transaction.written.Count
      if($restoreOutcome -cnotin @('unchanged','emptied-exact') -or
          -not (Test-SSEScalarEqual $restored.summary $initial.summary) -or
          @(Compare-SSEPageCheckerMessages $checkerBefore @(Get-SSEPageCheckerMessages $restored.tree $Hwnd)).Count){
        throw 'The original values, summary or checker state were not proved after the restore.'
      }
      # Values and summary are back. Qt keeps a materialized row, so the own
      # rows may remain as empty rows; only an unchanged model is a full restore.
      $rollback.werteWiederhergestellt=$true
      $rollback.strukturEntfernt=[bool]($restoreOutcome -ceq 'unchanged')
      $rollback.verbliebeneLeerzeilen=[int]$restored.model.rows-[int]$initial.model.rows
      $rollback.erfolgreich=[bool]($restoreOutcome -ceq 'unchanged')
      $rollback.summe=$restored.summary;$rollback.ungespeichertNachher=$restored.dirty
      $resultingState=$(if($restoreOutcome -ceq 'unchanged'){'restored'}else{'values-restored'})
    } catch {
      if($script:SSE_CAPTURE_OPERATION_RESULT -and $_.Exception.Message -ceq $script:SSE_CAPTURE_SENTINEL){throw}
      $rollback.error=[string]$_.Exception.Message
    }
  } elseif($transaction.started) {
    $rollback=[ordered]@{versucht=$false;erfolgreich=$false;grund='Keine Ruecknahme in eine veraenderte Fensterlage.'}
    # Nothing is written or restored any more. A passive complete read may
    # still prove that exactly the completed rows stand in the model.
    $transaction.phase='stopped-read'
    try {
      $stopped=Read-SSEUiaAppendStoppedState $binding $initial $transaction $Hwnd $ProcessId $Process
      $completed=[int]$stopped.completed;$stoppedSummary=$stopped.summary;$stoppedDirty=$stopped.dirty
      $resultingState='partially-completed-verified'
    } catch {
      if($script:SSE_CAPTURE_OPERATION_RESULT -and $_.Exception.Message -ceq $script:SSE_CAPTURE_SENTINEL){throw}
      $rollback.zustandsbeweis=[string]$_.Exception.Message
    }
  }
  # With an unknown state the window stays in front for the person to see.
  if($transaction.touched -and $resultingState -ceq 'unknown'){$script:SSE_CURSOR_PRESERVE_UNPROVEN_FOCUS=$true}
  [pscustomobject]@{ok=$false
    kind=$(if($interference){'interference'}elseif($failureKind){$failureKind}elseif($transaction.started){'postcondition-failed'}else{'precondition-failed'})
    error=$failure;phase=$failedPhase;mutationStarted=[bool]$transaction.started;outcomeUnknown=[bool]($resultingState -ceq 'unknown')
    resultingState=$resultingState;sumBefore=$(if($initial){$initial.summary}else{$null});sumAfter=$stoppedSummary
    completed=$completed
    # Only a stop with a proven state may be repeated: with the remaining
    # rows and the reported sum as the new starting point.
    retryable=[bool]($interference -and $resultingState -cin @('unchanged','partially-completed-verified'))
    rows=@($transaction.written|ForEach-Object{[pscustomobject]@{index=[int]$_.index;modelRow=[int]$_.row;zellen=@($_.zellen)}})
    proof=$null;checkerBefore=$checkerBefore;checkerAfter=@();newChecker=@()
    dirtyBefore=$(if($initial){$initial.dirty}else{$null});dirtyAfter=$stoppedDirty
    rollback=$(if($rollback){[pscustomobject]$rollback}else{$null})}
}
