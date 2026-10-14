$ErrorActionPreference='Stop'
$path=Join-Path $PSScriptRoot '../powershell/sse-worker.ps1'
$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($path,[ref]$null,[ref]$errors)
if(@($errors).Count){throw 'Worker syntax is invalid.'}
foreach($name in @('Arg','Get-SSEBoundedIntegerArg','Test-SSEExactProperties','Test-SSELaunchMainWindowStable','Get-SSEMainWindowCandidates')){
  $definition=@($ast.FindAll({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $name},$true))
  if($definition.Count -ne 1){throw "Productive helper '$name' is absent."}
  . ([scriptblock]::Create($definition[0].Extent.Text))
}
$probe=@($ast.FindAll({param($node) $node -is [Management.Automation.Language.SwitchStatementAst]},$true) |
  ForEach-Object {$_.Clauses} | Where-Object {$_.Item1.Extent.Text -ceq "'launch_probe'"})
if($probe.Count -ne 1){throw 'Productive launch probe is absent.'}
$body=[scriptblock]::Create($probe[0].Item2.Extent.Text.Trim().TrimStart('{').TrimEnd('}'))
$product='SteuerSparErkl'+[char]0x00E4+'rung'
function Window([long]$Handle,[int]$Width=1100,[string]$Title=$product){
  [pscustomobject]@{pid=7;hwnd=$Handle;title=$Title;cls='QtWindow';x=0;y=0;w=$Width;h=800;minimiert=$false;hung=$false}
}
function Fail($Message,$Kind){throw "$Kind`: $Message"}
function Emit($Result){$script:result=$Result;throw 'captured-result'}
function Get-Windows {
  param($Filter)
  if($Filter -cne 'SSE'){throw 'Probe escaped its product window inventory.'}
  $script:reads++
  if($script:windowSource){return (& $script:windowSource $script:reads)}
  $index=[Math]::Min($script:reads-1,$script:frames.Count-1)
  @($script:frames[$index])
}
function Get-DialogInventory {
  param($Target)
  if($Target -ne 7){throw 'Dialog inventory escaped its owned PID.'}
  @($script:dialogs)
}
function Start-Sleep {param($Milliseconds) if($Milliseconds -ne 250){throw 'Unexpected polling delay.'}}
function Run-Probe($Frames,$Dialogs=@(),[bool]$HasCase=$true,[int]$Budget=5000,[scriptblock]$WindowSource=$null){
  $script:frames=$Frames;$script:dialogs=$Dialogs;$script:reads=0;$script:result=$null
  $script:windowSource=$WindowSource
  $a=[pscustomobject]@{schemaVersion=1;planKind='launch-readiness';pid=7;hasCase=$HasCase;budgetMs=$Budget}
  try{& $body;throw 'Probe returned without a result.'}
  catch{if($_.Exception.Message -cne 'captured-result'){throw}}
  $script:result
}
function Assert([bool]$Condition,[string]$Message){if(-not $Condition){throw $Message}}

$result=Run-Probe @(@((Window 10)),@((Window 20)),@((Window 20)),@((Window 20)))
Assert ($script:reads -eq 5 -and $result.windows[0].hwnd -eq 20) 'A replaced startup HWND was published before three stable observations and a fresh checkpoint.'
$result=Run-Probe @(@((Window 10)),@(),@((Window 20)),@((Window 20)),@((Window 20)))
Assert ($script:reads -eq 6 -and $result.windows[0].hwnd -eq 20) 'Missing window failed to reset the stability proof.'
$result=Run-Probe @(@((Window 10 1100)),@((Window 10 1200)),@((Window 10 1200)),@((Window 10 1200)))
Assert ($script:reads -eq 5 -and $result.windows[0].w -eq 1200) 'Resizing startup frame was reported as ready.'
$result=Run-Probe @(@((Window 10)),@((Window 10 1100 ($product+' case'))),@((Window 10 1100 ($product+' case'))),@((Window 10 1100 ($product+' case'))))
Assert ($script:reads -eq 5) 'Changed case title did not reset readiness.'
$result=Run-Probe (, @((Window 10),(Window 20)))
Assert ($script:reads -eq 1 -and $result.windows.Count -eq 2) 'Ambiguous main windows were silently rebound or retried.'
$dialog=[pscustomobject]@{pid=7;hwnd=30;kind='qt-dialog';recoveryPrompt=$true}
$result=Run-Probe @(@((Window 10))) @($dialog)
Assert ($script:reads -eq 1 -and $result.dialogs.Count -eq 1 -and $result.dialogs[0].recoveryPrompt) 'Recovery question was hidden behind readiness retries.'
$hung=Window 10;$hung.hung=$true
$result=Run-Probe @(@($hung),@((Window 10)),@((Window 10)),@((Window 10)))
Assert ($script:reads -eq 5) 'Unresponsive window counted as a ready frame.'
$unknown=Window 10;$unknown.hung=$null
$result=Run-Probe @(@($unknown),@((Window 10)),@((Window 10)),@((Window 10)))
Assert ($script:reads -eq 5) 'Unknown responsiveness counted as a ready frame.'
$foreign=Window 99;$foreign.pid=99
$result=Run-Probe @(@($foreign,(Window 10)),@($foreign,(Window 10)),@($foreign,(Window 10)))
Assert ($script:reads -eq 4 -and $result.windows.Count -eq 1 -and $result.windows[0].pid -eq 7) 'Foreign process entered the readiness binding.'
$result=Run-Probe @(@((Window 10)),@((Window 10)),@((Window 10)),@((Window 20)),@((Window 20)),@((Window 20)),@((Window 20)))
Assert ($script:reads -eq 8 -and $result.windows[0].hwnd -eq 20) 'Changed window snapshot escaped the final checkpoint.'
$result=Run-Probe -Frames @() -WindowSource {
  param($Read)
  if($Read -eq 4){throw 'Synthetic checkpoint read failure.'}
  Window 10
}
Assert ($result.outcome -ceq 'retry-fresh' -and $result.windows.Count -eq 0 -and $result.probeFailures -eq 1 -and
  $result.lastProbeError -clike 'window-checkpoint:*') 'Checkpoint exception published unchecked windows or lost its failure diagnosis.'
$generic=Window 10 1100 'Steuerprogramm'
$result=Run-Probe -Frames @(@($generic),@($generic),@($generic)) -HasCase $false
Assert ($result.outcome -ceq 'observed' -and $script:reads -eq 4) 'No-case startup failed to stabilize the generic main window.'
$result=Run-Probe -Frames @(@($generic,(Window 20)),@($generic,(Window 20)),@($generic,(Window 20))) -HasCase $false
Assert ($result.outcome -ceq 'observed' -and $script:reads -eq 4) 'Probe disagrees with the resolver about generic/loaded windows.'
Assert (@(Get-SSEMainWindowCandidates $result.windows).Count -eq 1) 'Published main candidates differ from the later window resolver.'
$result=Run-Probe -Frames @() -Budget 1500 -WindowSource {param($Read) Window (100+$Read)}
Assert ($result.outcome -ceq 'deadline' -and $result.mainWindowUnstable -eq $true -and
  $result.windows.Count -eq 0 -and $result.lastProbeError) 'Unstable-window deadline lost its non-binding diagnosis or published a transient main window.'
$result=Run-Probe -Frames @() -HasCase $false -Budget 1500 -WindowSource {
  param($Read)
  $loaded=Window (100+$Read);$loaded.hung=$true
  @((Window 99 1100 'Steuerprogramm'),$loaded)
}
Assert ($result.outcome -ceq 'deadline' -and $result.windows.Count -eq 0 -and $result.mainWindowUnstable) 'Wide generic startup window escaped the unstable loaded-case deadline as a prompt.'

$source=[IO.File]::ReadAllText($path)
$probeText=$probe[0].Item2.Extent.Text
Assert ($probeText -notmatch 'Start-Process|Stop-Process|SendKeys|SetForegroundWindow') 'Readiness polling introduced a process or input mutation.'
Assert ($probeText -match 'while \(\(\$probeTimer.ElapsedMilliseconds \+ 1000\) -lt \$probeBudgetMs\)') 'Readiness polling lost its original absolute budget and handover reserve.'
Write-Output 'Launch readiness: productive probe preserves HWND/title/geometry across three passive frames, resets on disappearance, and preserves dialogs/ambiguity.'
