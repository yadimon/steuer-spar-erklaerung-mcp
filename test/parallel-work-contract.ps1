# Pure source/semantic contracts. Never acquire real focus or call native UI.
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$worker = Get-Content -LiteralPath (Join-Path $root 'powershell\sse-worker.ps1') -Raw -Encoding UTF8
. (Join-Path $root 'powershell\table-combobox.ps1')
function Assert-True([bool]$Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
function Function-Text([string]$Name) {
  $tokens=$null; $errors=$null
  $ast=[Management.Automation.Language.Parser]::ParseInput($worker,[ref]$tokens,[ref]$errors)
  $definitions=@($ast.FindAll({ param($node)
    $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $Name
  },$true))
  Assert-True ($definitions.Count -eq 1) "Function is not uniquely present: $Name"
  $definitions[0].Extent.Text
}
$focus=Function-Text 'Initialize-SSETableMutationFocus'
Assert-True ($focus.IndexOf('$inputBeforeFocus = Get-SSELastInputTick') -lt $focus.IndexOf('Show-SSEWindow $Hwnd')) 'Input baseline is read after acquiring focus.'
Assert-True ($focus.Contains('Test-SSELastInputUnchanged $inputBeforeFocus')) 'Focus acquisition hides an input epoch change.'
Assert-True ($focus.Contains('GetForegroundWindow() -ne $Hwnd')) 'Acquisition does not prove the bound foreground.'
Assert-True ($focus.IndexOf('Show-SSEWindow $Hwnd') -lt $focus.IndexOf('Walk-BoundTree $Hwnd -WithValues')) 'Table bindings are not refreshed after focus acquisition.'
Assert-True ($focus.Contains('Get-SSETableContentSignature $InitialRegion') -and $focus.Contains('Get-SSETableContentSignature $freshRegion')) 'Focus acquisition does not preserve the semantic cell snapshot.'
Assert-True ($focus.Contains('guardUserInput=$true; inputBaseline=$inputBeforeFocus')) 'Visible writes do not retain the proven strict input epoch.'
Assert-True ($focus.Contains('$script:DESKTOP_NAME -or $lockScreen')) 'Hidden or locked desktop acquired visible focus.'
Assert-True ($focus.Contains('foreignForegroundIsolation=$false')) 'A visible mutation retained foreign foreground isolation after acquisition.'
$resolver=Function-Text 'Resolve-SSEMainWindowDescriptor'
Assert-True ($resolver.Contains('[SW]::ShowWindow([IntPtr][int64]$main.hwnd, 9)') -and
  $resolver.Contains('[int64]$_.hwnd -eq [int64]$main.hwnd -and [int]$_.pid -eq [int]$main.pid') -and
  $resolver.Contains('$fresh.Count -ne 1 -or $fresh[0].minimiert')) 'Minimized restoration did not prove the exact target HWND/PID.'
$click=Function-Text 'Click-VerifiedPoint'
$finalClickGuard=$click.LastIndexOf('if (($null -ne $ExpectedInputTick')
Assert-True ($finalClickGuard -gt $click.IndexOf('Start-Sleep -Milliseconds 100') -and
  $finalClickGuard -lt $click.IndexOf('[SW]::mouse_event')) 'Final physical click guard does not follow cursor settling.'
$clickAst=[Management.Automation.Language.Parser]::ParseInput($click,[ref]$null,[ref]$null)
$clickFunction=@($clickAst.FindAll({param($node)
  $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq 'Click-VerifiedPoint'
},$true))[0]
$clickStatements=@($clickFunction.Body.EndBlock.Statements)
$popupBindings=@($clickFunction.Body.FindAll({param($node)
  $node -is [Management.Automation.Language.AssignmentStatementAst] -and $node.Left.Extent.Text -ceq '$popupMode'
},$true))
$foregroundBindings=@($clickFunction.Body.FindAll({param($node)
  $node -is [Management.Automation.Language.AssignmentStatementAst] -and $node.Left.Extent.Text -ceq '$foregroundTarget'
},$true))
Assert-True ($popupBindings.Count -eq 1 -and
  $clickStatements -contains $popupBindings[0] -and
  $popupBindings[0].Right.Extent.Text -ceq '($ForegroundWindow -ne [IntPtr]::Zero)' -and
  $foregroundBindings.Count -eq 1 -and
  $clickStatements -contains $foregroundBindings[0] -and
  $foregroundBindings[0].Right.Extent.Text -ceq '$(if ($popupMode) { $ForegroundWindow } else { $Window })' -and
  $popupBindings[0].Extent.EndOffset -lt $foregroundBindings[0].Extent.StartOffset) `
  'Foreground must uniquely bind the explicit popup window or the default click window.'
$callbackStatements=@($clickStatements | Where-Object {
  $_ -is [Management.Automation.Language.IfStatementAst] -and @($_.FindAll({param($node)
    $node -is [Management.Automation.Language.CommandAst] -and
      (@($node.CommandElements | ForEach-Object { $_.Extent.Text }) -join ' ') -ceq
        '$BeforeClickCheck $Window $BeforeClickBinding $px $py'
  },$true)).Count -gt 0
})
$mouseLoops=@($clickStatements | Where-Object {
  $_ -is [Management.Automation.Language.ForStatementAst] -and @($_.FindAll({param($node)
    $node -is [Management.Automation.Language.InvokeMemberExpressionAst] -and
      $node.Expression.Extent.Text -ceq '[SW]' -and $node.Member.Value -ceq 'mouse_event'
  },$true)).Count -gt 0
})
Assert-True ($callbackStatements.Count -eq 1 -and $mouseLoops.Count -eq 1) 'Callback or physical click loop is not uniquely bound.'
Assert-True ($foregroundBindings[0].Extent.EndOffset -lt $callbackStatements[0].Extent.StartOffset) `
  'The exact foreground target is not bound before the final callback.'
$independentGuards=@($clickStatements | Where-Object {
  $_ -is [Management.Automation.Language.IfStatementAst] -and
    $_.Extent.StartOffset -gt $callbackStatements[0].Extent.EndOffset -and
    $_.Extent.EndOffset -lt $mouseLoops[0].Extent.StartOffset -and
    $_.Clauses[0].Item1.Extent.Text.Contains('Test-SSELastInputUnchanged $ExpectedInputTick') -and
    $_.Clauses[0].Item1.Extent.Text.Contains('$RequireForeground -and [SW]::GetForegroundWindow() -ne $foregroundTarget')
})
# A top-level sibling executes with or without the optional callback. A guard
# nested inside that callback (or moved before it) must still fail this contract.
Assert-True ($independentGuards.Count -ge 1) 'Final physical click guard still depends on an optional callback.'
Assert-True ($click.Substring($finalClickGuard,$click.IndexOf('[SW]::mouse_event')-$finalClickGuard).Contains('$RequireForeground -and [SW]::GetForegroundWindow() -ne $foregroundTarget')) 'Final physical click guard lost exact foreground.'
Assert-True ($click.Contains('inputTickAfterClick=$inputTickAfterClick') -and
  $click.Contains('Test-SSELastInputUnchanged $inputTickAfterClick')) 'Settling after a click silently accepts a new input epoch.'
foreach ($operation in @('table_add','table_update')) {
  $start=$worker.IndexOf("  '$operation' {")
  $finish=$worker.IndexOf("`n  '",$start+5)
  $block=$worker.Substring($start,$finish-$start)
  Assert-True ($block.Contains('Initialize-SSETableMutationFocus $hwnd $targetPid')) "Missing acquisition: $operation"
  Assert-True ($block.IndexOf('Initialize-SSETableMutationFocus') -lt $block.IndexOf('$prepared = New-Object')) "Old prepared cells survive focus acquisition: $operation"
  Assert-True (([regex]::Matches($block,'Test-SSETableMutationForegroundLost')).Count -ge 3) "Foreground is not guarded before/after writes and readback: $operation"
  Assert-True ($block.Contains('Test-SSEIsolationEnded $lockScreenIsolation $foreignForegroundIsolation $hwnd')) "Isolation-ended guard was lost: $operation"
  Assert-True ($block.Contains('-RestoreMinimized')) "Known minimized target is not restored: $operation"
}
$addStart=$worker.IndexOf("  'table_add' {"); $addEnd=$worker.IndexOf("`n  '",$addStart+5)
$add=$worker.Substring($addStart,$addEnd-$addStart)
$appendPreflight=$add.Substring(0,$add.IndexOf('$prepared = New-Object'))
Assert-True (-not ($appendPreflight -match 'Click-VerifiedPoint|SendKeys|mouse_event')) 'Append preflight can activate an existing editor instead of using the guarded cursor journey.'
Assert-True ($appendPreflight.Contains('physicalInputAttempted=$false; physicalInputUsed=$false; outcomeUnknown=$false')) 'Missing append-row rejection hides its known no-input outcome.'
$beforeRegion=[pscustomobject]@{ ok=$true; cells=@(
  [pscustomobject]@{ x=100; y=200; name='Synthetic'; val='' }
  [pscustomobject]@{ x=200; y=200; name='0,00'; val='' }
) }
$shiftedRegion=[pscustomobject]@{ ok=$true; cells=@($beforeRegion.cells | ForEach-Object { $cell=$_.PSObject.Copy(); $cell.y=160; $cell }) }
Assert-True ((Get-SSETableContentSignature $beforeRegion) -ceq (Get-SSETableContentSignature $shiftedRegion)) 'Pure signature treated Y as semantic identity.'
$shiftedRegion.cells[1].val='1,00'
Assert-True ((Get-SSETableContentSignature $beforeRegion) -cne (Get-SSETableContentSignature $shiftedRegion)) 'Changed cell was hidden behind display text.'
Write-Output 'Table focus: bound acquisition, unchanged input epoch, fresh semantic binding and strict mutation guards passed.'
