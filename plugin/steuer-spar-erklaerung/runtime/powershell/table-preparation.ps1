# Dismiss only the explicitly profiled, directly owned help window before the
# caller obtains its first table binding. One exact passive result window may
# remain open under its own strict state and identity binding. No selection,
# focus or write lease survives preparation. A submitted close is never replayed.

function Get-SSETablePreparationProcessEpoch([int]$ProcessId) {
  $process=[Diagnostics.Process]::GetProcessById($ProcessId)
  try { $process.StartTime.ToUniversalTime().ToFileTimeUtc() }
  finally { $process.Dispose() }
}

function Get-SSETablePreparationWindows([int]$ProcessId) {
  @(Get-Windows 'SSE' | Where-Object {
    [int]$_.pid -eq $ProcessId -and -not (Test-SSEWindowDecorationDescriptor $_)
  })
}

function Get-SSETablePreparationWindowSignature($Windows) {
  @($Windows | Sort-Object {[int64]$_.hwnd} | ForEach-Object {
    [pscustomobject][ordered]@{
      hwnd=[int64]$_.hwnd;pid=[int]$_.pid;cls=[string]$_.cls;title=[string]$_.title
      titleFingerprint=[string]$_.titleFingerprint
      x=$_.x;y=$_.y;w=$_.w;h=$_.h;minimized=$_.minimiert;hung=$_.hung
    }
  }) | ConvertTo-Json -Depth 4 -Compress
}

function Get-SSETablePreparationRoot {
  param([IntPtr]$Hwnd,[int]$ProcessId,[string]$ExpectedAid='',
    [string]$ExpectedRid='',[string]$ExpectedName='',[switch]$RequireNonModal)
  $root=$AE::FromHandle($Hwnd)
  if (-not $root) { throw 'The preparation window root is unavailable.' }
  $current=$root.Current
  $rid=$root.GetRuntimeId() -join '.'
  $aid=[string]$current.AutomationId
  if ([int]$current.ProcessId -ne $ProcessId -or [int64]$current.NativeWindowHandle -ne [int64]$Hwnd -or
      $current.ControlType -ne [System.Windows.Automation.ControlType]::Window -or
      $current.IsEnabled -isnot [bool] -or -not $current.IsEnabled -or -not $rid -or -not $aid -or
      ($ExpectedAid -and $aid -cne $ExpectedAid) -or ($ExpectedRid -and $rid -cne $ExpectedRid) -or
      ($ExpectedName -and [string]$current.Name -cne $ExpectedName)) {
    throw 'The exact enabled preparation window identity could not be proven.'
  }
  if ($RequireNonModal) {
    $pattern=$null
    if (-not $root.TryGetCurrentPattern([System.Windows.Automation.WindowPattern]::Pattern,[ref]$pattern) -or -not $pattern) {
      throw 'The preparation help window is not provably nonmodal.'
    }
    $isModal=$pattern.Current.IsModal
    if ($isModal -isnot [bool] -or $isModal) {
      throw 'The preparation help window is not provably nonmodal.'
    }
  }
  [pscustomobject]@{aid=$aid;rid=$rid}
}

function Get-SSETablePreparationSemanticFingerprint($Nodes) {
  $semanticNodes=@($Nodes | Select-Object -Property * -ExcludeProperty x,y,w,h)
  Get-SSETextSha256 ($semanticNodes | ConvertTo-Json -Depth 6 -Compress)
}

function Assert-SSETablePreparationSnapshotComplete($Tree,[string]$Scope='main-window') {
  $stats=$Tree.stats
  if (-not $stats -or $stats.truncated -isnot [bool] -or $stats.truncated -or
      $stats.depthLimited -isnot [bool] -or $stats.depthLimited -or
      $null -eq $stats.err -or $stats.err -ne 0 -or $null -eq $stats.cyc -or $stats.cyc -ne 0 -or
      $null -eq $stats.valErr -or $stats.valErr -ne 0 -or -not @($Tree.nodes).Count) {
    throw ('Table preparation needs a complete readable ' + $Scope + ' snapshot.')
  }
}

function ConvertTo-SSETablePreparationNodes($Tree) {
  # Index offsets may change when an owned foreign subtree disappears. Compare
  # own semantic identities and parent identities rather than those offsets.
  $byIndex=@{}
  foreach ($node in @($Tree.nodes)) {
    if ($byIndex.ContainsKey([int]$node.i)) { throw 'Preparation snapshot node indices are ambiguous.' }
    $byIndex[[int]$node.i]=$node
  }
  $nodes=@($Tree.nodes | ForEach-Object {
    $parent=$(if ([int]$_.p -ge 0) { $byIndex[[int]$_.p] } else { $null })
    if ([int]$_.p -ge 0 -and -not $parent) { throw 'Preparation snapshot parent identity is unavailable.' }
    [pscustomobject][ordered]@{
      type=$_.type;aid=$_.aid;rid=$_.rid;parentAid=$parent.aid;parentRid=$parent.rid
      name=$_.name;value=$_.val;readOnly=$_.ro;checked=$_.checked;selected=$_.selected
      enabled=$_.on;x=$_.x;y=$_.y;w=$_.w;h=$_.h
    }
  })
  $nodes
}

function Get-SSETablePreparationObserverState([IntPtr]$Hwnd) {
  $tree=Walk-BoundTree $Hwnd -WithValues -Strict
  Assert-SSETablePreparationSnapshotComplete $tree 'result-observer'
  $nodes=@(ConvertTo-SSETablePreparationNodes $tree)
  [pscustomobject]@{
    fingerprint=(Get-SSETextSha256 ($nodes | ConvertTo-Json -Depth 6 -Compress))
  }
}

function Get-SSETablePreparationState([IntPtr]$MainHwnd) {
  $tree=Walk-BoundTree $MainHwnd -WithValues -Strict
  Assert-SSETablePreparationSnapshotComplete $tree
  foreach ($table in @($tree.nodes | Where-Object {
    $_.type -cin @('Table','DataGrid') -and $_.on -and $_.w -gt 0 -and $_.h -gt 0
  })) {
    $state=Get-SSETableSnapshotInputState $tree $table.aid $table.rid
    if (-not $state.ok -or -not $state.editorFree) {
      throw 'Table preparation cannot dismiss a window with an active or unknown table editor.'
    }
  }
  $dirty=Get-DirtyStateFast $MainHwnd
  $heading=Get-CurrentHeading $MainHwnd $tree
  if ($dirty -isnot [bool] -or -not $heading) { throw 'Table preparation page or dirty state is unavailable.' }
  $nodes=@(ConvertTo-SSETablePreparationNodes $tree)
  [pscustomobject]@{
    heading=[string]$heading;dirty=$dirty
    fingerprint=(Get-SSETextSha256 ($nodes | ConvertTo-Json -Depth 6 -Compress))
    semanticFingerprint=(Get-SSETablePreparationSemanticFingerprint $nodes)
    # Private comparison evidence only; callers never emit this state.
    nodes=$nodes
  }
}

function Get-SSETablePreparationDifferenceCategory($BeforeNodes,$AfterNodes) {
  $before=@($BeforeNodes);$after=@($AfterNodes)
  if ($before.Count -ne $after.Count) { return 'structure' }
  $groups=@(
    @{category='runtime-id';fields=@('rid','parentRid')},
    @{category='structure';fields=@('type','aid','parentAid')},
    @{category='content';fields=@('name','value','readOnly','checked')},
    @{category='selected';fields=@('selected')},
    @{category='enabled';fields=@('enabled')},
    @{category='geometry';fields=@('x','y','w','h')}
  )
  foreach ($group in $groups) {
    for ($index=0;$index -lt $before.Count;$index++) {
      foreach ($field in $group.fields) {
        if (-not [object]::Equals($before[$index].$field,$after[$index].$field)) { return $group.category }
      }
    }
  }
  # The original hash remains authoritative even if no projected field can
  # explain its mismatch. Never include a value or identifier in the code.
  'unclassified'
}

function Invoke-SSETablePreparation {
  param([IntPtr]$MainHwnd,[int]$ProcessId)
  $dispatch=@{attempted=$false}
  $preparationDiagnostic=@{phase='initial'}
  try {
    if ($MainHwnd -eq [IntPtr]::Zero -or $ProcessId -le 0) { throw 'Preparation requires an exact positive main-window binding.' }
    $catalog=Get-SSEPageObjects
    $entry=$catalog.windows.taxTips
    if (-not $entry -or -not $entry.tablePreparationPolicy) {
      return [pscustomobject]@{ok=$true;prepared=$false}
    }
    $policy=$entry.tablePreparationPolicy
    $sameTitle=@($catalog.windows.PSObject.Properties | Where-Object { [string]$_.Value.title -ceq [string]$entry.title })
    if ($sameTitle.Count -ne 1 -or [string]$entry.role -cne 'nonmodal-help-window' -or -not [string]$entry.title -or
        [string]$entry.closePolicy -cne 'allow-exact-nonmodal-close' -or
        [string]$policy.mode -cne 'close-once-before-table-binding' -or
        [string]$policy.owner -cne 'exact-bound-main' -or $policy.requireNonModal -isnot [bool] -or
        -not $policy.requireNonModal -or -not [string]$policy.automationId) {
      throw 'The explicit help-window preparation policy is invalid or ambiguous.'
    }
    $windows=@(Get-SSETablePreparationWindows $ProcessId)
    $tips=@($windows | Where-Object { [string]$_.title -ceq [string]$entry.title })
    # Ordinary requests pay for window discovery only. The caller still takes
    # its normal complete binding and rejects any later obstruction itself.
    if (-not $tips.Count) { return [pscustomobject]@{ok=$true;prepared=$false} }
    $main=@($windows | Where-Object { [int64]$_.hwnd -eq [int64]$MainHwnd })
    $observers=@($windows | Where-Object {
      [int64]$_.hwnd -ne [int64]$MainHwnd -and [string]$_.title -cne [string]$entry.title
    })
    if ($tips.Count -ne 1 -or $windows.Count -ne (2+$observers.Count) -or $observers.Count -gt 1 -or $main.Count -ne 1 -or
        [int64]$tips[0].hwnd -eq [int64]$MainHwnd -or [string]$tips[0].cls -notmatch '^Qt' -or
        [string]$main[0].cls -notmatch '^Qt') {
      throw 'Preparation requires one exact main and help window, with at most one known passive result observer.'
    }
    $observer=$null
    if ($observers.Count -eq 1) {
      $observerEntry=(Get-SSEPageObjects).windows.resultComparison
      $observerTitles=@((Get-SSEPageObjects).windows.PSObject.Properties | Where-Object {
        [string]$_.Value.title -ceq [string]$observerEntry.title
      })
      if (-not $observerEntry -or -not [string]$observerEntry.title -or
          [string]$observerEntry.role -cne 'nonmodal-result-window' -or
          [string]$observerEntry.closePolicy -cne 'allow-exact-nonmodal-close' -or
          $observerTitles.Count -ne 1 -or $observerTitles[0].Name -cne 'resultComparison' -or
          [string]$observers[0].title -cne [string]$observerEntry.title -or
          [string]$observers[0].cls -notmatch '^Qt') {
        throw 'Preparation accepts only the exact profiled nonmodal result observer.'
      }
      $observer=[pscustomobject]@{hwnd=[IntPtr][int64]$observers[0].hwnd;title=[string]$observerEntry.title;root=$null;state=$null}
    }
    $tip=$tips[0];$tipHwnd=[IntPtr][int64]$tip.hwnd
    $desktopName=[string]$script:DESKTOP_NAME
    $guardInput=-not [bool]$desktopName
    $input=$null;$foreground=[IntPtr]::Zero
    if ($guardInput) {
      $input=Get-SSELastInputTick
      $foreground=[SW]::GetForegroundWindow()
      if ($null -eq $input -or $foreground -eq [IntPtr]::Zero) { throw 'Preparation input or foreground epoch is unavailable.' }
    } elseif (-not [DSK]::IsIsolatedWindowDesktop($MainHwnd,$desktopName)) {
      throw 'Preparation isolated desktop binding is unavailable.'
    }
    $creation=Get-SSETablePreparationProcessEpoch $ProcessId
    if ($null -eq $creation -or $creation -le 0) { throw 'Preparation process identity is unavailable.' }
    $mainRoot=Get-SSETablePreparationRoot $MainHwnd $ProcessId
    if ([SW]::GetWindow($tipHwnd,4) -ne $MainHwnd) { throw 'The help window is not directly owned by the exact main window.' }
    $tipRoot=Get-SSETablePreparationRoot $tipHwnd $ProcessId -ExpectedAid $policy.automationId -ExpectedName $entry.title -RequireNonModal
    if ($observer) {
      if ($foreground -eq $observer.hwnd -or [SW]::GetWindow($observer.hwnd,4) -ne $MainHwnd) {
        throw 'The result observer must be passive and directly owned by the exact main window.'
      }
      $observer.root=Get-SSETablePreparationRoot $observer.hwnd $ProcessId -ExpectedName $observer.title -RequireNonModal
      $observer.state=Get-SSETablePreparationObserverState $observer.hwnd
    }
    $before=Get-SSETablePreparationState $MainHwnd
    # Keep the private authority in one distinct local. The shared close
    # transaction has its own beforeWindows, which must never shadow this
    # callback's comparison through PowerShell's dynamic scope.
    $preparationBinding=[pscustomobject]@{
      mainHwnd=$MainHwnd;processId=$ProcessId;tipHwnd=$tipHwnd;input=$input;foreground=$foreground
      guardInput=$guardInput;desktopName=$desktopName
      creation=$creation;mainRoot=$mainRoot;tipRoot=$tipRoot;tipAid=[string]$policy.automationId
      tipTitle=[string]$entry.title;state=$before;observer=$observer
      windows=(Get-SSETablePreparationWindowSignature $windows)
      remaining=(Get-SSETablePreparationWindowSignature @($windows | Where-Object { [int64]$_.hwnd -ne [int64]$tipHwnd }))
    }
    $checkEnvironment={
      param([IntPtr]$ExpectedForeground)
      $boundPid=0
      $null=[SW]::GetWindowThreadProcessId($preparationBinding.mainHwnd,[ref]$boundPid)
      [bool]($boundPid -eq $preparationBinding.processId -and [SW]::IsWindow($preparationBinding.mainHwnd) -and
        [string]$script:DESKTOP_NAME -ceq $preparationBinding.desktopName -and
        (($preparationBinding.guardInput -and [SW]::GetForegroundWindow() -eq $ExpectedForeground -and
            (Test-SSELastInputUnchanged $preparationBinding.input)) -or
          (-not $preparationBinding.guardInput -and
            [DSK]::IsIsolatedWindowDesktop($preparationBinding.mainHwnd,$preparationBinding.desktopName))) -and
        (Get-SSETablePreparationProcessEpoch $preparationBinding.processId) -eq $preparationBinding.creation)
    }
    $guard={
      $preparationDiagnostic.phase='guard-environment-before'
      if (-not (& $checkEnvironment $preparationBinding.foreground)) { return $false }
      $preparationDiagnostic.phase='guard-fresh-state'
      $fresh=Get-SSETablePreparationState $preparationBinding.mainHwnd
      if ($fresh.fingerprint -cne $preparationBinding.state.fingerprint) {
        $preparationDiagnostic.phase='guard-fingerprint-' + (Get-SSETablePreparationDifferenceCategory $preparationBinding.state.nodes $fresh.nodes)
        # Only passive geometry settling may obtain one more strict snapshot.
        # The complete non-geometric hash, not the diagnostic category,
        # authorizes that read. Every projected future property is included.
        if ($preparationBinding.state.semanticFingerprint -isnot [string] -or
            $preparationBinding.state.semanticFingerprint -cnotmatch '^[A-F0-9]{64}$' -or
            $fresh.semanticFingerprint -isnot [string] -or $fresh.semanticFingerprint -cnotmatch '^[A-F0-9]{64}$' -or
            $fresh.semanticFingerprint -cne $preparationBinding.state.semanticFingerprint -or
            $fresh.heading -cne $preparationBinding.state.heading -or $fresh.dirty -ne $preparationBinding.state.dirty) { return $false }
        $preparationDiagnostic.phase='guard-settled-state'
        $settled=Get-SSETablePreparationState $preparationBinding.mainHwnd
        $preparationDiagnostic.phase='guard-settled-fingerprint'
        if ($settled.fingerprint -cne $fresh.fingerprint -or
            $settled.semanticFingerprint -isnot [string] -or $settled.semanticFingerprint -cnotmatch '^[A-F0-9]{64}$' -or
            $settled.semanticFingerprint -cne $preparationBinding.state.semanticFingerprint -or
            $settled.heading -cne $preparationBinding.state.heading -or $settled.dirty -ne $preparationBinding.state.dirty) { return $false }
        $preparationBinding.state=$settled
      }
      $preparationDiagnostic.phase='guard-heading'
      if ($fresh.heading -cne $preparationBinding.state.heading) { return $false }
      $preparationDiagnostic.phase='guard-dirty'
      if ($fresh.dirty -ne $preparationBinding.state.dirty) { return $false }
      if ($preparationBinding.observer) {
        $preparationDiagnostic.phase='guard-observer-state'
        $observerFresh=Get-SSETablePreparationObserverState $preparationBinding.observer.hwnd
        if ($observerFresh.fingerprint -cne $preparationBinding.observer.state.fingerprint) { return $false }
      }
      $preparationDiagnostic.phase='guard-main-root'
      $null=Get-SSETablePreparationRoot $preparationBinding.mainHwnd $preparationBinding.processId -ExpectedAid $preparationBinding.mainRoot.aid -ExpectedRid $preparationBinding.mainRoot.rid
      $preparationDiagnostic.phase='guard-tip-root'
      $null=Get-SSETablePreparationRoot $preparationBinding.tipHwnd $preparationBinding.processId -ExpectedAid $preparationBinding.tipAid -ExpectedRid $preparationBinding.tipRoot.rid -ExpectedName $preparationBinding.tipTitle -RequireNonModal
      if ($preparationBinding.observer) {
        $preparationDiagnostic.phase='guard-observer-root'
        $null=Get-SSETablePreparationRoot $preparationBinding.observer.hwnd $preparationBinding.processId -ExpectedAid $preparationBinding.observer.root.aid -ExpectedRid $preparationBinding.observer.root.rid -ExpectedName $preparationBinding.observer.title -RequireNonModal
      }
      # Provider reads can pump window messages. Complete them before the last
      # Win32 inventory/owner/process proofs; no provider query follows these.
      $preparationDiagnostic.phase='guard-window-signature'
      if ((Get-SSETablePreparationWindowSignature (Get-SSETablePreparationWindows $preparationBinding.processId)) -cne $preparationBinding.windows -or
          -not [SW]::IsWindow($preparationBinding.tipHwnd)) { return $false }
      $preparationDiagnostic.phase='guard-owner'
      $tipPid=0
      $null=[SW]::GetWindowThreadProcessId($preparationBinding.tipHwnd,[ref]$tipPid)
      if ($tipPid -ne $preparationBinding.processId -or
          [SW]::GetWindow($preparationBinding.tipHwnd,4) -ne $preparationBinding.mainHwnd) { return $false }
      if ($preparationBinding.observer) {
        $preparationDiagnostic.phase='guard-observer-owner'
        $observerPid=0
        $null=[SW]::GetWindowThreadProcessId($preparationBinding.observer.hwnd,[ref]$observerPid)
        if ($observerPid -ne $preparationBinding.processId -or -not [SW]::IsWindow($preparationBinding.observer.hwnd) -or
            [SW]::GetWindow($preparationBinding.observer.hwnd,4) -ne $preparationBinding.mainHwnd) { return $false }
      }
      $preparationDiagnostic.phase='guard-environment-after'
      $environmentVerified=[bool](& $checkEnvironment $preparationBinding.foreground)
      if ($environmentVerified) { $preparationDiagnostic.phase='close-transaction' }
      $environmentVerified
    }
    $preparationDiagnostic.phase='close-transaction'
    $closed=Invoke-SSEWindowCloseTransaction ([pscustomobject]@{pid=$ProcessId;hwnd=[int64]$tipHwnd;expectedTitle=[string]$entry.title}) -BeforeDispatch $guard -DispatchState $dispatch
    if (-not $closed.ok) { throw ('Help-window close was not verified: ' + [string]$closed.error) }
    $preparationDiagnostic.phase='after-close-environment'
    $expectedForeground=$(if ($foreground -eq $tipHwnd) {$MainHwnd} else {$foreground})
    if (-not (& $checkEnvironment $expectedForeground) -or
        (Get-SSETablePreparationWindowSignature (Get-SSETablePreparationWindows $ProcessId)) -cne $preparationBinding.remaining) {
      throw 'Main-window, process, peer, input or foreground identity changed after preparation.'
    }
    $preparationDiagnostic.phase='after-close-state'
    $after=Get-SSETablePreparationState $MainHwnd
    if ($after.fingerprint -cne $preparationBinding.state.fingerprint -or $after.heading -cne $preparationBinding.state.heading -or
        $after.dirty -ne $preparationBinding.state.dirty) {
      throw 'Page, values, dirty state, input or foreground changed while closing the help window.'
    }
    if ($preparationBinding.observer) {
      $preparationDiagnostic.phase='after-close-observer-state'
      $observerAfter=Get-SSETablePreparationObserverState $preparationBinding.observer.hwnd
      if ($observerAfter.fingerprint -cne $preparationBinding.observer.state.fingerprint) {
        throw 'The passive result observer changed while closing the help window.'
      }
    }
    $preparationDiagnostic.phase='after-close-main-root'
    $null=Get-SSETablePreparationRoot $MainHwnd $ProcessId -ExpectedAid $mainRoot.aid -ExpectedRid $mainRoot.rid
    if ($preparationBinding.observer) {
      $preparationDiagnostic.phase='after-close-observer-root'
      $null=Get-SSETablePreparationRoot $preparationBinding.observer.hwnd $ProcessId -ExpectedAid $preparationBinding.observer.root.aid -ExpectedRid $preparationBinding.observer.root.rid -ExpectedName $preparationBinding.observer.title -RequireNonModal
      $preparationDiagnostic.phase='after-close-observer-owner'
      $observerPid=0
      $null=[SW]::GetWindowThreadProcessId($preparationBinding.observer.hwnd,[ref]$observerPid)
      if ($observerPid -ne $ProcessId -or -not [SW]::IsWindow($preparationBinding.observer.hwnd) -or
          [SW]::GetWindow($preparationBinding.observer.hwnd,4) -ne $MainHwnd) {
        throw 'The final passive result observer ownership changed during preparation readback.'
      }
    }
    $preparationDiagnostic.phase='after-close-final-environment'
    if (-not (& $checkEnvironment $expectedForeground) -or
        (Get-SSETablePreparationWindowSignature (Get-SSETablePreparationWindows $ProcessId)) -cne $preparationBinding.remaining) {
      throw 'The final main-window, peer or input binding changed during preparation readback.'
    }
    [pscustomobject]@{ok=$true;prepared=$true;windowId='taxTips';verified=$true}
  } catch {
    # No provider reads, focus restoration or alternate close are attempted
    # after an exception. A submitted message may have taken effect already.
    if ($dispatch.attempted) { $script:SSE_CURSOR_PRESERVE_UNPROVEN_FOCUS=$true }
    [pscustomobject]@{
      ok=$false;kind='table-preparation-failed';error=($_.Exception.Message + ' [preparation:' + $preparationDiagnostic.phase + ']');retryable=$false
      preparationAttempted=[bool]$dispatch.attempted;outcomeUnknown=[bool]$dispatch.attempted
      reconciliationRequired=[bool]$dispatch.attempted
    }
  }
}
