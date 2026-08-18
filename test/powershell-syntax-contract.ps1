$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
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
