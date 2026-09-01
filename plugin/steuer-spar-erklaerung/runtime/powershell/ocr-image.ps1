[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$Path
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
$OutputEncoding = [Console]::OutputEncoding

function Emit($Value) {
  Write-Output ($Value | ConvertTo-Json -Depth 8 -Compress)
  exit 0
}

try {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    throw "Bild nicht gefunden: $Path"
  }
  $resolvedPath = (Resolve-Path -LiteralPath $Path).Path

  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $null = [Windows.Storage.StorageFile, Windows.Storage, ContentType=WindowsRuntime]
  $null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType=WindowsRuntime]
  $null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType=WindowsRuntime]

  function Await-WinRT($Operation, [Type]$ResultType) {
    $method = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
      $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1
    } | Select-Object -First 1
    if (-not $method) { throw 'WinRT-AsTask-Bruecke nicht verfuegbar.' }
    $task = $method.MakeGenericMethod($ResultType).Invoke($null, @($Operation))
    $task.Wait()
    $task.Result
  }

  $file = Await-WinRT ([Windows.Storage.StorageFile]::GetFileFromPathAsync($resolvedPath)) ([Windows.Storage.StorageFile])
  $stream = Await-WinRT ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
  try {
    $decoder = Await-WinRT ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $bitmap = Await-WinRT ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
    try {
      $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
      if (-not $engine) { throw 'Windows-OCR konnte fuer die installierten Sprachen nicht gestartet werden.' }
      $result = Await-WinRT ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
      $lines = @($result.Lines | ForEach-Object {
        $words = @($_.Words)
        $text = (($words | ForEach-Object { $_.Text }) -join ' ').Trim()
        $rects = @($words | ForEach-Object { $_.BoundingRect })
        if ($rects.Count) {
          $left = [double](($rects | Measure-Object X -Minimum).Minimum)
          $top = [double](($rects | Measure-Object Y -Minimum).Minimum)
          $right = [double](($rects | ForEach-Object { $_.X + $_.Width } | Measure-Object -Maximum).Maximum)
          $bottom = [double](($rects | ForEach-Object { $_.Y + $_.Height } | Measure-Object -Maximum).Maximum)
          [pscustomobject]@{ text=$text; x=$left; y=$top; w=($right-$left); h=($bottom-$top) }
        } else {
          [pscustomobject]@{ text=$text; x=$null; y=$null; w=$null; h=$null }
        }
      })
      Emit ([pscustomobject]@{
        ok = $true
        language = $engine.RecognizerLanguage.LanguageTag
        lineCount = $lines.Count
        text = $result.Text
        lines = $lines
      })
    } finally {
      if ($bitmap -is [IDisposable]) { $bitmap.Dispose() }
    }
  } finally {
    if ($stream -is [IDisposable]) { $stream.Dispose() }
  }
} catch {
  Emit ([pscustomobject]@{
    ok = $false
    error = $_.Exception.Message
  })
}
