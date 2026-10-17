# Shared exact auxiliary-window close, with an optional private dispatch guard.
# Return the close result to the public dispatcher or the private preparation.
function Invoke-SSEWindowCloseTransaction {
  param($Arguments,[scriptblock]$BeforeDispatch=$null,[hashtable]$DispatchState=$null)
  $a = $Arguments
    # Nur ein im aktiven Page-Object-Katalog explizit freigegebenes,
    # nicht-modales Nebenfenster schliessen. Hauptfenster, modale Dialoge und
    # unbekannte Fenster haben absichtlich eigene, strengere Werkzeuge.
    $hwndRaw = Arg $a 'hwnd'
    $pidRaw = Arg $a 'pid'
    $expectedTitle = [string](Arg $a 'expectedTitle')
    $titleFingerprint = ([string](Arg $a 'titleFingerprint')).ToUpperInvariant()
    if (-not $hwndRaw -or $null -eq $pidRaw -or ([bool]$expectedTitle -eq [bool]$titleFingerprint)) {
      return [pscustomobject]@{ ok=$false; kind='bad-args'; error='pid, hwnd und genau eines von titleFingerprint oder expectedTitle sind Pflicht.' }
    }
    $targetPid = [int](Get-SSEBoundedIntegerArg $a 'pid' 0 1 2147483647)
    $beforeWindows = @(Get-Windows 'SSE' | Where-Object {
      [int]$_.pid -eq $targetPid -and -not (Test-SSEWindowDecorationDescriptor $_)
    })
    $beforeHwnds = @($beforeWindows | ForEach-Object { [int64]$_.hwnd })
    $descInventory = @(Get-DialogInventory $targetPid)
    $desc = @($descInventory | Where-Object {
      [int]$_.pid -eq $targetPid -and [int64]$_.hwnd -eq [int64]$hwndRaw
    })
    if ($desc.Count -ne 1) { return [pscustomobject]@{ ok=$false; kind='stale'; error='Das exakt adressierte Fenster existiert nicht mehr.' } }
    $win = $desc[0]
    $actualTitleFingerprint = ([string]$win.titleFingerprint).ToUpperInvariant()
    if ($titleFingerprint -and $actualTitleFingerprint -ne $titleFingerprint) {
      return [pscustomobject]@{ ok=$false; kind='precondition-failed'; error="Fenstertitel-Fingerprint hat sich geaendert: '$actualTitleFingerprint' statt '$titleFingerprint'." }
    }
    if ($expectedTitle -and $win.title -cne $expectedTitle) {
      return [pscustomobject]@{ ok=$false; kind='precondition-failed'; error="Fenstertitel hat sich geaendert: '$($win.title)' statt '$expectedTitle'." }
    }
    $windowPolicy = Resolve-SSEClosableNonmodalWindowPolicy $win
    $blockingBefore = @($descInventory | Where-Object { $_.kind -in @('native-dialog','qt-dialog') })
    if (-not $windowPolicy -or $win.kind -notin @('tips','known-nonmodal') -or $win.cls -notmatch '^Qt' -or
        -not (Test-SSESafeAuxiliaryDescriptor $win) -or $blockingBefore.Count -or
        (Test-Versand ([string]$win.title))) {
      return [pscustomobject]@{ ok=$false; kind='blocked'; error="Fensterart '$($win.kind)' ist nicht als bekanntes, dialogfreies Page-Object-Nebenfenster freigegeben. Hauptfenster mit sse_close, Dialoge mit sse_dialog_answer behandeln." }
    }
    $beforePeers = @($beforeWindows | Where-Object { [int64]$_.hwnd -ne [int64]$hwndRaw } | ForEach-Object {
      [pscustomobject]@{
        hwnd=[int64]$_.hwnd; pid=[int]$_.pid; cls=[string]$_.cls
        titleFingerprint=([string]$_.titleFingerprint).ToUpperInvariant()
      }
    })
    if ($BeforeDispatch) {
      $allowed=& $BeforeDispatch
      if ($allowed -isnot [bool] -or -not $allowed) {
        return [pscustomobject]@{ok=$false;kind='precondition-failed';error='Die private Fensterbindung hat sich vor WM_CLOSE geaendert.'}
      }
    }
    $res = [IntPtr]::Zero
    if ($null -ne $DispatchState) { $DispatchState.attempted=$true }
    $sent = [SW]::SendMessageTimeout([IntPtr][int64]$hwndRaw, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero, 0x0002, 5000, [ref]$res)
    if ($sent -eq [IntPtr]::Zero) { return [pscustomobject]@{ ok=$false; kind='timeout'; error='WM_CLOSE konnte nicht sicher zugestellt werden.' } }
    # Warten, BIS das Fenster weg ist, statt die Frist pauschal abzusitzen: Die
    # Zusage lautet "Wartezeit auf das Schliessen", also eine Obergrenze. Sie
    # bleibt es auch - ein Fenster, das haengt, bekommt weiterhin die volle
    # Frist, und `closed` wird danach genauso geprueft wie zuvor.
    #
    # Die Untergrenze von 300 ms bleibt als Beobachtungsfenster stehen. Die
    # Nachbedingung prueft naemlich mehr als das Verschwinden des Ziels: dass
    # kein neues Fenster und kein Dialog als Folge auftauchte. Dafuer braucht
    # das Programm einen Moment, und 300 ms sind die kleinste Frist, die diese
    # Operation ohnehin zulaesst.
    #
    # `IsWindow` ist ein einzelner Win32-Aufruf und kostet nichts; gemessen
    # steht das Fenster lange vor der Untergrenze still, waehrend die Reise
    # bisher 2000 ms je Aufruf voll bezahlte.
    $fristMs = [Math]::Min(10000, [Math]::Max(300, [int](Arg $a 'waitMs' 800)))
    $schliessUhr = [Diagnostics.Stopwatch]::StartNew()
    while ($schliessUhr.ElapsedMilliseconds -lt $fristMs) {
      Start-Sleep -Milliseconds 25
      if ($schliessUhr.ElapsedMilliseconds -ge 300 -and -not [SW]::IsWindow([IntPtr][int64]$hwndRaw)) { break }
    }
    $closed = -not [SW]::IsWindow([IntPtr][int64]$hwndRaw)
    $afterWindows = @(Get-Windows 'SSE' | Where-Object {
      [int]$_.pid -eq $targetPid -and -not (Test-SSEWindowDecorationDescriptor $_)
    })
    $newWindows = @($afterWindows | Where-Object { [int64]$_.hwnd -notin $beforeHwnds } | ForEach-Object {
      [pscustomobject]@{ hwnd=[int64]$_.hwnd; titleFingerprint=([string]$_.titleFingerprint).ToUpperInvariant() }
    })
    $missingOrChangedPeers = @($beforePeers | Where-Object {
      $beforePeer = $_
      $same = @($afterWindows | Where-Object { [int64]$_.hwnd -eq [int64]$beforePeer.hwnd })
      $same.Count -ne 1 -or [int]$same[0].pid -ne [int]$beforePeer.pid -or
        [string]$same[0].cls -cne [string]$beforePeer.cls -or
        ([string]$same[0].titleFingerprint).ToUpperInvariant() -ne [string]$beforePeer.titleFingerprint
    })
    $newDialogs = @(Get-DialogInventory $targetPid | Where-Object { $_.kind -in @('native-dialog','qt-dialog') })
    $onlyTargetRemoved = [bool]($closed -and $afterWindows.Count -eq ($beforeWindows.Count - 1) -and
      -not $newWindows.Count -and -not $missingOrChangedPeers.Count -and -not $newDialogs.Count)
    if (-not $onlyTargetRemoved) {
      return ([pscustomobject]@{
        ok = $false; kind = 'postcondition-failed'; hwnd = [int64]$hwndRaw
        pid=$targetPid; titleFingerprint = $actualTitleFingerprint; closed = $closed
        newWindows=$newWindows; missingOrChangedPeers=@($missingOrChangedPeers | ForEach-Object { $_.hwnd }); newDialogs = $newDialogs
        error = 'Nebenfenster wurde nicht als einzige Fensteraenderung dialogfrei geschlossen; keine Wiederholung.'
      })
    }
    return ([pscustomobject]@{
      ok = $true; pid=$targetPid; hwnd = [int64]$hwndRaw; titleFingerprint = $actualTitleFingerprint
      windowId=[string]$windowPolicy.id; windowRole=[string]$windowPolicy.role
      closed = $true; onlyTargetRemoved=$true; verified = $true
    })
}
