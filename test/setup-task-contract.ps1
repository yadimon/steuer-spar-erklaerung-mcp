$ErrorActionPreference = 'Stop'
$files = @(
  (Join-Path $PSScriptRoot '..\powershell\start-api-hidden.ps1'),
  (Join-Path $PSScriptRoot '..\powershell\install-api-task.ps1'),
  (Join-Path $PSScriptRoot '..\powershell\api-task-common.ps1'),
  (Join-Path $PSScriptRoot 'run-hidden-copy.ps1'),
  (Join-Path $PSScriptRoot '..\powershell\run-on-desktop.ps1')
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
  'start-sse-api.$configStem.hidden.vbs'
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

Write-Output 'OK: Setup-/Autostartskripte sind syntaktisch gueltig und fensterlos verdrahtet.'
