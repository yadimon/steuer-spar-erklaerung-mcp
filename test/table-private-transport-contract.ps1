$ErrorActionPreference='Stop'
$source=[IO.File]::ReadAllText((Join-Path $PSScriptRoot '..\powershell\sse-worker.ps1'))
$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseInput($source,[ref]$null,[ref]$errors)
if (@($errors).Count) {throw 'Worker source does not parse.'}
foreach ($name in @('Test-SSEPrivateTableTransport','Initialize-SSEWorkerArguments')) {
  $found=@($ast.FindAll({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $name},$true))
  if ($found.Count -ne 1) {throw 'Transport argument gate must be unique.'}
  . ([scriptblock]::Create($found[0].Extent.Text))
}
# The productive gate runs in memory. No worker, UIA, process or file transport.
$expected=('a'*64);$other=('b'*64)
foreach ($lifecycle in @('cold','warm')) {
  foreach ($case in @('public','cursor','mutation-update','mutation-delete','b64-cursor','b64-mutation',
    'missing','wrong','uppercase','short','no-startup-authority','wrong-cursor-op','wrong-mutation-op','both','token-without-plan','null-private-missing')) {
    $args=[pscustomobject]@{};$operation='table_read';$file='synthetic-args.json';$b64='';$startup=$expected;$success=$false
    switch ($case) {
      'public' {$success=$true}
      'cursor' {$args | Add-Member NoteProperty __tableCursorPlan ([pscustomobject]@{phase='checkpoint'});$success=$true}
      'mutation-update' {$args | Add-Member NoteProperty __tableMutationBinding ([pscustomobject]@{operation='table_update'});$operation='table_update';$success=$true}
      'mutation-delete' {$args | Add-Member NoteProperty __tableMutationBinding ([pscustomobject]@{operation='table_delete'});$operation='table_delete';$success=$true}
      'b64-cursor' {$args | Add-Member NoteProperty __tableCursorPlan ([pscustomobject]@{});$file='';$b64='e30='}
      'b64-mutation' {$args | Add-Member NoteProperty __tableMutationBinding ([pscustomobject]@{});$operation='table_update';$file='';$b64='e30='}
      'missing' {$args | Add-Member NoteProperty __tableCursorPlan ([pscustomobject]@{})}
      'wrong' {$args | Add-Member NoteProperty __tableCursorPlan ([pscustomobject]@{})}
      'uppercase' {$args | Add-Member NoteProperty __tableCursorPlan ([pscustomobject]@{})}
      'short' {$args | Add-Member NoteProperty __tableCursorPlan ([pscustomobject]@{})}
      'no-startup-authority' {$args | Add-Member NoteProperty __tableCursorPlan ([pscustomobject]@{});$startup=''}
      'wrong-cursor-op' {$args | Add-Member NoteProperty __tableCursorPlan ([pscustomobject]@{});$operation='table_update'}
      'wrong-mutation-op' {$args | Add-Member NoteProperty __tableMutationBinding ([pscustomobject]@{});$operation='table_read'}
      'both' {$args | Add-Member NoteProperty __tableCursorPlan ([pscustomobject]@{});$args | Add-Member NoteProperty __tableMutationBinding ([pscustomobject]@{})}
      'null-private-missing' {$args | Add-Member NoteProperty __tableCursorPlan $null}
    }
    if ($case -notin @('public','missing','null-private-missing')) {
      $token=$(switch ($case) {'wrong' {$other};'uppercase' {$expected.ToUpperInvariant()};'short' {'a'};default {$expected}})
      $args | Add-Member NoteProperty __tableTransportCapability $token
    }
    $actual=Test-SSEPrivateTableTransport $args $operation $file $b64 $startup
    if ($actual -ne $success) {throw "$lifecycle/$case transport gate disagreed."}
    if ($success -and $null -ne $args.PSObject.Properties['__tableTransportCapability']) {throw 'Validated transport metadata reached business arguments.'}
  }
}
function Read-Args {$script:presented}
function Fail {param($Message,$Kind) throw 'synthetic-safe-gate-rejection'}
function Assert-SSEWorkerArgumentBudget {param($Value,$Depth,$Nodes) $script:budgetCalls++}
function Arg {param($Object,$Name,$Default=$null) $property=$Object.PSObject.Properties[$Name];if ($property) {$property.Value} else {$Default}}
foreach ($lifecycle in @('cold','warm')) {
  $Op='table_read';$ArgsFile='synthetic-args.json';$B64='';$script:budgetCalls=0
  $script:SSE_INTERNAL_TABLE_CAPABILITY=$expected
  $script:presented=[pscustomobject]@{__tableCursorPlan=[pscustomobject]@{phase='checkpoint'}}
  try {Initialize-SSEWorkerArguments;throw 'Unauthorized private plan reached argument budget.'}
  catch {if ($_.Exception.Message -cne 'synthetic-safe-gate-rejection') {throw}}
  if ($script:budgetCalls -ne 0) {throw 'Private gate ran after business argument handling.'}
  $script:presented=[pscustomobject]@{__tableCursorPlan=[pscustomobject]@{phase='checkpoint'};__tableTransportCapability=$expected}
  Initialize-SSEWorkerArguments
  if ($script:budgetCalls -ne 1 -or $a.PSObject.Properties['__tableTransportCapability']) {throw 'Authorized private plan retained transport metadata.'}
}
Write-Output 'table-private-transport-contract: PASS (cold/warm one-job gate, ArgsFile only, exact operation, no authority downgrade)'
