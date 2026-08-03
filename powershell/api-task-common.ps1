function New-SseApiVbsContent {
  param(
    [Parameter(Mandatory = $true)]
    [string]$NodePath,
    [Parameter(Mandatory = $true)]
    [string]$ApiMainPath,
    [Parameter(Mandatory = $true)]
    [string]$ConfigPath
  )

  $nodeCommand = '"' + $NodePath + '" "' + $ApiMainPath + '" --config "' + $ConfigPath + '"'
  $vbsCommand = $nodeCommand.Replace('"', '""')
  return 'CreateObject("WScript.Shell").Run "' + $vbsCommand + '", 0, True' + [Environment]::NewLine
}

function Resolve-SseNodePath {
  param([Parameter(Mandatory = $true)][string]$RepoRoot)

  $portable = Join-Path ([IO.Path]::GetFullPath($RepoRoot)) 'runtime\node.exe'
  if (Test-Path -LiteralPath $portable -PathType Leaf) { return $portable }
  $development = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($development -and $development.Source) { return $development.Source }
  throw 'Node-Laufzeit fehlt. In einem Release muss runtime\node.exe enthalten sein; node.exe im PATH ist nur fuer Entwickler erlaubt.'
}
