$ErrorActionPreference='Stop'
if($PSVersionTable.PSEdition -ne 'Desktop' -or $PSVersionTable.PSVersion.Major -ne 5){
  throw 'GUI lifetime probe must be built with Windows PowerShell 5.1.'
}
$source=Join-Path $PSScriptRoot 'gui-launch-lifetime.cs'
$target=Join-Path $PSScriptRoot 'gui-launch-lifetime.exe'
$manifest=Join-Path $PSScriptRoot 'gui-launch-lifetime.sha256'
$temporary=Join-Path $PSScriptRoot ('.gui-launch-lifetime-'+[guid]::NewGuid().ToString('N')+'.exe')
$backup=$temporary+'.replace'
$manifestTemporary=$temporary+'.sha256'
$manifestBackup=$temporary+'.sha256.replace'
function Get-ProbeHash([string]$Path,[long]$Maximum){
  $item=Get-Item -LiteralPath $Path -Force
  if($item.PSIsContainer -or $item.Length -gt $Maximum){throw 'GUI lifetime build input exceeds its bound.'}
  $algorithm=[Security.Cryptography.SHA256]::Create()
  $stream=[IO.File]::OpenRead($Path)
  try{
    if($stream.Length -gt $Maximum){throw 'GUI lifetime build input exceeds its bound.'}
    ([BitConverter]::ToString($algorithm.ComputeHash($stream)) -replace '-','').ToUpperInvariant()
  }finally{$stream.Dispose();$algorithm.Dispose()}
}
$sourceHash=Get-ProbeHash $source 64KB
$reusable=$false
if((Test-Path -LiteralPath $manifest -PathType Leaf) -and (Test-Path -LiteralPath $target -PathType Leaf)){
  try{
    $null=Get-ProbeHash $manifest 1KB
    $saved=Get-Content -LiteralPath $manifest -Raw | ConvertFrom-Json
    $reusable=@($saved.PSObject.Properties.Name).Count -eq 3 -and
      $saved.schemaVersion -is [int] -and $saved.schemaVersion -eq 1 -and
      $saved.sourceSha256 -is [string] -and $saved.sourceSha256 -ceq $sourceHash -and
      $saved.exeSha256 -is [string] -and
      $saved.exeSha256 -ceq (Get-ProbeHash $target 128KB)
  }catch{$reusable=$false}
}
if($reusable){Write-Verbose 'Reused powershell/gui-launch-lifetime.exe';return}
try{
  Add-Type -Path $source -OutputAssembly $temporary -OutputType ConsoleApplication
  $exeHash=Get-ProbeHash $temporary 128KB
  $bytes=[IO.File]::ReadAllBytes($temporary)
  $assembly=[Reflection.Assembly]::ReflectionOnlyLoad($bytes)
  if($assembly.EntryPoint.DeclaringType.FullName -cne 'SSEGuiLaunchLifetimeProbe'){
    throw 'GUI lifetime probe has the wrong entry point.'
  }
  $json=[ordered]@{schemaVersion=1;sourceSha256=$sourceHash;exeSha256=$exeHash}|ConvertTo-Json -Compress
  [IO.File]::WriteAllText($manifestTemporary,$json+[Environment]::NewLine,[Text.UTF8Encoding]::new($false))
  if(Test-Path -LiteralPath $target){[IO.File]::Replace($temporary,$target,$backup)}else{[IO.File]::Move($temporary,$target)}
  if(Test-Path -LiteralPath $manifest){[IO.File]::Replace($manifestTemporary,$manifest,$manifestBackup)}else{[IO.File]::Move($manifestTemporary,$manifest)}
  if((Get-ProbeHash $target 128KB) -cne $exeHash){throw 'Installed GUI lifetime probe hash differs.'}
  Write-Verbose 'Built powershell/gui-launch-lifetime.exe'
}finally{
  foreach($path in @($temporary,$backup,$manifestTemporary,$manifestBackup)){
    if(Test-Path -LiteralPath $path){Remove-Item -LiteralPath $path -Force}
  }
}
