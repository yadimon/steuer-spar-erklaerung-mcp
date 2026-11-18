$ErrorActionPreference='Stop'
[Console]::InputEncoding=[Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$stream=$null;$sha=[Security.Cryptography.SHA256]::Create()
function Hash-Bytes([byte[]]$Bytes){[BitConverter]::ToString($sha.ComputeHash($Bytes)).Replace('-','')}
function Read-LockedBytes($File){
  if($File.Length -lt 1 -or $File.Length -gt 1MB){throw 'Invalid byte bound'}
  $bytes=New-Object byte[] ([int]$File.Length);$offset=0;$File.Position=0
  while($offset -lt $bytes.Length){$count=$File.Read($bytes,$offset,$bytes.Length-$offset);if($count -le 0){throw 'Short read'};$offset+=$count}
  return ,$bytes
}
function Write-LockedBytes($File,[byte[]]$Bytes){
  $File.Position=0;$File.Write($Bytes,0,$Bytes.Length);$File.SetLength($Bytes.Length);$File.Flush($true)
}
function Save-PrivatePreimage([string]$Path,[byte[]]$Bytes){
  $acl=[Security.AccessControl.FileSecurity]::new();$acl.SetAccessRuleProtection($true,$false)
  $owner=[Security.Principal.WindowsIdentity]::GetCurrent().User;$acl.SetOwner($owner)
  foreach($sid in @($owner,[Security.Principal.SecurityIdentifier]::new('S-1-5-18'))){
    $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid,[Security.AccessControl.FileSystemRights]::FullControl,[Security.AccessControl.AccessControlType]::Allow))
  }
  $rights=[Security.AccessControl.FileSystemRights]::Read -bor [Security.AccessControl.FileSystemRights]::Write
  $recovery=[IO.FileStream]::new($Path,[IO.FileMode]::CreateNew,$rights,[IO.FileShare]::None,4096,[IO.FileOptions]::None,$acl)
  try {
    if(-not ($recovery.GetAccessControl()).AreAccessRulesProtected){throw 'Unprotected recovery file'}
    Write-LockedBytes $recovery $Bytes
    if((Hash-Bytes (Read-LockedBytes $recovery)) -cne (Hash-Bytes $Bytes)){throw 'Recovery preimage mismatch'}
  } finally {$recovery.Dispose()}
}
$result=& { try {
  $request=[Console]::In.ReadToEnd()|ConvertFrom-Json
  if(-not [IO.Path]::IsPathRooted([string]$request.path) -or -not [IO.Path]::IsPathRooted([string]$request.recoveryPath) -or
      [string]$request.expectedHash -cnotmatch '^[A-F0-9]{64}$' -or [string]$request.newHash -cnotmatch '^[A-F0-9]{64}$') {throw 'Invalid request'}
  $replacement=[Convert]::FromBase64String([string]$request.bytesBase64)
  if($replacement.Length -lt 1 -or $replacement.Length -gt 1MB -or (Hash-Bytes $replacement) -cne [string]$request.newHash){throw 'Invalid replacement'}
  if([string]$request.mode -ceq 'private-copy'){
    Save-PrivatePreimage ([string]$request.path) $replacement
    return [pscustomobject]@{ok=$true;writePerformed=$true;beforeHash=$null;afterHash=[string]$request.newHash}
  }
  if([string]$request.mode -cne 'compare-and-write'){throw 'Invalid mode'}
  $attributes=[IO.File]::GetAttributes([string]$request.path)
  if(($attributes -band [IO.FileAttributes]::ReparsePoint) -or ($attributes -band [IO.FileAttributes]::Directory)){throw 'Invalid target'}
  try {$stream=[IO.File]::Open([string]$request.path,[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)}
  catch {return [pscustomobject]@{ok=$false;kind='locked-or-unavailable';rollbackVerified=$false}}
  $current=Read-LockedBytes $stream;$before=Hash-Bytes $current
  if($before -cne [string]$request.expectedHash){
    [pscustomobject]@{ok=$false;kind='cas-mismatch';rollbackVerified=$false}
  } elseif($before -ceq [string]$request.newHash){
    [pscustomobject]@{ok=$true;writePerformed=$false;beforeHash=$before;afterHash=$before}
  } else {
    Save-PrivatePreimage ([string]$request.recoveryPath) $current
    try {
      Write-LockedBytes $stream $replacement
      $after=Hash-Bytes (Read-LockedBytes $stream)
      if($after -cne [string]$request.newHash){throw 'Readback mismatch'}
      [pscustomobject]@{ok=$true;writePerformed=$true;beforeHash=$before;afterHash=$after}
    } catch {
      $rolledBack=$false
      try {Write-LockedBytes $stream $current;$rolledBack=((Hash-Bytes (Read-LockedBytes $stream)) -ceq $before)}catch{}
      [pscustomobject]@{ok=$false;kind='write-failed';rollbackVerified=$rolledBack}
    }
  }
} catch {[pscustomobject]@{ok=$false;kind='invalid-or-unavailable';rollbackVerified=$false}}
finally {if($stream){$stream.Dispose()};$sha.Dispose()} }
if($null -eq $result){$result=[pscustomobject]@{ok=$false;kind='protocol-error';rollbackVerified=$false}}
[Console]::Out.WriteLine(($result|ConvertTo-Json -Compress))
if($result.ok -ne $true){exit 1}
