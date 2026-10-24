# Existing Steuerwissen search: exact window lifetime, guarded physical input
# and independently observable content. This file performs no work on import.
function Get-SSEKnowledgeProcessDescriptor($Process) {
  $Process.Refresh()
  $path = [string]$Process.Path
  if (-not $path -or [IO.Path]::GetFileName($path) -ine 'SteuerBerater.exe') { return $null }
  [pscustomobject]@{
    pid=[int]$Process.Id; processName=[string]$Process.ProcessName
    startedTicks=[int64]$Process.StartTime.ToUniversalTime().Ticks
    path=[IO.Path]::GetFullPath($path)
  }
}

function Get-SSEKnowledgeCandidates {
  $identities = @{}
  foreach ($process in @(Get-Process -Name 'SteuerBerater' -ErrorAction SilentlyContinue)) {
    try {
      $identity = Get-SSEKnowledgeProcessDescriptor $process
      if ($identity -and $identity.processName -ieq 'SteuerBerater') { $identities[$identity.pid] = $identity }
    } catch {
      Fail 'Ein Steuerwissen-Prozess ist nicht eindeutig lesbar.' 'precondition-failed'
    } finally { $process.Dispose() }
  }
  if (-not $identities.Count) { return }
  try { $windows = @(Get-SSEKnowledgeWindows ([int[]]@($identities.Keys))) }
  catch { Fail 'Das Steuerwissen-Fensterinventar ist nicht vollstaendig lesbar.' 'precondition-failed' }
  foreach ($window in $windows) {
    if ($window.Title -cne 'Steuerwissen' -or $window.Hwnd -le 0 -or -not $identities.ContainsKey([int]$window.Pid)) { continue }
    $binding = $identities[[int]$window.Pid].PSObject.Copy()
    $binding | Add-Member -NotePropertyName hwnd -NotePropertyValue ([int64]$window.Hwnd)
    $binding | Add-Member -NotePropertyName title -NotePropertyValue ([string]$window.Title)
    $binding
  }
}

function Get-SSEKnowledgeWindows([int[]]$ProcessIds) {
  [SSEWindowEnumerator]::Describe($ProcessIds)
}

function Get-SSEKnowledgeIdentity([int]$ProcessId) {
  $process = Get-Process -Id $ProcessId -ErrorAction Stop
  try { Get-SSEKnowledgeProcessDescriptor $process }
  finally { $process.Dispose() }
}

function Select-SSEKnowledgeWindow($Candidates, $RequestedWindow) {
  $matches = @($Candidates)
  if ($null -ne $RequestedWindow) {
    $requested = [int64]0
    if (-not [int64]::TryParse([string]$RequestedWindow, [ref]$requested) -or
        $requested -le 0 -or $requested -gt 9007199254740991) {
      Fail 'fenster braucht ein positives ganzzahliges Steuerwissen-Fensterhandle.' 'bad-args'
    }
    $matches = @($matches | Where-Object { $_.hwnd -eq $requested })
  }
  if ($matches.Count -eq 0) {
    Fail 'Kein passendes Steuerwissen-Fenster ist offen. Steuerwissen zuerst in SSE oeffnen.' 'not-found'
  }
  if ($matches.Count -ne 1) {
    $handles = (@($matches | ForEach-Object { [string]$_.hwnd }) -join ', ')
    Fail "Mehrere Steuerwissen-Fenster sind offen ($handles); fenster muss das genaue Ziel binden." 'ambiguous'
  }
  $matches[0]
}

function Assert-SSEKnowledgeTarget($Binding, [bool]$Foreground = $false, $ExpectedInput = $null) {
  try { $current = Get-SSEKnowledgeIdentity $Binding.pid }
  catch { Fail 'Der gebundene Steuerwissen-Prozess ist nicht mehr lesbar.' 'precondition-failed' }
  if (-not $current -or $current.processName -ine 'SteuerBerater' -or
      $current.pid -ne $Binding.pid -or
      $current.startedTicks -ne $Binding.startedTicks -or $current.path -ine $Binding.path -or
      -not [SW]::IsWindowVisible([IntPtr]$Binding.hwnd)) {
    Fail 'Fenster, Prozess oder Lebenszeit des Steuerwissens haben sich veraendert.' 'precondition-failed'
  }
  if ([SW]::IsIconic([IntPtr]$Binding.hwnd)) { Fail 'Steuerwissen ist minimiert; keine Eingabe.' 'minimized' }
  if ([SW]::IsHungAppWindow([IntPtr]$Binding.hwnd)) { Fail 'Steuerwissen reagiert nicht; keine Eingabe.' 'precondition-failed' }
  $windowPid = 0
  $null = [SW]::GetWindowThreadProcessId([IntPtr]$Binding.hwnd, [ref]$windowPid)
  if ($windowPid -ne $Binding.pid -or
      (Get-SSEWindowTitleText ([IntPtr]$Binding.hwnd)) -cne 'Steuerwissen') {
    Fail 'Die frische HWND-/PID-Bindung des Steuerwissens passt nicht.' 'precondition-failed'
  }
  if ($Foreground -and [SW]::GetForegroundWindow() -ne [IntPtr]$Binding.hwnd) {
    Fail 'Steuerwissen hat den Vordergrund verloren; keine weitere Eingabe.' 'precondition-failed'
  }
  if ($null -ne $ExpectedInput -and -not (Test-SSELastInputUnchanged $ExpectedInput)) {
    Fail 'Die Eingabe-Epoche hat sich veraendert; keine weitere Eingabe.' 'interference'
  }
}

function Read-SSEKnowledgeSnapshot($Binding) {
  Assert-SSEKnowledgeTarget $Binding
  $raw = [SSEAccessible]::DescribeDocument([int64]$Binding.hwnd, 2500, 8000, 24)
  $types = @{15='Document';30='Hyperlink';33='List';34='ListItem';40='Image';41='Text';42='Edit';43='Button'}
  $views = @(foreach ($node in $raw.Nodes) {
    $type = $types[[int]$node.Role]
    if (-not $type) { $type='Custom' }
    [pscustomobject]@{
      i=$node.Index; p=$node.ParentIndex; type=$type; name=$node.Name; val=$node.Value
      rid=('acc:' + ($node.Path -join '.')); x=$node.X; y=$node.Y; w=$node.W; h=$node.H
      on=[bool](($node.State -band 1) -eq 0)
      visible=[bool](($node.State -band 0x8000) -eq 0)
      offscreen=[bool](($node.State -band 0x10000) -ne 0)
    }
  })
  Assert-SSEKnowledgeTarget $Binding
  [pscustomobject]@{
    views=$views; nodeCount=[int]$raw.Nodes.Length
    complete=[bool](-not $raw.Truncated -and -not $raw.DepthLimited -and
      $raw.Errors -eq 0 -and $raw.CycleHits -eq 0)
  }
}

function Get-SSEKnowledgeField($Snapshot) {
  $fields = @($Snapshot.views | Where-Object { $_.type -eq 'Edit' -and [string]$_.name -like '*Suchbegriff*' })
  if (-not $Snapshot.complete -or $fields.Count -ne 1 -or -not $fields[0].rid -or
      -not $fields[0].on -or $fields[0].visible -eq $false -or $fields[0].offscreen -eq $true -or
      [double]$fields[0].w -le 0 -or [double]$fields[0].h -le 0) {
    return $null
  }
  $fields[0]
}

function Get-SSEKnowledgeSections($Views, [int]$MinimumLength, [int]$MaximumSections) {
  $textNodes = @($Views | Where-Object { $_.type -eq 'Text' -and [string]$_.name -and $_.visible -ne $false })
  $groups = New-Object System.Collections.ArrayList
  $parts = New-Object System.Collections.ArrayList
  $parent = $null
  foreach ($node in $textNodes) {
    if ($parts.Count -and [string]$node.p -ne [string]$parent) {
      $null = $groups.Add(@($parts.ToArray())); $parts.Clear()
    }
    $parent = [string]$node.p
    $null = $parts.Add([string]$node.name)
  }
  if ($parts.Count) { $null = $groups.Add(@($parts.ToArray())) }
  $sections = @()
  $seen = New-Object 'System.Collections.Generic.HashSet[string]'
  foreach ($group in $groups) {
    $joined = ($group -join '')
    if ($joined.Length -lt $MinimumLength -or -not $seen.Add($joined)) { continue }
    $sections += [pscustomobject]@{ text=$joined; teile=@($group) }
    if ($sections.Count -ge $MaximumSections) { break }
  }
  [pscustomobject]@{
    abschnitte=@($sections)
    verweise=@($Views | Where-Object { $_.type -eq 'Hyperlink' -and [string]$_.name } |
      ForEach-Object { [string]$_.name } | Select-Object -Unique | Select-Object -First 25)
  }
}

function Test-SSEKnowledgeTerm($Sections, [string]$Term) {
  $tokens = @([regex]::Matches($Term.ToLowerInvariant(), '[\p{L}\p{Nd}]+') | ForEach-Object { $_.Value })
  if (-not $tokens.Count) { return $false }
  foreach ($section in @($Sections)) {
    $text = ([string]$section.text).ToLowerInvariant() -replace '[^\p{L}\p{Nd}]+', ' '
    $missing = @($tokens | Where-Object { -not $text.Contains($_) })
    if (-not $missing.Count) { return $true }
  }
  $false
}

function Get-SSEKnowledgeResults($Snapshot, [int]$MinimumLength, [int]$MaximumSections) {
  if (-not $Snapshot.complete) { return $null }
  $anchors=@($Snapshot.views | Where-Object {
    $_.type -ceq 'Text' -and $_.visible -ne $false -and
    [string]$_.name -cmatch '\AIhre Suche ergab ([0-9]+) Treffer\z'
  })
  if ($anchors.Count -ne 1) { return $null }
  $count=[int64]([regex]::Match([string]$anchors[0].name,'[0-9]+').Value)
  $byIndex=@{}
  foreach ($view in $Snapshot.views) {
    if ($null -eq $view.i -or $byIndex.ContainsKey([int]$view.i)) { return $null }
    $byIndex[[int]$view.i]=$view
  }
  $parent=$anchors[0]
  $list=$null
  for ($level=0; $level -lt 5 -and $parent; $level++) {
    $lists=@($Snapshot.views | Where-Object { $_.p -eq $parent.i -and $_.type -ceq 'List' -and $_.visible -ne $false })
    if ($lists.Count -gt 1) { return $null }
    if ($lists.Count -eq 1) { $list=$lists[0]; break }
    $parent=$byIndex[[int]$parent.p]
  }
  if (-not $list) { return $null }
  $rows=@($Snapshot.views | Where-Object { $_.p -eq $list.i -and $_.type -ceq 'ListItem' -and $_.visible -ne $false })
  if (($count -eq 0 -and $rows.Count -ne 0) -or ($count -gt 0 -and ($rows.Count -eq 0 -or $rows.Count -gt $count))) { return $null }
  $inside=New-Object 'System.Collections.Generic.HashSet[int]'
  $null=$inside.Add([int]$list.i)
  $scope=@(foreach ($view in $Snapshot.views) {
    if ($inside.Contains([int]$view.p)) { $null=$inside.Add([int]$view.i); $view }
  })
  $content=Get-SSEKnowledgeSections $scope $MinimumLength $MaximumSections
  $evidence=Get-SSEKnowledgeSections $scope 1 2500
  $signature=ConvertTo-Json -Depth 8 -Compress -InputObject ([ordered]@{
    treffer=$count; teile=@($evidence.abschnitte | ForEach-Object { ,@($_.teile) }); verweise=@($evidence.verweise)
  })
  [pscustomobject]@{
    trefferAnzahl=$count; abschnitte=@($content.abschnitte); verweise=@($content.verweise)
    evidence=@($evidence.abschnitte); signature=$signature
  }
}

function Update-SSEKnowledgeInputEpoch($InputState) {
  $InputState.tick = Get-SSELastInputTick
  if ($null -eq $InputState.tick) { Fail 'Eigene Eingabe-Epoche ist nicht lesbar.' 'interference' }
}

function Send-SSEKnowledgeInput($Binding, $Field, [string]$Keys, $InputState) {
  if ($null -eq $InputState.tick) { Fail 'Eingabe-Epoche fehlt vor Tasteneingabe.' 'interference' }
  Assert-SSEKnowledgeTarget $Binding $true $InputState.tick
  try { $focused = [SSEAccessible]::DescribeDocumentFocus([int64]$Binding.hwnd) }
  catch { Fail 'Der Steuerwissen-Feldfokus ist nicht lesbar.' 'precondition-failed' }
  if (-not (Test-SSEKnowledgeFieldTarget $Field $focused -RequireFocus)) {
    Fail 'Das gebundene Steuerwissen-Suchfeld hat den Tastaturfokus verloren.' 'precondition-failed'
  }
  Assert-SSEKnowledgeTarget $Binding $true $InputState.tick
  [System.Windows.Forms.SendKeys]::SendWait($Keys)
  Update-SSEKnowledgeInputEpoch $InputState
  Assert-SSEKnowledgeTarget $Binding $true
}

function Test-SSEKnowledgeFieldTarget($Field, $Node, [switch]$RequireFocus) {
  [bool]($Node -and $Node.Role -eq 42 -and [string]$Node.Name -ceq [string]$Field.name -and
    ($Node.State -band 0x18001) -eq 0 -and (-not $RequireFocus -or ($Node.State -band 4) -ne 0) -and
    $Node.W -gt 0 -and $Node.H -gt 0 -and
    [Math]::Abs($Node.X-$Field.x) -le 3 -and [Math]::Abs($Node.Y-$Field.y) -le 3 -and
    [Math]::Abs($Node.W-$Field.w) -le 3 -and [Math]::Abs($Node.H-$Field.h) -le 3)
}

function Test-SSEKnowledgePoint($Binding, $Field, [int]$X, [int]$Y) {
  $hit=Get-SSEPointObstruction ([IntPtr]$Binding.hwnd) $X $Y
  if (-not $hit.isBoundTarget -or $hit.hitPid -ne $Binding.pid -or $hit.hitWindow -le 0) { return $false }
  try { $node=[SSEAccessible]::DescribeDocumentHit([int64]$hit.hitWindow,$X,$Y) }
  catch { return $false }
  [bool]((Test-SSEKnowledgeFieldTarget $Field $node) -and [string]$node.Value -ceq [string]$Field.val)
}

function Wait-SSEKnowledgeInputValue($Binding, $Field, [string]$Term, $InputState) {
  for ($attempt=1; $attempt -le 3; $attempt++) {
    Assert-SSEKnowledgeTarget $Binding $true $InputState.tick
    try { $focused=[SSEAccessible]::DescribeDocumentFocus([int64]$Binding.hwnd) }
    catch { Fail 'Der Steuerwissen-Feldwert ist nicht lesbar; Suche nicht abgeschickt.' 'precondition-failed' }
    Assert-SSEKnowledgeTarget $Binding $true $InputState.tick
    if ((Test-SSEKnowledgeFieldTarget $Field $focused -RequireFocus) -and [string]$focused.Value -ceq $Term) { return }
    if ($attempt -lt 3) { Start-Sleep -Milliseconds 75 }
  }
  Fail 'Der eingegebene Suchbegriff ist nicht exakt bestaetigt; Suche nicht abgeschickt.' 'precondition-failed'
}

function Wait-SSEKnowledgeResult($Binding, $Baseline, [string]$Term, [int]$MinimumLength,
    [int]$MaximumSections, [bool]$AllowUnchangedCandidate, [int]$TimeoutMs = 12000, [int]$PollMs = 150) {
  $timer = [Diagnostics.Stopwatch]::StartNew()
  $baselineSignature = $Baseline.signature
  $previousSignature = $null
  $lastNodeCount = 0
  while ($timer.ElapsedMilliseconds -lt $TimeoutMs) {
    Start-Sleep -Milliseconds $PollMs
    $snapshot = Read-SSEKnowledgeSnapshot $Binding
    $lastNodeCount = $snapshot.nodeCount
    $field = Get-SSEKnowledgeField $snapshot
    $content = Get-SSEKnowledgeResults $snapshot $MinimumLength $MaximumSections
    $signature = $content.signature
    $matches = [bool]($field -and [string]$field.val -ceq $Term -and $content -and
      ($content.trefferAnzahl -eq 0 -or (Test-SSEKnowledgeTerm $content.evidence $Term)))
    $fresh = $AllowUnchangedCandidate -or $signature -cne $baselineSignature
    if ($matches -and $fresh -and $signature -ceq $previousSignature) {
      Assert-SSEKnowledgeTarget $Binding
      return [pscustomobject]@{ content=$content; elapsedMs=[int64]$timer.ElapsedMilliseconds }
    }
    $previousSignature = $(if ($matches -and $fresh) { $signature } else { $null })
  }
  Fail "Keine vollstaendigen, bestaetigten Suchergebnisse innerhalb der Frist; Knoten=$lastNodeCount." 'timeout'
}

function Invoke-SSETaxKnowledgeSearch($Arguments) {
  $previous=[SW]::EnterPhysicalDpiContext()
  if ($previous -eq [IntPtr]::Zero) { Fail 'Physischer DPI-Kontext fuer Steuerwissen ist nicht verfuegbar.' 'unsupported' }
  try { Invoke-SSEKnowledgeSearchPhysical $Arguments }
  finally {
    if (-not [SW]::RestoreDpiContext($previous)) { throw 'Steuerwissen-DPI-Kontext konnte nicht wiederhergestellt werden.' }
  }
}

function Invoke-SSEKnowledgeSearchPhysical($Arguments) {
  if ($script:DESKTOP_NAME) { Fail 'Steuerwissen braucht den sichtbaren Desktop.' 'hidden-desktop' }
  $term = ([string](Arg $Arguments 'begriff')).Trim()
  if ($term.Length -lt 2 -or $term.Length -gt 80 -or $term -match '[\p{Cc}]' -or
      $term -notmatch '[\p{L}\p{Nd}]') { Fail 'begriff braucht 2 bis 80 druckbare Zeichen mit Buchstaben oder Ziffern.' 'bad-args' }
  $minimum = Get-SSEBoundedIntegerArg $Arguments 'mindestLaenge' 60 20 400
  $maximum = Get-SSEBoundedIntegerArg $Arguments 'maxAbschnitte' 12 1 40
  $binding = Select-SSEKnowledgeWindow @(Get-SSEKnowledgeCandidates) (Arg $Arguments 'fenster')
  $inputState=[pscustomobject]@{tick=Get-SSELastInputTick}
  if ($null -eq $inputState.tick) { Fail 'Eingabe-Epoche ist nicht lesbar.' 'interference' }
  $result=Invoke-SSEKnowledgeQuery $binding $term $minimum $maximum $inputState $true
  $waitMs=$result.elapsedMs
  if ($result.baselineSignature -ceq $result.content.signature) {
    # A repeated visible result cannot prove a new search. Establish an
    # opposite, verified result state, then submit the requested term again.
    # All three submissions are read-only searches in this same bound helper.
    $wasEmpty=$result.content.trefferAnzahl -eq 0
    $counterTerm=$(if ($wasEmpty) {'Steuer'} else {'zzsse' + [guid]::NewGuid().ToString('N')})
    $counter=Invoke-SSEKnowledgeQuery $binding $counterTerm 20 40 $inputState $false
    $waitMs+=$counter.elapsedMs
    if (($wasEmpty -and $counter.content.trefferAnzahl -eq 0) -or
        (-not $wasEmpty -and $counter.content.trefferAnzahl -ne 0)) {
      Fail 'Ein unabhaengiger frischer Suchzustand konnte nicht bestaetigt werden.' 'postcondition-failed'
    }
    $result=Invoke-SSEKnowledgeQuery $binding $term $minimum $maximum $inputState $false
    $waitMs+=$result.elapsedMs
  }
  [pscustomobject]@{
    ok=$true; begriff=$term; fenster=[int64]$binding.hwnd; pid=[int]$binding.pid
    trefferAnzahl=[int64]$result.content.trefferAnzahl
    abschnitte=@($result.content.abschnitte); verweise=@($result.content.verweise)
    wartezeitMs=$waitMs
    hinweis=('Rein lesend aus dem Steuerwissen. Kein Steuerfall wurde geaendert. Herstellerinhalt, keine Steuerberatung. ' +
      'teile enthaelt den unveraenderten Wortlaut; text verbindet ohne erfundene Trennzeichen. ' +
      'trefferAnzahl ist der bestaetigte Suchzaehler; mindestLaenge und maxAbschnitte begrenzen die ausgegebenen Auszuege.')
  }
}

function Invoke-SSEKnowledgeQuery($Binding, [string]$Term, [int]$Minimum, [int]$Maximum,
    $InputState, [bool]$AllowUnchangedCandidate) {
  $initialTick=$InputState.tick
  if ($null -eq $initialTick) { Fail 'Eingabe-Epoche fehlt vor Suchphase.' 'interference' }
  $timer = [Diagnostics.Stopwatch]::StartNew()
  $snapshot = $null; $field = $null
  while ($timer.ElapsedMilliseconds -lt 15000) {
    $snapshot = Read-SSEKnowledgeSnapshot $binding
    $field = Get-SSEKnowledgeField $snapshot
    if ($field) { break }
    Start-Sleep -Milliseconds 700
  }
  if (-not $field) { Fail 'Das Suchfeld ist nicht eindeutig und vollstaendig lesbar.' 'not-found' }
  Assert-SSEKnowledgeTarget $binding $false $initialTick
  $null = [SW]::SetForegroundWindow([IntPtr]$binding.hwnd)
  Start-Sleep -Milliseconds 150
  Assert-SSEKnowledgeTarget $binding $true $inputState.tick
  $fresh = Read-SSEKnowledgeSnapshot $binding
  $liveField = Get-SSEKnowledgeField $fresh
  if (-not $liveField -or $liveField.rid -cne $field.rid -or
      [Math]::Abs($liveField.x - $field.x) -gt 3 -or [Math]::Abs($liveField.y - $field.y) -gt 3 -or
      [Math]::Abs($liveField.w - $field.w) -gt 3 -or [Math]::Abs($liveField.h - $field.h) -gt 3) {
    Fail 'Das Suchfeld hat vor dem Klick seine Bindung oder Lage geaendert.' 'precondition-failed'
  }
  $baseline = Get-SSEKnowledgeResults $fresh $Minimum $Maximum
  $x = [int]($liveField.x + $liveField.w / 2); $y = [int]($liveField.y + $liveField.h / 2)
  if (-not (Get-SSEPointObstruction ([IntPtr]$binding.hwnd) $x $y).isBoundTarget) {
    Fail 'Das Steuerwissen-Suchfeld ist verdeckt.' 'precondition-failed'
  }
  Assert-SSEKnowledgeTarget $binding $true $inputState.tick
  Set-SSECursorPoint $x $y
  Assert-SSECursorPoint $x $y
  Update-SSEKnowledgeInputEpoch $inputState
  if (-not (Test-SSEKnowledgePoint $binding $liveField $x $y)) {
    Fail 'Der Klickpunkt gehoert nicht zum frisch gebundenen Suchfeld.' 'precondition-failed'
  }
  Assert-SSEKnowledgeTarget $binding $true $inputState.tick
  [SW]::mouse_event(0x0002, 0, 0, 0, [IntPtr]::Zero)
  [SW]::mouse_event(0x0004, 0, 0, 0, [IntPtr]::Zero)
  Update-SSEKnowledgeInputEpoch $inputState
  Send-SSEKnowledgeInput $binding $liveField '^a' $inputState
  $elements = [Globalization.StringInfo]::GetTextElementEnumerator($term)
  while ($elements.MoveNext()) {
    Send-SSEKnowledgeInput $binding $liveField (ConvertTo-SendKeysLiteral $elements.GetTextElement()) $inputState
  }
  Wait-SSEKnowledgeInputValue $binding $liveField $Term $InputState
  Send-SSEKnowledgeInput $binding $liveField '{ENTER}' $inputState
  $result = Wait-SSEKnowledgeResult $binding $baseline $Term $Minimum $Maximum $AllowUnchangedCandidate
  [pscustomobject]@{content=$result.content;elapsedMs=$result.elapsedMs;baselineSignature=$baseline.signature}
}
