$ErrorActionPreference = 'Stop'
$files = @(
  (Join-Path $PSScriptRoot '..\powershell\start-api-hidden.ps1'),
  (Join-Path $PSScriptRoot '..\powershell\install-api-task.ps1'),
  (Join-Path $PSScriptRoot '..\powershell\api-task-common.ps1'),
  (Join-Path $PSScriptRoot 'run-hidden-copy.ps1'),
  (Join-Path $PSScriptRoot '..\powershell\run-on-desktop.ps1'),
  (Join-Path $PSScriptRoot '..\powershell\worker-transport-common.ps1')
)
$desktopLauncher = $files[4]
foreach ($file in $files) {
  $tokens = $null
  $errors = $null
  [Management.Automation.Language.Parser]::ParseFile(
    [IO.Path]::GetFullPath($file), [ref]$tokens, [ref]$errors
  ) | Out-Null
  if (@($errors).Count) { throw "$file hat Parserfehler: $(@($errors).Message -join '; ')" }
}

$install = [IO.File]::ReadAllText($files[1], [Text.Encoding]::UTF8)
foreach ($required in @(
  'wscript.exe',
  'WindowsIdentity]::GetCurrent().Name',
  'RestartCount 3',
  'ExecutionTimeLimit (New-TimeSpan -Seconds 0)',
  'dist\api-main.js',
  'Write-SseApiVbsLauncher'
)) {
  if (-not $install.Contains($required)) { throw "Autostart-Vertrag fehlt: $required" }
}
if ($install.Contains('$env:USERNAME')) { throw 'Trigger verwendet weiterhin einen unqualifizierten Benutzernamen.' }
if ($install.Contains('cmd.exe') -or $install.Contains('cmd /c')) { throw 'Autostart verwendet weiterhin ein Batch-/cmd-Fenster.' }

$invalidOperationOutput = & $desktopLauncher -Op 'health" -Command "Get-Process' -Desktop 'SSEAuto' 2>$null
if ($LASTEXITCODE -ne 1) { throw 'Desktop-Launcher hat einen injizierbaren Operationsnamen nicht abgewiesen.' }
$invalidOperation = $invalidOperationOutput | ConvertFrom-Json
if ($invalidOperation.kind -ne 'bad-args') { throw 'Desktop-Launcher meldet fuer einen ungueltigen Operationsnamen nicht bad-args.' }

$invalidDesktopOutput = & $desktopLauncher -Op 'health' -Desktop 'WinSta0\Default' 2>$null
if ($LASTEXITCODE -ne 1) { throw 'Desktop-Launcher hat einen fremden/verschachtelten Desktopnamen nicht abgewiesen.' }
$invalidDesktop = $invalidDesktopOutput | ConvertFrom-Json
if ($invalidDesktop.kind -ne 'bad-args') { throw 'Desktop-Launcher meldet fuer einen ungueltigen Desktopnamen nicht bad-args.' }

$invalidBase64Output = & $desktopLauncher -Op 'health' -B64 'e30=" -Command' -Desktop 'SSEAuto' 2>$null
if ($LASTEXITCODE -ne 1) { throw 'Desktop-Launcher hat ein injizierbares Base64-Argument nicht abgewiesen.' }
$invalidBase64 = $invalidBase64Output | ConvertFrom-Json
if ($invalidBase64.kind -ne 'bad-args') { throw 'Desktop-Launcher meldet fuer ungueltiges Base64 nicht bad-args.' }

$desktopLauncherSource = [IO.File]::ReadAllText($desktopLauncher, [Text.Encoding]::UTF8)
if (-not $desktopLauncherSource.Contains("`$cmd.Append(' -ArgsFile")) {
  throw 'Desktop-Launcher reicht die interne Argumentdatei nicht an den Worker weiter.'
}
$invalidArgsFileOutput = & $desktopLauncher -Op 'health' -ArgsFile $files[0] -Desktop 'SSEAuto' 2>$null
if ($LASTEXITCODE -ne 1) { throw 'Desktop-Launcher hat eine Argumentdatei ausserhalb des Temp-Roots nicht abgewiesen.' }
$invalidArgsFile = $invalidArgsFileOutput | ConvertFrom-Json
if ($invalidArgsFile.kind -ne 'bad-args') { throw 'Desktop-Launcher meldet fuer eine fremde Argumentdatei nicht bad-args.' }
$ambiguousArgsOutput = & $desktopLauncher -Op 'health' -B64 'e30=' -ArgsFile $files[0] -Desktop 'SSEAuto' 2>$null
if ($LASTEXITCODE -ne 1) { throw 'Desktop-Launcher hat B64 und ArgsFile gemeinsam akzeptiert.' }
if (($ambiguousArgsOutput | ConvertFrom-Json).kind -ne 'bad-args') {
  throw 'Desktop-Launcher meldet fuer doppelte Argumenttransporte nicht bad-args.'
}

. $files[2]
$portableRoot = Join-Path $env:TEMP ('sse-task-contract-' + [guid]::NewGuid().ToString('N'))
try {
  $portableRuntime = Join-Path $portableRoot 'runtime'
  New-Item -ItemType Directory -Path $portableRuntime -Force | Out-Null
  $portableNode = Join-Path $portableRuntime 'node.exe'
  [IO.File]::WriteAllBytes($portableNode, [byte[]](0))
  if ((Resolve-SseNodePath -RepoRoot $portableRoot) -ne $portableNode) {
    throw 'Portable runtime\node.exe wird nicht vor globalem node.exe bevorzugt.'
  }
} finally {
  if (Test-Path -LiteralPath $portableRoot) { Remove-Item -LiteralPath $portableRoot -Recurse -Force }
}
$node = 'C:\Program Files\nodejs\node.exe'
$api = 'D:\Portable SSE\dist\api-main.js'
$config = 'D:\SSE Config\config.json'
$vbs = (New-SseApiVbsContent -NodePath $node -ApiMainPath $api -ConfigPath $config).TrimEnd()
if ($vbs -notmatch '^CreateObject\("WScript\.Shell"\)\.Run """.*node\.exe"" "".*api-main\.js"" --config "".*config\.json""", 0, True$') {
  throw "Fensterloser VBS-Aufruf ist nicht korrekt gequotet: $vbs"
}

$launcherRoot = Join-Path $env:TEMP ('sse-launcher-contract-' + [guid]::NewGuid().ToString('N'))
try {
  New-Item -ItemType Directory -Path $launcherRoot | Out-Null
  $launcherConfig = Join-Path $launcherRoot 'config.json'
  [IO.File]::WriteAllText($launcherConfig, '{}', [Text.UTF8Encoding]::new($false))
  $launcher = Write-SseApiVbsLauncher -NodePath $node -ApiMainPath $api -ConfigPath $launcherConfig
  $reused = Write-SseApiVbsLauncher -NodePath $node -ApiMainPath $api -ConfigPath $launcherConfig
  if ($reused -ne $launcher) { throw 'Bytegleicher Launcher wurde nicht stabil wiederverwendet.' }
  [IO.File]::WriteAllText($launcher, 'fremder Inhalt', [Text.UTF8Encoding]::new($false))
  $foreign = [IO.File]::ReadAllBytes($launcher)
  try {
    $null = Write-SseApiVbsLauncher -NodePath $node -ApiMainPath $api -ConfigPath $launcherConfig
    throw 'Fremder inhaltsadressierter Launcher wurde still akzeptiert.'
  } catch {
    if ($_.Exception.Message -eq 'Fremder inhaltsadressierter Launcher wurde still akzeptiert.') { throw }
  }
  if ([BitConverter]::ToString([IO.File]::ReadAllBytes($launcher)) -ne [BitConverter]::ToString($foreign)) {
    throw 'Fremder inhaltsadressierter Launcher wurde ueberschrieben.'
  }
} finally {
  if (Test-Path -LiteralPath $launcherRoot) { Remove-Item -LiteralPath $launcherRoot -Recurse -Force }
}

Write-Output 'OK: Setup-/Autostartskripte sind syntaktisch, fensterlos und kollisionssicher verdrahtet.'
