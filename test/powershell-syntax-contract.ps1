$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$workerBytes = [IO.File]::ReadAllBytes((Join-Path $root 'powershell/sse-worker.ps1'))
if ($workerBytes.Length -lt 3 -or $workerBytes[0] -ne 239 -or
    $workerBytes[1] -ne 187 -or $workerBytes[2] -ne 191) {
  throw 'The UTF-8 worker requires its BOM for Windows PowerShell 5.1 source decoding.'
}
$files = @(
  Get-ChildItem -LiteralPath (Join-Path $root 'powershell') -Filter '*.ps1' -File -Recurse
  Get-ChildItem -LiteralPath (Join-Path $root 'test') -Filter '*.ps1' -File -Recurse
) | Sort-Object FullName

$failures = New-Object Collections.Generic.List[string]
foreach ($file in $files) {
  $tokens = $null
  $errors = $null
  $null = [Management.Automation.Language.Parser]::ParseFile(
    $file.FullName,
    [ref]$tokens,
    [ref]$errors
  )
  foreach ($parseError in @($errors)) {
    $relative = $file.FullName.Substring($root.Length).TrimStart([IO.Path]::DirectorySeparatorChar)
    $failures.Add("${relative}:$($parseError.Extent.StartLineNumber): $($parseError.Message)")
  }
}

if ($failures.Count) {
  throw "PowerShell-5.1-Syntaxfehler:`n$($failures -join [Environment]::NewLine)"
}

Write-Output "PowerShell-Syntax: $($files.Count) Runtime-/Testskripte unter Windows PowerShell 5.1 bestanden"
