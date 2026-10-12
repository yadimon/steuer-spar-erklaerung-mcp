$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '..\powershell\table-values.ps1')
$source=[IO.File]::ReadAllText((Join-Path $PSScriptRoot '..\powershell\sse-worker.ps1'))
$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseInput($source,[ref]$null,[ref]$errors)
if (@($errors).Count) {throw 'Worker source does not parse.'}
foreach ($name in @('Read-SSEToggleState','Read-SSETableAddCellValue')) {
  $functions=@($ast.FindAll({param($node)
    $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $name
  },$true))
  if ($functions.Count -ne 1) {throw 'Add readback helper is missing or ambiguous.'}
  . ([scriptblock]::Create($functions[0].Extent.Text))
}
# Only synthetic UIA records are defined; no worker dispatch, DLL or desktop is loaded.
Add-Type -TypeDefinition @'
namespace System.Windows.Automation {
 public static class ValuePattern {public static object Pattern=new object();}
 public static class TogglePattern {public static object Pattern=new object();}
}
'@
$addBodies=@($ast.FindAll({param($node) $node -is [Management.Automation.Language.SwitchStatementAst]},$true) |
  ForEach-Object {$_.Clauses | Where-Object {$_.Item1.Extent.Text -ceq "'table_add'"} | ForEach-Object {$_.Item2}})
if ($addBodies.Count -ne 1) {throw 'Actual table_add body is missing or ambiguous.'}
$readbackStatements=@()
foreach ($prefix in @('$fresh = Get-LiveElement $hwnd $entry.cell.rid',
    '$cellRead=Read-SSETableAddCellValue $fresh ([string]$entry.requested)',
    '$actual=$cellRead.value',
    '$good = $cellRead.ok -and (Test-SSETableCellEquivalent $actual $entry.requested)')) {
  $statements=@($addBodies[0].FindAll({param($node)
    $node -is [Management.Automation.Language.AssignmentStatementAst] -and $node.Extent.Text -ceq $prefix
  },$true))
  if ($statements.Count -ne 1) {throw 'Actual Add consumer does not use the typed readback and its success guard.'}
  $readbackStatements+=@($statements[0])
}
for ($index=1;$index -lt $readbackStatements.Count;$index++) {
  if ($readbackStatements[$index].Extent.StartOffset -le $readbackStatements[$index-1].Extent.StartOffset) {
    throw 'Actual Add readback order changed.'
  }
}
$readback=[scriptblock]::Create(($readbackStatements.Extent.Text -join [Environment]::NewLine))
$script:toggleReads=0;$script:toggleState='Off';$script:throwToggle=$false
function New-SyntheticAddElement([bool]$HasToggle,[string]$Value,[string]$Name) {
  $toggle=[pscustomobject]@{}
  $toggle | Add-Member ScriptProperty Current {
    $script:toggleReads++
    if ($script:throwToggle) {throw 'synthetic-unreadable-toggle'}
    [pscustomobject]@{ToggleState=$script:toggleState}
  }
  $element=[pscustomobject]@{Current=[pscustomobject]@{Name=$Name};hasToggle=$HasToggle;toggle=$toggle;
    valuePattern=[pscustomobject]@{Current=[pscustomobject]@{Value=$Value}}}
  $element | Add-Member ScriptMethod TryGetCurrentPattern {
    param($Pattern,$Result)
    if ($Pattern -eq [System.Windows.Automation.TogglePattern]::Pattern -and $this.hasToggle) {
      $Result.Value=$this.toggle;return $true
    }
    if ($Pattern -eq [System.Windows.Automation.ValuePattern]::Pattern) {
      $Result.Value=$this.valuePattern;return $true
    }
    $false
  }
  $element
}
function Get-LiveElement($Window,$Rid) {
  if ($Window -eq [IntPtr]123 -and $Rid -ceq 'Synthetic.Cell') {$script:element} else {$null}
}
$hwnd=[IntPtr]123
foreach ($case in @('checkbox-off','checkbox-on','checkbox-case','off-is-not-on','on-is-not-off',
    'indeterminate','unreadable-toggle','unknown-toggle','empty-text-false','text-literal-false','text-number','missing-cell')) {
  $script:toggleState='Off';$script:throwToggle=$false;$script:toggleReads=0
  $script:element=New-SyntheticAddElement $true '' ''
  $entry=[pscustomobject]@{requested='false';cell=[pscustomobject]@{rid='Synthetic.Cell'}}
  $expected=$case -cin @('checkbox-off','checkbox-on','checkbox-case','text-literal-false','text-number')
  switch ($case) {
    'checkbox-on' {$script:toggleState='On';$entry.requested='true'}
    'checkbox-case' {$entry.requested='False'}
    'off-is-not-on' {$entry.requested='true'}
    'on-is-not-off' {$script:toggleState='On'}
    'indeterminate' {$script:toggleState='Indeterminate';$script:element.valuePattern.Current.Value='false'}
    'unreadable-toggle' {$script:throwToggle=$true;$script:element.valuePattern.Current.Value='false'}
    'unknown-toggle' {$script:toggleState='unknown';$script:element.valuePattern.Current.Value='false'}
    'empty-text-false' {$script:element=New-SyntheticAddElement $false '' ''}
    'text-literal-false' {$script:element=New-SyntheticAddElement $false 'false' ''}
    'text-number' {$script:element=New-SyntheticAddElement $false '' '12,30';$entry.requested='12.3'}
    'missing-cell' {$entry.cell.rid='Other.Cell'}
  }
  . $readback
  if ([bool]$good -ne $expected) {throw "$case Add postcondition lost its typed checkbox/text distinction."}
  if ($case -cin @('checkbox-off','checkbox-on','checkbox-case','off-is-not-on','on-is-not-off',
      'indeterminate','unreadable-toggle','unknown-toggle') -and $script:toggleReads -ne 1) {
    throw 'Toggle readback evaluated the state more than once or used a display fallback.'
  }
  if ($case -cin @('checkbox-off','checkbox-on','checkbox-case') -and
      ($cellRead.type -cne 'boolean' -or $actual -cnotin @('true','false'))) {
    throw 'Determinate TogglePattern did not produce an explicit boolean postcondition.'
  }
  if ($case -cin @('empty-text-false','text-literal-false','text-number') -and $cellRead.type -cne 'text') {
    throw 'Text-only cell was silently reclassified as a checkbox.'
  }
  if ($case -cin @('indeterminate','unreadable-toggle','unknown-toggle','missing-cell') -and $cellRead.ok) {
    throw 'Unproven checkbox/cell was reported as a successful read.'
  }
}
# The fix remains read-only; writing/rollback/input/window guards are outside this helper.
$helper=@($ast.FindAll({param($node)
  $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq 'Read-SSETableAddCellValue'
},$true))[0]
if ($helper.Extent.Text -match '\.(SetValue|Toggle|SetFocus|Invoke)\s*\(' -or
    $helper.Extent.Text -match 'Click-|SendWait|Start-Sleep') {throw 'Passive checkbox readback acquired a mutation or retry.'}
Write-Output 'table-add-checkbox-contract: PASS (actual Add readback, typed On/Off, unknown/text/stale negatives)'
