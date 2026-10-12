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
Assert-True (-not $click.Contains('if ($BeforeClickCheck) {')) 'Final physical click guard still depends on an optional callback.'
Assert-True ($click.Substring($finalClickGuard,$click.IndexOf('[SW]::mouse_event')-$finalClickGuard).Contains('$RequireForeground -and [SW]::GetForegroundWindow() -ne $Window')) 'Final physical click guard lost exact foreground.'
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
Assert-True ($add.Contains('Click-VerifiedPoint $hwnd $freeRead.firstCell -ExpectedInputTick $inputBaseline -RequireForeground')) 'Navigation anchor can reacquire focus or swallow a changed input epoch.'
Assert-True ($add.Contains('$inputBaseline = $anchorClick.inputTickAfterClick')) 'Navigation baseline was reset after a possibly changed epoch.'
$down=$add.IndexOf("[System.Windows.Forms.SendKeys]::SendWait('{DOWN}')")
$keyLoop=$add.LastIndexOf('for ($imBuendel', $down)
Assert-True ($keyLoop -ge 0 -and $add.Substring($keyLoop,$down-$keyLoop).Contains('Test-SSELastInputUnchanged $inputBaseline')) 'A navigation bundle lacks per-key input guards.'
Assert-True ($add.Substring($down).Contains("-Context 'table-add-navigation-down'")) 'Own navigation keys lack immediate input checkpoints.'
$beforeRegion=[pscustomobject]@{ ok=$true; cells=@(
  [pscustomobject]@{ x=100; y=200; name='Synthetic'; val='' }
  [pscustomobject]@{ x=200; y=200; name='0,00'; val='' }
) }
$shiftedRegion=[pscustomobject]@{ ok=$true; cells=@($beforeRegion.cells | ForEach-Object { $cell=$_.PSObject.Copy(); $cell.y=160; $cell }) }
Assert-True ((Get-SSETableContentSignature $beforeRegion) -ceq (Get-SSETableContentSignature $shiftedRegion)) 'Pure signature treated Y as semantic identity.'
$shiftedRegion.cells[1].val='1,00'
Assert-True ((Get-SSETableContentSignature $beforeRegion) -cne (Get-SSETableContentSignature $shiftedRegion)) 'Changed cell was hidden behind display text.'
Write-Output 'Table focus: bound acquisition, unchanged input epoch, fresh semantic binding and strict mutation guards passed.'
