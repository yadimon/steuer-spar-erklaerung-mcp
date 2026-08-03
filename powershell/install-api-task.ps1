param(
  [Parameter(Mandatory = $true)]
  [string]$RepoRoot,
  [Parameter(Mandatory = $true)]
  [string]$ConfigPath,
  [string]$TaskName = 'SteuerSparErklaerungApi',
  [switch]$Replace,
  [switch]$StartNow
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'api-task-common.ps1')
$repo = [IO.Path]::GetFullPath($RepoRoot)
$config = [IO.Path]::GetFullPath($ConfigPath)
$apiMain = Join-Path $repo 'dist\api-main.js'
if (-not (Test-Path -LiteralPath $config -PathType Leaf)) { throw "API-Konfiguration fehlt: $config" }
if (-not (Test-Path -LiteralPath $apiMain -PathType Leaf)) { throw "Gebaute API fehlt: $apiMain" }
$node = Resolve-SseNodePath -RepoRoot $repo
$wscript = Join-Path $env:WINDIR 'System32\wscript.exe'
if (-not (Test-Path -LiteralPath $wscript -PathType Leaf)) { throw "Fensterloser Windows-Script-Host fehlt: $wscript" }

$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existing -and -not $Replace) {
  throw "Aufgabe '$TaskName' existiert bereits. Erst pruefen; zum bewussten Ersetzen -Replace angeben."
}

$configStem = [IO.Path]::GetFileNameWithoutExtension($config)
if (-not $configStem) { $configStem = 'config' }
$vbsPath = Join-Path (Split-Path -Parent $config) "start-sse-api.$configStem.hidden.vbs"
$vbs = New-SseApiVbsContent -NodePath $node -ApiMainPath $apiMain -ConfigPath $config
[IO.File]::WriteAllText($vbsPath, $vbs, [Text.UTF8Encoding]::new($false))

$arguments = '//B //NoLogo "' + $vbsPath + '"'
$action = New-ScheduledTaskAction -Execute $wscript -Argument $arguments -WorkingDirectory $repo
$identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $identity
$principal = New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Seconds 0)
$task = New-ScheduledTask -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Lokale loopback-only API fuer den SteuerSparErklaerung-MCP-Wrapper.'
Register-ScheduledTask -TaskName $TaskName -InputObject $task -Force:$Replace | Out-Null
if ($StartNow) { Start-ScheduledTask -TaskName $TaskName }

[pscustomobject]@{
  ok = $true
  taskName = $TaskName
  started = [bool]$StartNow
  executable = $wscript
  launcher = $vbsPath
  config = $config
} | ConvertTo-Json -Depth 3
