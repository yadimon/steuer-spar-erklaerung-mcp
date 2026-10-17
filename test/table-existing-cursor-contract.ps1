$ErrorActionPreference='Stop'
$source=[IO.File]::ReadAllText((Join-Path $PSScriptRoot '../powershell/sse-worker.ps1'))
$ast=[Management.Automation.Language.Parser]::ParseInput($source,[ref]$null,[ref]$null)
$found=@($ast.FindAll({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq 'Invoke-SSETableReadInitialFocus'},$true))
if($found.Count -ne 1){throw 'Initial focus helper must be unique.'}
. ([scriptblock]::Create($found[0].Extent.Text))
function Assert-True($Condition,$Message){if(-not $Condition){throw $Message}}
Add-Type 'namespace System.Windows.Automation { public static class ControlType { public static string DataItem="DataItem"; } public static class SelectionItemPattern { public static object Pattern=new object(); } }'
$snapshot=[pscustomobject]@{navigationBinding=[pscustomobject]@{tableRootAid='Synthetic.Table';tableRootRid='1.1'};
  ersteZelle=[pscustomobject]@{rid='1.2';aid='Synthetic.Table'}}
function Get-SSETableLiveInputState {
  param($Window,$ProcessId,$Aid,$Rid,[switch]$RequireKeyboard,[switch]$RequireSelection)
  $script:reads++
  Assert-True ($Window -eq [IntPtr]111 -and $ProcessId -eq 7 -and $Aid -ceq 'Synthetic.Table' -and $Rid -ceq '1.1') 'Live proof lost target identity.'
  if($script:reads -eq 1){
    Assert-True ($RequireKeyboard -and $RequireSelection) 'Existing focus needs actual keyboard AND unique row selection.'
    return [pscustomobject]@{ok=($script:mode -in @('existing','changed-guard'))}
  }
  [pscustomobject]@{ok=($script:reads -eq 2)}
}
function Get-LiveElement {
  $script:resolved++
  $element=[pscustomobject]@{Current=[pscustomobject]@{ProcessId=7;ControlType='DataItem';AutomationId='Synthetic.Table'}}
  $element | Add-Member ScriptMethod GetRuntimeId {1,2}
  $element | Add-Member ScriptMethod TryGetCurrentPattern {param($Pattern,$Result)
    $item=[pscustomobject]@{}
    $item | Add-Member ScriptMethod Select {$script:selections++}
    $Result.Value=$item;$true
  }
  $element
}
function Invoke-SSETableReadSemanticFocus {
  $script:focusCalls++
  [pscustomobject]@{ok=($script:mode -ceq 'unfocused');method='original-semantic-path';reason='synthetic-focus-result'}
}
foreach($case in @('existing','changed-guard','unfocused','focus-failed')){
  $script:mode=$case;$script:reads=0;$script:resolved=0;$script:selections=0;$script:focusCalls=0
  $guard={param($Phase,[switch]$RequireKeyboard)
    if($script:mode -in @('existing','changed-guard')){Assert-True $RequireKeyboard 'Reused focus needs a final keyboard guard.'}
    $script:mode -cne 'changed-guard'
  }
  $result=Invoke-SSETableReadInitialFocus ([IntPtr]111) 7 $snapshot $guard {throw 'Unexpected refresh boundary'} {throw 'Unexpected focus checkpoint boundary'}
  Assert-True ($result.ok -eq ($case -in @('existing','unfocused'))) "$case`: wrong acceptance."
  if($case -in @('existing','changed-guard')){
    Assert-True ($script:reads -eq 1 -and $script:resolved -eq 0 -and $script:selections -eq 0 -and $script:focusCalls -eq 0) "$case`: existing cursor dispatched another action."
  }else{
    Assert-True ($script:reads -eq 3 -and $script:resolved -eq 1 -and $script:selections -eq 1 -and $script:focusCalls -eq 1) "$case`: original single semantic path changed or retried."
  }
}
Write-Output 'Existing table cursor: actual keyboard/selection proof reused without selection or focus; changed guard and single original focus failure remain terminal.'
