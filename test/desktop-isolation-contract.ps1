$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../powershell/load-native.ps1')
$null=Import-SSENativeInterop
Add-Type -AssemblyName System.Windows.Forms
$method=[DSK].GetMethod('IsIsolatedWindowDesktop',[Reflection.BindingFlags]'Public,Static')
if (-not $method -or $method.ReturnType -ne [bool] -or $method.GetParameters().Count -ne 2 -or
    $method.GetParameters()[0].ParameterType -ne [IntPtr] -or $method.GetParameters()[1].ParameterType -ne [string]) {
  throw 'The native desktop isolation boundary lost its exact signature.'
}
$window=New-Object Windows.Forms.NativeWindow
$parameters=New-Object Windows.Forms.CreateParams
$parameters.Caption='Synthetic desktop isolation fixture'
$parameters.Parent=[IntPtr](-3) # HWND_MESSAGE: no visible surface or activation.
$unknownDesktop='SyntheticMissing'+[Guid]::NewGuid().ToString('N')
$handle=[IntPtr]::Zero
try {
  $window.CreateHandle($parameters)
  $handle=$window.Handle
  if ($handle -eq [IntPtr]::Zero -or
      [DSK]::IsIsolatedWindowDesktop($handle,$unknownDesktop) -or
      [DSK]::IsIsolatedWindowDesktop($handle,'') -or
      [DSK]::IsIsolatedWindowDesktop([IntPtr]::Zero,$unknownDesktop)) {
    throw 'A missing desktop name, window, or actual desktop mismatch authorized isolation.'
  }
} finally { $window.DestroyHandle() }
if ([DSK]::IsIsolatedWindowDesktop($handle,$unknownDesktop)) {
  throw 'A destroyed own message-only window authorized isolation.'
}
Write-Output 'Native desktop isolation: real interop rejects missing, mismatched and destroyed own targets without visible input.'
