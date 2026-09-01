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

# Get-Windows bleibt im Worker unter Controller-/Desktop-Bindung, aber die
# teure EnumWindows-Callbackschleife laeuft nativ. Zwei transparente
# Testfenster pruefen die Ergebnisparitaet gegen den frueheren PowerShell-Weg,
# ohne auf eine installierte SteuerSparErklaerung angewiesen zu sein.
Add-Type -AssemblyName System.Drawing, System.Windows.Forms
$forms = New-Object System.Collections.ArrayList
function Get-TextSha256([string]$Text) {
  $algorithm = [Security.Cryptography.SHA256]::Create()
  try {
    $bytes = [Text.Encoding]::UTF8.GetBytes($Text)
    ([BitConverter]::ToString($algorithm.ComputeHash($bytes))).Replace('-', '')
  } finally { $algorithm.Dispose() }
}
function Get-LegacyWindowProjection([int[]]$AllowedProcessIds) {
  $allowed = @($AllowedProcessIds)
  $records = New-Object System.Collections.ArrayList
  $callback = [SW+EP]{
    param($hwnd, $context)
    $ownerPid = 0
    [SW]::GetWindowThreadProcessId($hwnd, [ref]$ownerPid) | Out-Null
    if ($allowed -contains [int]$ownerPid -and [SW]::IsWindowVisible($hwnd)) {
      $title = New-Object Text.StringBuilder 512
      $className = New-Object Text.StringBuilder 256
      $rectangle = New-Object SW+RC
      [SW]::GetWindowTextW($hwnd, $title, 512) | Out-Null
      [SW]::GetClassNameW($hwnd, $className, 256) | Out-Null
      [SW]::GetWindowRect($hwnd, [ref]$rectangle) | Out-Null
      $titleText = $title.ToString()
      $null = $records.Add([pscustomobject][ordered]@{
        hwnd=[int64]$hwnd; pid=[int]$ownerPid
        x=[int]$rectangle.L; y=[int]$rectangle.T
        w=[int]($rectangle.R - $rectangle.L); h=[int]($rectangle.B - $rectangle.T)
        cls=$className.ToString(); title=$titleText
        titleFingerprint=Get-TextSha256 $titleText
        hung=[bool][SW]::IsHungAppWindow($hwnd); minimiert=[bool][SW]::IsIconic($hwnd)
      })
    }
    $true
  }
  [SW]::EnumWindows($callback, [IntPtr]::Zero) | Out-Null
  @($records)
}

# Die private Auswertung der Win32-Rueckgabe ist absichtlich kein oeffentlicher
# API-Vertrag. Per Reflection lassen sich die ansonsten schwer deterministisch
# provozierbaren Fehlerpfade trotzdem pruefen: Callback-Abbruch, Win32-Fehler
# und FALSE nach begonnenem Callback duerfen nie als Teilergebnis zurueckkehren.
$completionCheck = [SSEWindowEnumerator].GetMethod(
  'EnsureEnumerationCompleted',
  [Reflection.BindingFlags]'Static, NonPublic')
Assert-True ($null -ne $completionCheck) `
  'Die fail-closed Auswertung von EnumWindows ist nicht auffindbar.'

$callbackFailure = [InvalidOperationException]::new('deterministic-callback-failure')
$observedCallbackFailure = $null
try {
  $completionCheck.Invoke($null, [object[]]@($false, [int]5, [int]1, $callbackFailure))
} catch {
  $observedCallbackFailure = $_.Exception
  while ($null -ne $observedCallbackFailure.InnerException) {
    $observedCallbackFailure = $observedCallbackFailure.InnerException
  }
}
Assert-True ($observedCallbackFailure -is [InvalidOperationException] -and
  $observedCallbackFailure.Message -ceq $callbackFailure.Message) `
  'Ein Callback-Abbruch wurde vom gleichzeitig gesetzten Win32-Fehler verdeckt.'

$observedNativeFailure = $null
try {
  $completionCheck.Invoke($null, [object[]]@($false, [int]5, [int]0, $null))
} catch {
  $observedNativeFailure = $_.Exception
  while ($null -ne $observedNativeFailure.InnerException) {
    $observedNativeFailure = $observedNativeFailure.InnerException
  }
}
Assert-True ($observedNativeFailure -is [ComponentModel.Win32Exception]) `
  'Ein EnumWindows-Win32-Fehler wurde nicht typisiert weitergereicht.'
Assert-True ($observedNativeFailure.NativeErrorCode -eq 5) `
  "EnumWindows meldete den falschen nativen Fehlercode '$($observedNativeFailure.NativeErrorCode)'."

$observedUnexplainedFailure = $null
try {
  $completionCheck.Invoke($null, [object[]]@($false, [int]0, [int]1, $null))
} catch {
  $observedUnexplainedFailure = $_.Exception
  while ($null -ne $observedUnexplainedFailure.InnerException) {
    $observedUnexplainedFailure = $observedUnexplainedFailure.InnerException
  }
}
Assert-True ($observedUnexplainedFailure -is [InvalidOperationException]) `
  'Eine partielle EnumWindows-Rueckgabe wurde faelschlich als Ergebnis akzeptiert.'
Assert-True ($observedUnexplainedFailure.Message -ceq 'window-enumeration-failed') `
  'Eine partielle EnumWindows-Rueckgabe liefert keinen stabilen, redigierten Fehler.'

# Ein wirklich leerer privater Desktop liefert FALSE/0 ohne Callback und ist
# kein Fehler. Erfolg darf ausserdem einen vorigen/stalen Threadfehler ignorieren.
$completionCheck.Invoke($null, [object[]]@($false, [int]0, [int]0, $null))
$completionCheck.Invoke($null, [object[]]@($true, [int]5, [int]2, $null))

try {
  $unicodeTitle = "SSE native enumeration $([char]0x2013) SteuerSparErkl$([char]0x00E4)rung $PID"
  $equalAreaTitle = "SSE native enumeration equal area $PID"
  foreach ($specification in @(
    @{ title=$unicodeTitle; width=211; height=137 },
    @{ title="SSE native enumeration large $PID"; width=347; height=229 },
    @{ title=$equalAreaTitle; width=211; height=137 }
  )) {
    $form = New-Object Windows.Forms.Form
    $form.Text = $specification.title
    $form.StartPosition = [Windows.Forms.FormStartPosition]::Manual
    $form.Location = New-Object Drawing.Point -ArgumentList -10000, -10000
    $form.Size = New-Object Drawing.Size -ArgumentList $specification.width, $specification.height
    $form.ShowInTaskbar = $false
    $form.Opacity = 0
    $form.Show()
    $null = $forms.Add($form)
  }
  [Windows.Forms.Application]::DoEvents()

  $allowedIds = [int[]]@($PID)
  $fixtureHandles = @($forms | ForEach-Object { [int64]$_.Handle })
  $legacyRaw = @(Get-LegacyWindowProjection $allowedIds |
    Where-Object { [int64]$_.hwnd -in $fixtureHandles })
  $legacy = @($legacyRaw | Sort-Object hwnd)
  $nativeRaw = @([SSEWindowEnumerator]::Describe($allowedIds))
  $native = @($nativeRaw | ForEach-Object {
    [pscustomobject][ordered]@{
      hwnd=[int64]$_.Hwnd; pid=[int]$_.Pid
      x=[int]$_.X; y=[int]$_.Y; w=[int]$_.W; h=[int]$_.H
      cls=[string]$_.ClassName; title=[string]$_.Title
      titleFingerprint=[string]$_.TitleFingerprint
      hung=[bool]$_.Hung; minimiert=[bool]$_.Minimized
    }
  } | Where-Object { [int64]$_.hwnd -in $fixtureHandles } | Sort-Object hwnd)
  Assert-True ($legacy.Count -eq $forms.Count) 'Die transparenten Fenster wurden vom Referenzweg nicht exakt enumeriert.'
  Assert-True (($legacy | ConvertTo-Json -Depth 3 -Compress) -ceq ($native | ConvertTo-Json -Depth 3 -Compress)) `
    'Native Fensterenumeration weicht in Inhalt oder Typen vom bisherigen PowerShell-Weg ab.'
  foreach ($title in @($unicodeTitle, "SSE native enumeration large $PID", $equalAreaTitle)) {
    Assert-True (@($native | Where-Object title -CEQ $title).Count -eq 1) `
      "Natives Ergebnis enthaelt Testfenster '$title' nicht exakt einmal."
  }

  $equalAreaHandles = @([int64]$forms[0].Handle, [int64]$forms[2].Handle)
  $equalAreaNative = @($nativeRaw |
    Where-Object { [int64]$_.Hwnd -in $equalAreaHandles })
  Assert-True ($equalAreaNative.Count -eq 2) `
    'Die beiden gleich grossen Fenster fehlen im nativen Ergebnis.'
  $firstArea = [int64]$equalAreaNative[0].W * [int64]$equalAreaNative[0].H
  $secondArea = [int64]$equalAreaNative[1].W * [int64]$equalAreaNative[1].H
  Assert-True ($firstArea -eq $secondArea) `
    'Die Tie-Break-Probe erzeugte keine Fenster mit exakt gleicher Flaeche.'
  $legacyEqualOrder = @($legacyRaw |
    Where-Object { [int64]$_.hwnd -in $equalAreaHandles } |
    ForEach-Object { [int64]$_.hwnd })
  $nativeEqualOrder = @($equalAreaNative | ForEach-Object { [int64]$_.Hwnd })
  Assert-True (($legacyEqualOrder | ConvertTo-Json -Compress) -ceq ($nativeEqualOrder | ConvertTo-Json -Compress)) `
    'Fenster mit gleicher Flaeche behalten nicht ihre EnumWindows-Reihenfolge.'

  for ($index = 1; $index -lt $nativeRaw.Count; $index++) {
    $previousArea = [int64]$nativeRaw[$index - 1].W * [int64]$nativeRaw[$index - 1].H
    $currentArea = [int64]$nativeRaw[$index].W * [int64]$nativeRaw[$index].H
    Assert-True ($previousArea -ge $currentArea) 'Native Fenster sind nicht absteigend nach Flaeche sortiert.'
  }
  Assert-True (@([SSEWindowEnumerator]::Describe([int[]]@())).Count -eq 0) `
    'Eine leere PID-Freigabe darf keine Fenster liefern.'
  $duplicatePidWindows = @([SSEWindowEnumerator]::Describe([int[]]@($PID, $PID)) |
    Where-Object { [int64]$_.Hwnd -in $fixtureHandles })
  Assert-True ($duplicatePidWindows.Count -eq $forms.Count) `
    'Doppelte freigegebene PIDs duerfen keine Fenster duplizieren.'
} finally {
  foreach ($form in @($forms)) {
    try { $form.Close() } finally { $form.Dispose() }
  }
}

Write-Output 'OK: Desktop- und native Fensterenumeration bleiben leer-/fehler-/paritaetssicher.'
