<#
  A freshly created private desktop owns no top-level window. Win32
  EnumDesktopWindows signals that state with FALSE while leaving the thread
  error untouched, so the shared helper must report "no windows" instead of
  raising whatever stale error the thread happened to carry. The hidden-start
  poll calls this helper on the very first iteration, where an empty desktop is
  the normal case, not a failure.
#>
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot '..\powershell\load-native.ps1')

function Assert-True([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw $Message }
}

$load = Import-SSENativeInterop
Assert-True ($load.mode -in @('precompiled-dll', 'source-fallback', 'already-loaded')) `
  "Nativer Interop-Loader meldete einen unbekannten Modus '$($load.mode)'."

$GENERIC_ALL = 0x10000000
$desktopName = "SSEEnumProbe$PID"
Assert-True ($desktopName -match '^[A-Za-z0-9]+$') 'Der Probename ist kein validierter ASCII-Desktopname.'

$desktop = [DSK]::CreateDesktop($desktopName, [IntPtr]::Zero, [IntPtr]::Zero, 0, $GENERIC_ALL, [IntPtr]::Zero)
Assert-True ($desktop -ne [IntPtr]::Zero) `
  "Testdesktop liess sich nicht anlegen (Fehler $([Runtime.InteropServices.Marshal]::GetLastWin32Error()))."

try {
  # Root cause, asserted directly: the raw Win32 call reports FALSE for an
  # empty desktop without touching the thread error. Should a future Windows
  # ever change that, this fails loudly instead of leaving the wrapper's
  # tolerance silently unjustified.
  $collected = New-Object System.Collections.ArrayList
  $callback = [DSK+EP]{ param($hwnd, $context) $null = $collected.Add($hwnd); $true }
  [DSK]::SetLastError(203)
  $rawResult = [DSK]::EnumDesktopWindows($desktop, $callback, [IntPtr]::Zero)
  $rawError = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
  Assert-True (-not $rawResult) `
    'EnumDesktopWindows meldete auf einem leeren Desktop Erfolg; die Annahme der Huelle ist ueberholt.'
  Assert-True ($collected.Count -eq 0) 'Der leere Testdesktop lieferte unerwartet Fenster.'
  Assert-True ($rawError -eq 203) `
    "EnumDesktopWindows setzte auf dem leeren Desktop den Fehler $rawError statt den Thread-Wert zu belassen."

  # Genau dieser Fremdfehler darf nicht als Enumerationsfehler durchschlagen.
  [DSK]::SetLastError(203)
  $windows = @([DSK]::ListDesktopWindows($desktop))
  Assert-True ($windows.Count -eq 0) `
    "Leerer Desktop lieferte $($windows.Count) Fenster statt einer leeren Liste."

  # The same call must stay repeatable; the helper may not latch an error state.
  [DSK]::SetLastError(6)
  $again = @([DSK]::ListDesktopWindows($desktop))
  Assert-True ($again.Count -eq 0) 'Wiederholte Enumeration des leeren Desktops war nicht stabil.'
} finally {
  [DSK]::CloseDesktop($desktop) | Out-Null
}

# A genuinely invalid handle must still fail closed instead of returning empty.
# IntPtr.Zero is not usable here: Win32 reads NULL as "the calling thread's
# desktop", so a bogus non-null handle is the only real negative case.
$invalidRejected = $false
try {
  $null = [DSK]::ListDesktopWindows([IntPtr]0x7FFFFFF0)
} catch {
  $invalidRejected = $true
}
Assert-True $invalidRejected 'Ein ungueltiges Desktop-Handle wurde nicht als Fehler gemeldet.'

# The current input desktop always owns windows; that proves the empty result
# above is a real observation and not a silently swallowed failure.
$input = [DSK]::OpenDesktop('Default', 0, $false, $GENERIC_ALL)
Assert-True ($input -ne [IntPtr]::Zero) 'Der Default-Desktop liess sich nicht read-only oeffnen.'
try {
  $populated = @([DSK]::ListDesktopWindows($input))
  Assert-True ($populated.Count -gt 0) 'Der Default-Desktop lieferte keine Fenster; die Enumeration ist wirkungslos.'
} finally {
  [DSK]::CloseDesktop($input) | Out-Null
}

Write-Output 'OK: Leerer Privatdesktop enumeriert leer, ungueltiges Handle bleibt fail-closed.'
