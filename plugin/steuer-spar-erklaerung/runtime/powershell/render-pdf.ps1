[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$Path,
  [Parameter(Mandatory)][string]$OutputDirectory,
  [ValidateRange(320, 4096)][int]$Width = 1800,
  [ValidateRange(1, 100)][int]$MaxPages = 50
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
$OutputEncoding = [Console]::OutputEncoding
$createdFiles = New-Object System.Collections.Generic.List[string]

function Await-WinRTResult($Operation, [Type]$ResultType) {
  $method = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1
  } | Select-Object -First 1
  if (-not $method) { throw 'Generische WinRT-AsTask-Bruecke nicht verfuegbar.' }
  $task = $method.MakeGenericMethod($ResultType).Invoke($null, @($Operation))
  $task.GetAwaiter().GetResult()
}

function Await-WinRTAction($Operation) {
  $method = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and
    -not $_.IsGenericMethod -and
    $_.GetParameters().Count -eq 1 -and
    $_.GetParameters()[0].ParameterType.FullName -eq 'Windows.Foundation.IAsyncAction'
  } | Select-Object -First 1
  if (-not $method) { throw 'WinRT-IAsyncAction-AsTask-Bruecke nicht verfuegbar.' }
  $task = $method.Invoke($null, @($Operation))
  $null = $task.GetAwaiter().GetResult()
}

try {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    throw "PDF nicht gefunden: $Path"
  }
  if ([IO.Path]::GetExtension($Path) -ine '.pdf') {
    throw 'Eingabedatei muss auf .pdf enden.'
  }
  if (-not (Test-Path -LiteralPath $OutputDirectory -PathType Container)) {
    throw "Ausgabeordner fehlt: $OutputDirectory"
  }
  $resolvedPath = (Resolve-Path -LiteralPath $Path).Path
  $resolvedOutput = (Resolve-Path -LiteralPath $OutputDirectory).Path
  $prefix = [IO.Path]::GetFileNameWithoutExtension($resolvedPath) -replace '[^A-Za-z0-9._-]', '_'
  if (-not $prefix) { $prefix = 'document' }
  if ($prefix.Length -gt 80) { $prefix = $prefix.Substring(0, 80) }

  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $null = [Windows.Storage.StorageFile, Windows.Storage, ContentType=WindowsRuntime]
  $null = [Windows.Storage.StorageFolder, Windows.Storage, ContentType=WindowsRuntime]
  $null = [Windows.Data.Pdf.PdfDocument, Windows.Data.Pdf, ContentType=WindowsRuntime]
  $null = [Windows.Data.Pdf.PdfPageRenderOptions, Windows.Data.Pdf, ContentType=WindowsRuntime]

  $file = Await-WinRTResult ([Windows.Storage.StorageFile]::GetFileFromPathAsync($resolvedPath)) `
    ([Windows.Storage.StorageFile])
  $document = Await-WinRTResult ([Windows.Data.Pdf.PdfDocument]::LoadFromFileAsync($file)) `
    ([Windows.Data.Pdf.PdfDocument])
  $pageCount = [int]$document.PageCount
  if ($pageCount -lt 1) { throw 'PDF enthaelt keine Seite.' }
  if ($pageCount -gt $MaxPages) {
    throw "PDF hat $pageCount Seiten und ueberschreitet das Limit $MaxPages; nichts gerendert."
  }
  $folder = Await-WinRTResult ([Windows.Storage.StorageFolder]::GetFolderFromPathAsync($resolvedOutput)) `
    ([Windows.Storage.StorageFolder])

  for ($index = 0; $index -lt $pageCount; $index += 1) {
    $page = $document.GetPage([uint32]$index)
    try {
      $name = '{0}-page-{1:D4}.png' -f $prefix, ($index + 1)
      $target = Await-WinRTResult (
        $folder.CreateFileAsync($name, [Windows.Storage.CreationCollisionOption]::FailIfExists)
      ) ([Windows.Storage.StorageFile])
      $stream = Await-WinRTResult ($target.OpenAsync([Windows.Storage.FileAccessMode]::ReadWrite)) `
        ([Windows.Storage.Streams.IRandomAccessStream])
      try {
        $options = New-Object Windows.Data.Pdf.PdfPageRenderOptions
        $options.DestinationWidth = [uint32]$Width
        Await-WinRTAction ($page.RenderToStreamAsync($stream, $options))
      } finally {
        if ($stream -is [IDisposable]) { $stream.Dispose() }
      }
      $createdFiles.Add($name)
    } finally {
      if ($page -is [IDisposable]) { $page.Dispose() }
    }
  }

  $response = [pscustomobject]@{
    ok = $true
    pageCount = $pageCount
    width = $Width
    files = @($createdFiles)
  }
} catch {
  $response = [pscustomobject]@{
    ok = $false
    error = $_.Exception.Message
    createdFiles = @($createdFiles)
  }
}

# Some Windows builds crash during WinRT finalization and replace an explicit
# `exit 0` with native status 2170. This helper is intentionally launched as a
# dedicated `powershell.exe -File` process. Flush the complete JSON result, then
# bypass that faulty finalization so callers can trust the exit-code contract.
$json = $response | ConvertTo-Json -Depth 8 -Compress
[Console]::Out.WriteLine($json)
[Console]::Out.Flush()
[Console]::Error.Flush()
[Environment]::Exit(0)
