$ErrorActionPreference='Stop'
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot '../powershell/sse-worker.ps1'),[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'Worker cannot be parsed.'}
$clauses=@($ast.FindAll({param($node) $node -is [Management.Automation.Language.SwitchStatementAst]},$true) |
  ForEach-Object {$_.Clauses} | Where-Object {$_.Item1.Extent.Text -ceq "'get_value'"})
if($clauses.Count -ne 1){throw 'Expected one real get_value dispatcher.'}
$getter=[scriptblock]::Create(($clauses[0].Item2.Statements.Extent.Text -join "`n"))
function Arg($Arguments,$Name,$Default=$null) {
  if($Arguments.ContainsKey($Name)){$Arguments[$Name]}else{$Default}
}
function Fail($Message,$Kind) { $script:failureKind=$Kind;throw $Message }
function Resolve-Window {
  $script:windowCalls++
  throw 'SYNTHETIC_RESOLVER_BOUNDARY'
}
function Walk-Tree { $script:treeCalls++;throw 'Unexpected tree dispatch.' }
foreach($case in @(
  @{args=@{selectorNamespace='qt-object';aid='/.Connection.Text'};allowed=$false},
  @{args=@{selectorNamespace='other';aid='field'};allowed=$false},
  @{args=@{selectorNamespace='UIA';aid='field'};allowed=$false},
  @{args=@{selectorNamespace='uia';rid='qt:7:123:111:2'};allowed=$false},
  @{args=@{selectorNamespace='uia';rid='unknown:1'};allowed=$false},
  @{args=@{selectorNamespace='uia';rid='42.7.4.1'};allowed=$true},
  @{args=@{selectorNamespace='uia';aid='Field.With.Dots'};allowed=$true},
  @{args=@{selectorNamespace='uia';aid='Dotless'};allowed=$true},
  @{args=@{aid='Legacy.Field'};allowed=$true},
  @{args=@{rid='42.7.4.1'};allowed=$true}
)) {
  $a=$case.args;$script:windowCalls=0;$script:treeCalls=0;$script:failureKind=$null;$caught=$null
  try {& $getter} catch {$caught=$_}
  if(-not $caught -or $script:treeCalls -ne 0){throw 'Worker namespace boundary reached an unexpected tree or success.'}
  if($case.allowed) {
    if($script:windowCalls -ne 1 -or $caught.Exception.Message -cne 'SYNTHETIC_RESOLVER_BOUNDARY' -or $script:failureKind){
      throw 'Valid explicit UIA or legacy selector did not reach the unchanged resolver exactly once.'
    }
  } else {
    if($script:windowCalls -ne 0 -or $script:failureKind -cne 'bad-args'){throw 'Conflicting namespace reached a window resolver.'}
  }
}
Write-Output 'get-value-worker-namespace: conflicting namespaces fail before window/tree dispatch; explicit UIA and legacy keep the resolver.'
