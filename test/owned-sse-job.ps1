param([Parameter(Mandatory)][string]$IdentityFile)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=New-Object Text.UTF8Encoding($false)
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class KnowledgeJob {
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]public static extern IntPtr CreateJobObjectW(IntPtr attributes,string name);
 [DllImport("kernel32.dll",SetLastError=true)]public static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
 [DllImport("kernel32.dll",SetLastError=true)]public static extern bool IsProcessInJob(IntPtr process,IntPtr job,out bool member);
 [DllImport("kernel32.dll",SetLastError=true)]public static extern bool QueryInformationJobObject(IntPtr job,int info,out Accounting data,uint size,out uint length);
 [DllImport("kernel32.dll")]public static extern bool CloseHandle(IntPtr handle);
 [StructLayout(LayoutKind.Sequential)]public struct Accounting {
  public long UserTime,KernelTime,PeriodUserTime,PeriodKernelTime;
  public uint PageFaults,TotalProcesses,ActiveProcesses,TerminatedProcesses;
 }
}
'@
function Emit($Value){[Console]::Out.WriteLine((ConvertTo-Json -InputObject $Value -Compress -Depth 5));[Console]::Out.Flush()}
function Open-Exact($Identity){
 $p=Get-Process -Id ([int]$Identity.pid) -ErrorAction Stop
 try{
  if($p.StartTime.ToUniversalTime().Ticks.ToString() -cne [string]$Identity.startedTicks -or $p.Path -ine [string]$Identity.path){throw 'Process lifetime/path changed.'}
  return $p
 }catch{$p.Dispose();throw}
}
$job=[IntPtr]::Zero
$root=$null
try{
 $identity=Get-Content -Raw -LiteralPath $IdentityFile|ConvertFrom-Json
 if([IO.Path]::GetFileName([string]$identity.path) -ine 'SSE.exe'){throw 'Only an exact owned SSE root may be assigned.'}
 $root=Open-Exact $identity
 $job=[KnowledgeJob]::CreateJobObjectW([IntPtr]::Zero,$null)
 if($job -eq [IntPtr]::Zero -or -not [KnowledgeJob]::AssignProcessToJobObject($job,$root.Handle)){throw 'Own SSE could not be assigned to a diagnostic job.'}
 # No kill-on-close or breakaway flags. Normal application close is the only cleanup.
 Emit @{ok=$true;ready=$true;rootPid=$identity.pid;forceTermination=$false}
 while($null -ne ($line=[Console]::In.ReadLine())){
  try{
   if($line.Length -gt 4096){throw 'Command exceeds diagnostic limit.'}
   $request=$line|ConvertFrom-Json
   if($request.op -ceq 'counts'){
    $data=New-Object KnowledgeJob+Accounting;$length=[uint32]0
    if(-not [KnowledgeJob]::QueryInformationJobObject($job,1,[ref]$data,[uint32][Runtime.InteropServices.Marshal]::SizeOf([type][KnowledgeJob+Accounting]),[ref]$length)){throw 'Job inventory unavailable.'}
    Emit @{ok=$true;active=$data.ActiveProcesses;total=$data.TotalProcesses}
   }elseif($request.op -ceq 'member'){
    $p=Open-Exact $request.identity
    try{
     $member=$false
     if(-not [KnowledgeJob]::IsProcessInJob($p.Handle,$job,[ref]$member)){throw 'Membership query failed.'}
     Emit @{ok=$true;pid=$p.Id;member=$member}
    }finally{$p.Dispose()}
   }elseif($request.op -ceq 'finish'){
    $data=New-Object KnowledgeJob+Accounting;$length=[uint32]0
    if(-not [KnowledgeJob]::QueryInformationJobObject($job,1,[ref]$data,[uint32][Runtime.InteropServices.Marshal]::SizeOf([type][KnowledgeJob+Accounting]),[ref]$length)){throw 'Final job inventory unavailable.'}
    if($data.ActiveProcesses -ne 0){throw 'Owned diagnostic job is not empty; no forced cleanup.'}
    Emit @{ok=$true;finished=$true;active=0};break
   }else{throw 'Unknown diagnostic command.'}
  }catch{Emit @{ok=$false;error=$_.Exception.Message}}
 }
}catch{Emit @{ok=$false;error=$_.Exception.Message};exit 1}
finally{
 if($root){$root.Dispose()}
 if($job -ne [IntPtr]::Zero){$null=[KnowledgeJob]::CloseHandle($job)}
}
