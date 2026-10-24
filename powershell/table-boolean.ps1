# Typed checkbox writes in a freshly rebound table cell. Never write booleans
# through ValuePattern: Qt can acknowledge that text without changing its flag.
function Throw-SSETableBooleanError([string]$Message, [string]$Kind) {
  $error=[InvalidOperationException]::new($Message)
  $error.Data['kind']=$Kind
  throw $error
}

function Test-SSETableBooleanGeometry($Live, $Cell) {
  if (-not $Live) { return $false }
  try {
    $current=$Live.Current;$bounds=$current.BoundingRectangle
    [bool]($current.IsEnabled -and $bounds.Width -gt 0 -and $bounds.Height -gt 0 -and
      [Math]::Abs($bounds.X-$Cell.x) -le 3 -and [Math]::Abs($bounds.Y-$Cell.y) -le 3 -and
      [Math]::Abs($bounds.Width-$Cell.w) -le 3 -and [Math]::Abs($bounds.Height-$Cell.h) -le 3)
  } catch { $false }
}

function Test-SSETableBooleanBeforeClick($Window, $Binding, $X, $Y) {
  $live=Get-LiveElement $Window $Binding.cell.rid $Binding.cell.aid
  $pattern=$null
  if (-not (Test-SSETableBooleanGeometry $live $Binding.cell) -or
      -not $live.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern,[ref]$pattern)) { return $false }
  $value=$(switch (Read-SSEToggleState $pattern) {'On' {'true'} 'Off' {'false'} default {$null}})
  [bool]($null -ne $value -and $value -ceq $Binding.before)
}

function Get-SSETableBooleanPointBinding([IntPtr]$Hwnd, $Cell) {
  $px=[int]($Cell.x+$Cell.w/2);$py=[int]($Cell.y+$Cell.h/2)
  if (-not (Get-SSEPointObstruction $Hwnd $px $py).isBoundTarget) {
    return [pscustomobject]@{ok=$false;kind='obstructed';error='Checkbox-Punkt ist vom gebundenen Fenster verdeckt.'}
  }
  try {
    $point=$script:AE::FromPoint((New-Object Windows.Point($px,$py)))
    if (-not $point) { return [pscustomobject]@{ok=$false;kind='stale';error='Checkbox-Punkt lieferte kein frisches UIA-Element.'} }
    for ($level=0; $level -lt 8 -and $point; $level++) {
      if (($point.GetRuntimeId() -join '.') -ceq [string]$Cell.rid) {
        return [pscustomobject]@{ok=$true}
      }
      $point=$WLK.GetParent($point)
    }
  } catch { return [pscustomobject]@{ok=$false;kind='stale';error='Checkbox-Punkt ist nicht mehr frisch lesbar.'} }
  # Qt may expose the partly clipped tail row with IsOffscreen=false. A
  # positive rectangle alone cannot prove that its centre is clickable.
  [pscustomobject]@{ok=$false;kind='offscreen';error='Checkbox-Mittelpunkt ist nicht in der gebundenen Zelle sichtbar.'}
}

function Get-SSETableBooleanWriteSupport([IntPtr]$Hwnd, $Cell, [string]$Before, [string]$Wanted, $InputState) {
  if ($Before -ceq $Wanted) { return [pscustomobject]@{ok=$true} }
  if ($script:DESKTOP_NAME -or -not $InputState.guard -or $null -eq $InputState.tick -or
      -not (Test-SSELastInputUnchanged $InputState.tick) -or [SW]::GetForegroundWindow() -ne $Hwnd -or
      $Cell.w -le 0 -or $Cell.h -le 0) {
    return [pscustomobject]@{ok=$false;kind='foreground-required';error='Checkbox-Aenderung braucht eine gebundene sichtbare Vordergrundsitzung.'}
  }
  $previous=[SW]::EnterPhysicalDpiContext()
  if ($previous -eq [IntPtr]::Zero) { return [pscustomobject]@{ok=$false;kind='unsupported';error='Physischer Checkbox-Klick ist nicht verfuegbar.'} }
  try {
    if (-not (Test-SSETableBooleanBeforeClick $Hwnd ([pscustomobject]@{cell=$Cell;before=$Before}) 0 0)) {
      return [pscustomobject]@{ok=$false;kind='precondition-failed';error='Checkbox-Zustand oder Geometrie aenderte sich vor der Schreibvorbereitung.'}
    }
    $point=Get-SSETableBooleanPointBinding $Hwnd $Cell
  }
  finally { if (-not [SW]::RestoreDpiContext($previous)) { throw 'Checkbox-DPI-Vorpruefung konnte den Kontext nicht wiederherstellen.' } }
  if (-not $point.ok) { return $point }
  if (-not (Test-SSELastInputUnchanged $InputState.tick) -or [SW]::GetForegroundWindow() -ne $Hwnd) {
    return [pscustomobject]@{ok=$false;kind='interference';error='Fokus oder Eingabe-Epoche aenderte sich bei der Checkbox-Vorpruefung.'}
  }
  [pscustomobject]@{ok=$true}
}

function Invoke-SSETableBooleanWrite([IntPtr]$Hwnd, $Cell, [string]$ExpectedBefore,
    [string]$Wanted, $InputState) {
  if ($ExpectedBefore -cnotin @('true','false') -or $Wanted -cnotin @('true','false')) {
    Throw-SSETableBooleanError 'Checkbox braucht eindeutige boolesche Vor-/Nachwerte.' 'bad-args'
  }
  $live=Get-LiveElement $Hwnd $Cell.rid $Cell.aid
  $pattern=$null
  if (-not $live -or -not $live.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern,[ref]$pattern)) {
    Throw-SSETableBooleanError 'Checkbox-Zelle ist nicht mehr typisiert gebunden.' 'precondition-failed'
  }
  $state=Read-SSEToggleState $pattern
  $before=$(switch ($state) {'On' {'true'} 'Off' {'false'} default {$null}})
  if ($null -eq $before -or $before -cne $ExpectedBefore) {
    Throw-SSETableBooleanError 'Checkbox-Zustand aenderte sich vor dem Schreiben.' 'precondition-failed'
  }
  if (-not (Test-SSETableBooleanGeometry $live $Cell)) {
    Throw-SSETableBooleanError 'Frisch gebundene Checkbox-Geometrie stimmt nicht mehr.' 'precondition-failed'
  }
  if ($before -ceq $Wanted) { return [pscustomobject]@{before=$before;after=$before;method='noop-already-target';mutationAttempted=$false} }
  if ($script:DESKTOP_NAME) { Throw-SSETableBooleanError 'Tabellen-Checkbox braucht den sichtbaren Desktop.' 'hidden-desktop' }
  if (-not $InputState.guard -or $null -eq $InputState.tick -or -not (Test-SSELastInputUnchanged $InputState.tick) -or
      [SW]::GetForegroundWindow() -ne $Hwnd) {
    Throw-SSETableBooleanError 'Fokus oder Eingabe-Epoche ging vor dem Checkbox-Klick verloren.' 'interference'
  }
  $previous=[SW]::EnterPhysicalDpiContext()
  if ($previous -eq [IntPtr]::Zero) { Throw-SSETableBooleanError 'Physischer Checkbox-Klick ist nicht verfuegbar.' 'unsupported' }
  try {
    # One guarded click is the primary write for the supported Qt table.
    # TogglePattern is used as evidence; Toggle() is not a reliable write here.
    $click=Click-VerifiedPoint $Hwnd $Cell $InputState.tick -RequireForeground -ForegroundAttempts 1 `
      -ExpectedRuntimeId ([string]$Cell.rid) -ThrowOnFailure `
      -BeforeClickCheck {param($window,$binding,$x,$y) Test-SSETableBooleanBeforeClick $window $binding $x $y} `
      -BeforeClickBinding ([pscustomobject]@{cell=$Cell;before=$ExpectedBefore})
    $InputState.tick=$click.inputTickAfterClick
    if ($null -eq $InputState.tick) { Throw-SSETableBooleanError 'Eigene Checkbox-Eingabe-Epoche ist nicht lesbar.' 'interference' }
  } finally {
    if (-not [SW]::RestoreDpiContext($previous)) { throw 'Checkbox-DPI-Kontext konnte nicht wiederhergestellt werden.' }
  }
  for ($attempt=1; $attempt -le 3; $attempt++) {
    if (-not (Test-SSELastInputUnchanged $InputState.tick) -or [SW]::GetForegroundWindow() -ne $Hwnd) {
      Throw-SSETableBooleanError 'Fremde Eingabe oder Fokusverlust nach dem Checkbox-Klick.' 'interference'
    }
    $fresh=Get-LiveElement $Hwnd $Cell.rid $Cell.aid
    $freshPattern=$null
    $actual=$null
    if ((Test-SSETableBooleanGeometry $fresh $Cell) -and $fresh.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern,[ref]$freshPattern)) {
      $actual=$(switch (Read-SSEToggleState $freshPattern) {'On' {'true'} 'Off' {'false'} default {$null}})
    }
    if ($actual -ceq $Wanted) { return [pscustomobject]@{before=$before;after=$actual;method='verified-cell-click';mutationAttempted=$true} }
    if ($attempt -lt 3) { Start-Sleep -Milliseconds 100 }
  }
  Throw-SSETableBooleanError 'Checkbox-Nachwert ist nicht bestaetigt; kein zweiter Klick.' 'postcondition-failed'
}
