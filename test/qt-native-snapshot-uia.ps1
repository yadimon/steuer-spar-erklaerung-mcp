param([Parameter(Mandatory=$true)][long]$Hwnd, [Parameter(Mandatory=$true)][string]$OutputPath, [string]$Desktop,
    [switch]$WithCellStates, [string]$OptionTableAid, [string]$OptionSaveAid, [string]$OptionCounterAid)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes,WindowsBase
Add-Type -Path (Join-Path $PSScriptRoot '..\powershell\sse-native.dll')
if ($Desktop) {
    if ($Desktop -notmatch '^SSEQtNativeTest_[0-9]+$' -or $OutputPath.Contains('"') -or $PSCommandPath.Contains('"')) {
        throw 'Invalid owned UIA probe arguments'
    }
    $startup = New-Object DSK+SI
    $startup.cb = [Runtime.InteropServices.Marshal]::SizeOf($startup)
    $startup.desktop = 'winsta0\' + $Desktop
    $startup.flags = 1
    $startup.show = 0
    $processInfo = New-Object DSK+PI
    $executable = Join-Path $PSHOME 'powershell.exe'
    $command = [Text.StringBuilder]::new(('"{0}" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{1}" -Hwnd {2} -OutputPath "{3}"' -f
        $executable,$PSCommandPath,$Hwnd,$OutputPath))
    if ($WithCellStates) { $null = $command.Append(' -WithCellStates') }
    if ($OptionTableAid) {
        if ($OptionTableAid -notmatch '^[A-Za-z0-9_.]{1,4096}$') { throw 'Invalid owned option-table ID.' }
        $null = $command.Append((' -OptionTableAid "{0}"' -f $OptionTableAid))
    }
    foreach ($binding in @(@{name='OptionSaveAid';value=$OptionSaveAid}, @{name='OptionCounterAid';value=$OptionCounterAid})) {
        if ($binding.value) {
            if ($binding.value -notmatch '^[A-Za-z0-9_.]{1,4096}$') { throw 'Invalid owned option-control ID.' }
            $null = $command.Append((' -{0} "{1}"' -f $binding.name,$binding.value))
        }
    }
    if (-not [DSK]::CreateProcess($executable,$command,[IntPtr]::Zero,[IntPtr]::Zero,$false,0x08000000,
        [IntPtr]::Zero,$PSScriptRoot,[ref]$startup,[ref]$processInfo)) { throw 'Could not launch the owned UIA probe' }
    [DSK]::CloseHandle($processInfo.hThread) | Out-Null
    try {
        if ([DSK]::WaitForSingleObject($processInfo.hProcess,28000) -eq 258) {
            [DSK]::TerminateProcess($processInfo.hProcess,1) | Out-Null
            throw 'Owned UIA probe exceeded its deadline'
        }
        [uint32]$code = 0
        if (-not [DSK]::GetExitCodeProcess($processInfo.hProcess,[ref]$code) -or $code -ne 0) {
            $detail = if (Test-Path -LiteralPath ($OutputPath + '.failure.txt')) { [IO.File]::ReadAllText($OutputPath + '.failure.txt') } else { '' }
            throw ('Owned UIA probe failed: ' + $detail)
        }
    } finally { [DSK]::CloseHandle($processInfo.hProcess) | Out-Null }
    return
}
# Match the worker's proxy-free UIA initialization before entering compiled tree traversal.
$null = [Windows.Automation.AutomationElement]::FromHandle([IntPtr]$Hwnd)
if ($OptionTableAid) {
    try {
    $root = [Windows.Automation.AutomationElement]::FromHandle([IntPtr]$Hwnd)
    if (-not $root) { throw 'The exact option fixture window is absent.' }
    $condition = [Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::AutomationIdProperty, $OptionTableAid)
    $tables = @($root.FindAll([Windows.Automation.TreeScope]::Descendants, $condition) | Where-Object {
        $_.Current.ControlType -in @([Windows.Automation.ControlType]::Table, [Windows.Automation.ControlType]::DataGrid)
    })
    if ($tables.Count -ne 1) { throw ('The exact fixture option table is not unique: ' + $tables.Count) }
    $grid = [Windows.Automation.GridPattern]$tables[0].GetCurrentPattern([Windows.Automation.GridPattern]::Pattern)
    $options = @()
    for ($row = 0; $row -lt $grid.Current.RowCount; $row++) {
        $label = $grid.GetItem($row, 2)
        $toggleCell = $grid.GetItem($row, 0)
        $toggle = [Windows.Automation.TogglePattern]$toggleCell.GetCurrentPattern([Windows.Automation.TogglePattern]::Pattern)
        $state = $toggle.Current.ToggleState
        if ($state -notin @([Windows.Automation.ToggleState]::On, [Windows.Automation.ToggleState]::Off)) { throw 'Nonbinary option state.' }
        $options += [pscustomobject][ordered]@{ index=$row; name=([string]$label.Current.Name).Trim(); selected=($state -eq [Windows.Automation.ToggleState]::On) }
    }
    $result = [pscustomobject][ordered]@{rowCount=$grid.Current.RowCount; columnCount=$grid.Current.ColumnCount; options=$options}
    foreach ($binding in @(@{name='saveEnabled';aid=$OptionSaveAid}, @{name='clickCount';aid=$OptionCounterAid})) {
        if ($binding.aid) {
            $controlCondition = [Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::AutomationIdProperty, $binding.aid)
            $controls = @($root.FindAll([Windows.Automation.TreeScope]::Descendants, $controlCondition))
            if ($controls.Count -ne 1) { throw 'The exact option completion control is not unique.' }
            $value = if ($binding.name -eq 'saveEnabled') { [bool]$controls[0].Current.IsEnabled } else { [int]$controls[0].Current.Name }
            $result | Add-Member -MemberType NoteProperty -Name $binding.name -Value $value
        }
    }
    [IO.File]::WriteAllText($OutputPath, ($result | ConvertTo-Json -Depth 5 -Compress), [Text.UTF8Encoding]::new($false))
    return
    } catch {
        [IO.File]::WriteAllText($OutputPath + '.failure.txt', [string]$_, [Text.UTF8Encoding]::new($false))
        throw
    }
}
$snapshot = [SSEUiaTree]::Describe([IntPtr]$Hwnd,5000,25000,16,$true,$false)
$nodes = [SSEUiaTree]::ToViews($snapshot.Nodes,$null)
[IO.File]::WriteAllText($OutputPath,(ConvertTo-Json -InputObject @($nodes) -Depth 8),[Text.UTF8Encoding]::new($false))
# Read the real provider's TogglePattern independently of the bulk snapshot, which omits cell states.
$root = [Windows.Automation.AutomationElement]::FromHandle([IntPtr]$Hwnd)
$cellColumns = @()
if ($WithCellStates) { $cellColumns = @(0,1,3,4) }
$cellStates = @(foreach ($column in $cellColumns) {
    $name = 'row-0-cell-' + $column
    $condition = [Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::NameProperty,$name)
    $element = $root.FindFirst([Windows.Automation.TreeScope]::Descendants,$condition)
    if ($null -eq $element) { throw ('Missing fixture cell: ' + $name) }
    $pattern = $null
    $checked = $null
    $toggleState = $null
    if ($element.TryGetCurrentPattern([Windows.Automation.TogglePattern]::Pattern,[ref]$pattern)) {
        $toggleState = $pattern.Current.ToggleState.ToString()
        $checked = switch ($toggleState) { 'On' { $true } 'Off' { $false } 'Indeterminate' { 'unbestimmt' } default { throw 'Unknown toggle state' } }
    }
    @{ name=$name; rid=($element.GetRuntimeId() -join '.'); checked=$checked; toggleState=$toggleState }
})
[IO.File]::WriteAllText(($OutputPath + '.cells.json'),(ConvertTo-Json -InputObject $cellStates -Depth 4),[Text.UTF8Encoding]::new($false))
$rectangle = New-Object SW+RC
if (-not [SW]::GetWindowRect([IntPtr]$Hwnd,[ref]$rectangle)) { throw 'Cannot read fixture window rectangle' }
$rect = @{ x=$rectangle.L; y=$rectangle.T; w=($rectangle.R-$rectangle.L); h=($rectangle.B-$rectangle.T) }
[IO.File]::WriteAllText(($OutputPath + '.window.json'),(ConvertTo-Json $rect),[Text.UTF8Encoding]::new($false))
