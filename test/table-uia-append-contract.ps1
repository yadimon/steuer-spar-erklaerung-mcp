param([string]$Repo=(Join-Path $PSScriptRoot '..'))
$ErrorActionPreference='Stop'
# Runs the real append transaction against a synthetic table model. The UIA
# type endpoints are bound to this fixture's own namespace; no UIA or Win32
# assembly is loaded, no desktop is touched and no product process is started.
# The fixture offers no pointer, key or scroll endpoint at all, no foreground
# and no reader of the person's input: a transaction that reached for one
# would fail on a missing type, member or command.
$worker=Join-Path $Repo 'powershell/sse-worker.ps1'
$ast=[Management.Automation.Language.Parser]::ParseFile($worker,[ref]$null,[ref]$null)
foreach($name in @('Arg','New-SSETableRowDetails','Get-SSETableProfileColumn')){
  $definition=@($ast.FindAll({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $name},$true))
  if($definition.Count -ne 1){throw "Expected exactly one production helper: $name"}
  . ([scriptblock]::Create($definition[0].Extent.Text))
}
. (Join-Path $Repo 'powershell/table-values.ps1')
. (Join-Path $Repo 'powershell/table-combobox.ps1')
foreach($module in @('table-grid-read.ps1','table-uia-delete.ps1','table-uia-append.ps1')){
  $source=Get-Content -LiteralPath (Join-Path $Repo ('powershell/'+$module)) -Raw
  . ([scriptblock]::Create($source.Replace('[Windows.','[SseUiaAppendFixture.Windows.')))
}
Add-Type @'
using System;
using System.Collections.Generic;
// Window 1 is the bound main window of process 7.
public static class SW {
 public static int ExtraWindows;public static bool WindowGone;
 public static bool IsWindow(IntPtr hwnd){return hwnd==new IntPtr(1)&&!WindowGone;}
 public static int GetWindowThreadProcessId(IntPtr hwnd,out int pid){pid=7;return 1;}
}
namespace SseUiaAppendFixture.Windows.Automation {
 public static class ControlType {public static string DataItem="DataItem",Table="Table";}
 public class Table {
  public List<string[]> Names=new List<string[]>(),Raws=new List<string[]>();
  public bool[] ReadOnly=new bool[7];public List<string> Writes=new List<string>();
  public int CorruptWrite=-1,TouchFormerRowAtWrite=-1,ForeignValueAtWrite=-1;
  public int IgnoreWrite=-1;public bool NoMaterialize,RemoveRowsOnClear;
  public int WindowGoneAtWrite=-1,ExtraWindowAtWrite=-1;
  public TableInfo Current;
  public Table(){Current=new TableInfo();}
  public int[] GetRuntimeId(){return new int[]{42,7};}
  public bool TryGetCurrentPattern(object pattern,out object result){
   result=null;if(!object.ReferenceEquals(pattern,GridPattern.Pattern))return false;
   result=new GridPattern(this);return true;
  }
  public void AddRow(string[] names){Names.Add(names);Raws.Add(new string[]{names[0],names[1],names[2],"","","",""});}
  public void AddSlot(){Names.Add(new string[]{"","","","0,00","","0","0,00"});Raws.Add(new string[]{"","","","","","",""});}
  public void Set(int row,int column,string value){
   Writes.Add(row+":"+column+"="+value);int number=Writes.Count;
   if(number==IgnoreWrite)return;
   if(number==WindowGoneAtWrite)SW.WindowGone=true;
   if(number==ExtraWindowAtWrite)SW.ExtraWindows++;
   if(number==TouchFormerRowAtWrite)Names[0][2]="Touched former row";
   string shown=number==CorruptWrite?"Corrupted":value;
   bool amount=column==3||column==6;
   if(value==""){Names[row][column]=amount?"0,00":(column==5?"0":"");Raws[row][column]="";if(column==3)Names[row][6]="0,00";}
   else{Names[row][column]=shown;Raws[row][column]=amount?"":shown;if(column==3)Names[row][6]=shown;}
   if(number==ForeignValueAtWrite){Names[2][2]="Foreign value";Raws[2][2]="Foreign value";}
   bool last=row==Names.Count-1;
   if(last&&value!=""&&!NoMaterialize)AddSlot();
   if(!last&&row==Names.Count-2&&RemoveRowsOnClear&&Names[row][1]==""&&Names[row][2]==""&&Names[row][3]=="0,00"){Names.RemoveAt(row);Raws.RemoveAt(row);}
  }
 }
 public class TableInfo {public int ProcessId=7;public string AutomationId="Synthetic.Table";}
 public class GridPattern {
  public static object Pattern=new object();public GridInfo Current;Table table;
  public GridPattern(Table owner){table=owner;Current=new GridInfo(owner);}
  public Cell GetItem(int row,int column){return row<0||row>=table.Names.Count||column<0||column>=7?null:new Cell(table,row,column);}
 }
 public class GridInfo {Table table;public GridInfo(Table owner){table=owner;}public int RowCount{get{return table.Names.Count;}}public int ColumnCount{get{return 7;}}}
 public class Cell {
  public Table Owner;public int Row,Column;public CellInfo Current;
  public Cell(Table owner,int row,int column){Owner=owner;Row=row;Column=column;Current=new CellInfo(this);}
  public int[] GetRuntimeId(){return new int[]{42,7,Row,Column};}
  public bool TryGetCurrentPattern(object pattern,out object result){
   result=null;
   if(object.ReferenceEquals(pattern,GridItemPattern.Pattern)){result=new GridItemPattern(this);return true;}
   if(object.ReferenceEquals(pattern,ValuePattern.Pattern)&&Column!=4){result=new ValuePattern(this);return true;}
   return false;
  }
 }
 public class CellInfo {
  Cell cell;public CellInfo(Cell owner){cell=owner;}
  public int ProcessId{get{return 7;}}public string ControlType{get{return "DataItem";}}public bool IsEnabled{get{return true;}}
  public string Name{get{return cell.Owner.Names[cell.Row][cell.Column];}}
 }
 public class GridItemPattern {public static object Pattern=new object();public GridItemInfo Current;public GridItemPattern(Cell cell){Current=new GridItemInfo{Row=cell.Row,Column=cell.Column,ContainingGrid=cell.Owner};}}
 public class GridItemInfo {public int Row,Column,RowSpan=1,ColumnSpan=1;public Table ContainingGrid;}
 public class ValuePattern {
  public static object Pattern=new object();public ValueInfo Current;Cell cell;
  public ValuePattern(Cell owner){cell=owner;Current=new ValueInfo(owner);}
  public void SetValue(string value){cell.Owner.Set(cell.Row,cell.Column,value);}
 }
 public class ValueInfo {
  Cell cell;public ValueInfo(Cell owner){cell=owner;}
  public string Value{get{return cell.Owner.Raws[cell.Row][cell.Column];}}
  public bool IsReadOnly{get{return cell.Owner.ReadOnly[cell.Column];}}
 }
}
'@
function Assert([bool]$Condition,[string]$Message){if(-not $Condition){throw $Message}}
function Get-FixtureSum {
  $total=[decimal]0
  foreach($row in $script:table.Names){$total+=[decimal]::Parse($row[3].Replace(',','.'),[Globalization.CultureInfo]::InvariantCulture)}
  foreach($bias in @([decimal]1)){if($script:table.Writes.Count -ge $script:sumBiasFromWrite){$total+=$bias}}
  $total.ToString('0.00',[Globalization.CultureInfo]::InvariantCulture).Replace('.',',')
}
function New-FixtureScan {
  $headers=@(for($column=0;$column -lt 7;$column++){
    [pscustomobject]@{column=$column;name=@('Nr.','Datum','Bezeichnung','Betrag','N','%','Netto')[$column];rid=('Header.'+$column);visible=$true
      rect=[pscustomobject]@{empty=$false;x=[double]($column*100);y=[double]10;width=[double]99;height=[double]20}}
  })
  $cells=New-Object System.Collections.ArrayList
  for($row=0;$row -lt $script:table.Names.Count;$row++){
    for($column=0;$column -lt 7;$column++){
      $name=[string]$script:table.Names[$row][$column]
      $semantic=$(if($column -eq 4){[pscustomobject]@{ok=$true;type='boolean';value=$false;checkboxState='Off'}}
        else{[pscustomobject]@{ok=$true;type='text';value=$name;checkboxState=$null}})
      $null=$cells.Add([pscustomobject]@{row=$row;column=$column;rid=('Cell.'+$row+'.'+$column);name=$name;semantic=$semantic})
    }
  }
  [pscustomobject]@{rows=$script:table.Names.Count;readRows=$script:table.Names.Count;columns=7;headers=$headers;cells=@($cells)}
}
# The complete model-bound state reader is an OS boundary of this contract.
function Read-SSEUiaDeleteState {
  param($Binding,[switch]$AllowOwnEditor)
  $script:stateReads++
  [SW]::ExtraWindows+=$script:extraWindowsBeforeStateRead;$script:extraWindowsBeforeStateRead=0
  if(-not (Test-SSEUiaDeleteEpoch $Binding)){throw 'Synthetic state reader lost its epoch.'}
  $scan=New-FixtureScan
  [pscustomobject]@{model=(ConvertTo-SSEGridLogicalModel $scan ($scan|ConvertTo-Json -Depth 8|ConvertFrom-Json) 1000 7 'Synthetic.Table');scan=$scan
    root=[pscustomobject]@{rid='42.7';aid='Synthetic.Table'};table=$script:table;tree=[pscustomobject]@{read=$script:stateReads}
    region=[pscustomobject]@{ok=$true;profileMappingId=$script:profileMappingId};summary=(Get-FixtureSum);summaryAid='Synthetic.Sum'
    dirty=[bool]($script:table.Writes.Count -gt 0);editors=@();inputState=$null}
}
# The passive first read is the moment at which the window situation may
# change before anything was written.
function Read-LabeledValue {
  [SW]::ExtraWindows+=$script:extraWindowsOnPassiveRead
  [pscustomobject]@{value=(Get-FixtureSum);selected=$script:summary;tree=[pscustomobject]@{read=0}}
}
function Get-CurrentHeading {$script:heading}
# Activation is the only window endpoint: it neither reads nor waits for input.
function Show-SSEWindow {$script:shows++;$script:windows=@($script:windows)+@($script:windowsOnShow)}
function Get-SSEInteractionWindowSet {
  [pscustomobject]@{fingerprint=('Windows.'+($script:windows.Count+[SW]::ExtraWindows));windows=@($script:windows)}
}
function Resolve-SSETableProfile {$script:profile}
function Get-SSEPageCheckerMessages {
  @(foreach($row in $script:table.Names){if($script:checkerText -and $row[2] -ceq $script:checkerText){'Synthetic checker message'}})
}
function Compare-SSEPageCheckerMessages([object[]]$Before,[object[]]$After){@($After|Where-Object{$_ -cnotin $Before})}
function Start-Sleep {}

function New-Fixture {
  $script:table=New-Object SseUiaAppendFixture.Windows.Automation.Table
  $script:table.AddRow(@('1','01.01','Existing alpha','10,00','','0','10,00'))
  $script:table.AddRow(@('2','02.01','Existing beta','10,45','','0','10,45'))
  $script:table.AddSlot()
  $script:heading='Synthetic page';$script:summary=[pscustomobject]@{aid='Synthetic.Sum'}
  $script:windows=@([pscustomobject]@{role='main'});$script:profile=[pscustomobject]@{known=$false;bindingOk=$true;columns=@()}
  $script:profileMappingId=$null;$script:checkerText='';$script:sumBiasFromWrite=1000
  $script:stateReads=0;[SW]::ExtraWindows=0;[SW]::WindowGone=$false;$script:extraWindowsOnPassiveRead=0
  $script:shows=0;$script:windowsOnShow=@();$script:extraWindowsBeforeStateRead=0;$script:SSE_CURSOR_PRESERVE_UNPROVEN_FOCUS=$false
}
function New-Rows([int]$Count){
  @(for($index=1;$index -le $Count;$index++){[pscustomobject]@{werte=@('','',('Synthetic row '+$index),'11,11')}})
}
function Invoke-Append($Rows,[string]$ExpectedAfter=''){
  $arguments=[pscustomobject]@{expectedPage='Synthetic page';sumLabel='Summe';expectedBefore='20,45';zeilen=@($Rows)}
  if($ExpectedAfter){$arguments|Add-Member NoteProperty expectedAfter $ExpectedAfter}
  Invoke-SSEUiaTableAppendRows ([IntPtr]1) 7 $arguments ([Diagnostics.Process]::GetCurrentProcess())
}
function Get-Names {@($script:table.Names|ForEach-Object{$_ -join '|'}) -join "`n"}
$initialNames=$null;$emptyRow='|||0,00||0|0,00'
New-Fixture;$initialNames=Get-Names

# Twelve rows reach far beyond any displayed part; the model path has no viewport.
New-Fixture
$result=Invoke-Append (New-Rows 12) '153,77'
Assert ($result.ok -and $result.resultingState -ceq 'completed-verified' -and $result.mutationStarted -and -not $result.outcomeUnknown) 'Twelve plain rows were not completed.'
Assert ($script:table.Names.Count -eq 15 -and $result.sumBefore -ceq '20,45' -and $result.sumAfter -ceq '153,77') 'The completed model or its sums are wrong.'
Assert ($script:table.Names[0][2] -ceq 'Existing alpha' -and $script:table.Names[1][2] -ceq 'Existing beta') 'A former row changed.'
Assert ($script:table.Names[2][2] -ceq 'Synthetic row 1' -and $script:table.Names[13][2] -ceq 'Synthetic row 12' -and $script:table.Names[13][3] -ceq '11,11') 'Rows are not in request order at their model coordinates.'
Assert (($script:table.Names[14] -join '|') -ceq $emptyRow) 'The input slot is not free again.'
Assert ($script:table.Writes.Count -eq 24 -and $script:table.Writes[0] -ceq '2:2=Synthetic row 1' -and $script:table.Writes[1] -ceq '2:3=11,11' -and $script:table.Writes[23] -ceq '13:3=11,11') 'Writes are not exactly the requested cells in order.'
Assert ($result.rows.Count -eq 12 -and $result.rows[11].index -eq 11 -and $result.rows[11].modelRow -eq 13 -and $result.rows[0].zellen.Count -eq 2 -and $result.rows[0].zellen[1].ist -ceq '11,11') 'Row evidence is incomplete.'
Assert ($result.proof.outcome -ceq 'appended-exact' -and $result.proof.rowsBefore -eq 3 -and $result.proof.rowsAfter -eq 15 -and $result.proof.beforeFingerprint -cne $result.proof.afterFingerprint) 'The model proof is incomplete.'
Assert ($script:shows -eq 1 -and $script:stateReads -eq 2 -and $null -eq $result.rollback) 'A completed append needs one activation and exactly two complete reads.'
Assert ($result.completed -eq 12 -and -not $result.retryable -and -not $script:SSE_CURSOR_PRESERVE_UNPROVEN_FOCUS) 'A completed append reports a wrong count or repeatability, or keeps the foreground.'
Write-Output 'append: twelve rows written by model coordinate, former rows untouched, slot free, one activation, two complete reads.'

# Without a predicted sum the rows are completed as well.
New-Fixture
$result=Invoke-Append (New-Rows 1)
Assert ($result.ok -and $script:table.Names.Count -eq 4 -and $result.sumAfter -ceq '31,56') 'A single row without predicted sum was not completed.'

# Refusals before the table is read keep their own reason.
New-Fixture;$script:heading='Other page'
$result=Invoke-Append (New-Rows 2)
Assert (-not $result.ok -and $result.kind -ceq 'precondition-failed' -and $result.phase -ceq 'precondition' -and $result.resultingState -ceq 'unchanged' -and
  -not $result.mutationStarted -and -not $result.retryable -and $script:shows -eq 0 -and $script:stateReads -eq 0 -and
  $script:table.Writes.Count -eq 0) 'A wrong page was not refused before the window was raised.'
New-Fixture;$script:table.Names[1][3]='99,00'
$result=Invoke-Append (New-Rows 2)
Assert (-not $result.ok -and $result.kind -ceq 'precondition-failed' -and $script:shows -eq 0 -and $script:table.Writes.Count -eq 0) 'A stale sum was not refused before the window was raised.'
New-Fixture;$script:summary=$null
$result=Invoke-Append (New-Rows 2)
Assert (-not $result.ok -and $result.kind -ceq 'precondition-failed' -and $script:shows -eq 0 -and $script:table.Writes.Count -eq 0) 'A missing summary was not refused before the window was raised.'
New-Fixture;$script:windows=@([pscustomobject]@{role='main'},[pscustomobject]@{role='blocking-or-unknown'})
$result=Invoke-Append (New-Rows 2)
Assert (-not $result.ok -and $result.kind -ceq 'precondition-failed' -and $result.phase -ceq 'initial' -and $script:shows -eq 0 -and
  $script:table.Writes.Count -eq 0) 'A blocking own window was not refused.'
New-Fixture;$script:heading='Other page';$script:extraWindowsOnPassiveRead=1
$result=Invoke-Append (New-Rows 2)
Assert (-not $result.ok -and $result.kind -ceq 'precondition-failed' -and -not $result.retryable -and $script:shows -eq 0 -and
  $script:table.Writes.Count -eq 0) 'A refusal before the first write lost its own reason to a changed window situation.'
# Raising may move or restore the window: the binding continues from the
# window set found afterwards. A further window that appears then is a stop.
New-Fixture;$script:extraWindowsOnPassiveRead=1
$result=Invoke-Append (New-Rows 2)
Assert ($result.ok -and $script:shows -eq 1 -and $script:table.Writes.Count -eq 4) 'A window that only changed before it was raised stopped the rows.'
New-Fixture;$script:windowsOnShow=@([pscustomobject]@{role='blocking-or-unknown'})
$result=Invoke-Append (New-Rows 2)
Assert (-not $result.ok -and $result.kind -ceq 'interference' -and $result.phase -ceq 'activation' -and $result.resultingState -ceq 'unchanged' -and
  -not $result.mutationStarted -and $script:shows -eq 1 -and $script:stateReads -eq 0 -and $script:table.Writes.Count -eq 0) 'A further window that appeared while the window was raised was not a stop before any write.'
# A window situation that changes before the first write is a clean, repeatable stop.
New-Fixture;$script:extraWindowsBeforeStateRead=1
$result=Invoke-Append (New-Rows 2)
Assert (-not $result.ok -and $result.kind -ceq 'interference' -and $result.phase -ceq 'initial-read' -and $result.resultingState -ceq 'unchanged' -and
  $result.retryable -and $result.completed -eq 0 -and -not $result.mutationStarted -and $null -eq $result.rollback -and
  $script:table.Writes.Count -eq 0 -and -not $script:SSE_CURSOR_PRESERVE_UNPROVEN_FOCUS) 'A window situation that changed before the first write was not a clean, repeatable stop.'
Write-Output 'append: wrong page, stale sum, missing summary and a blocking window are refused before the window is raised; a changed window situation stops before the first write.'

# Refusals after binding and before any write.
New-Fixture;$script:profile=[pscustomobject]@{known=$true;bindingOk=$true;columns=@([pscustomobject]@{index=3;header='Betrag';controlType='ComboBox'})}
$result=Invoke-Append (New-Rows 2)
Assert (-not $result.ok -and $result.kind -ceq 'unsupported-table-combobox' -and $result.resultingState -ceq 'unchanged' -and $script:table.Writes.Count -eq 0) 'A profiled selection column was not refused.'
New-Fixture;$script:profile=[pscustomobject]@{known=$true;bindingOk=$false;reason='Synthetic mismatch.';pageId='p';tableId='t';columns=@()}
$result=Invoke-Append (New-Rows 2)
Assert (-not $result.ok -and $result.kind -ceq 'table-profile-mismatch' -and $script:table.Writes.Count -eq 0) 'An unbound table profile was not refused.'
New-Fixture;$script:profileMappingId='synthetic_row_contract'
$result=Invoke-Append (New-Rows 2)
Assert (-not $result.ok -and $result.kind -ceq 'unsupported-table-cell' -and $script:table.Writes.Count -eq 0) 'A table with its own row contract was not refused.'
New-Fixture
$result=Invoke-Append @([pscustomobject]@{werte=@('','','Synthetic row','11,11','true')})
Assert (-not $result.ok -and $result.kind -ceq 'unsupported-table-cell' -and $script:table.Writes.Count -eq 0) 'A checkbox column was not refused.'
New-Fixture
$result=Invoke-Append @((New-Rows 1)[0],[pscustomobject]@{werte=@('','','a','1,00','','','','extra')})
Assert (-not $result.ok -and $result.kind -ceq 'bad-args' -and $script:table.Writes.Count -eq 0) 'More values than displayed columns were not refused for the whole request.'
New-Fixture
$result=Invoke-Append @([pscustomobject]@{werte=@('','','','')})
Assert (-not $result.ok -and $result.kind -ceq 'bad-args' -and $script:table.Writes.Count -eq 0) 'A row without a value was not refused.'
New-Fixture;$script:table.Names[2][2]='Half entered'
$result=Invoke-Append (New-Rows 2) '42,67'
Assert (-not $result.ok -and $result.kind -ceq 'not-found' -and $result.resultingState -ceq 'unchanged' -and $script:table.Writes.Count -eq 0) 'A last row that is no free input slot was written.'
New-Fixture;$script:table.ReadOnly[3]=$true
$result=Invoke-Append (New-Rows 2)
Assert (-not $result.ok -and $result.kind -ceq 'readonly' -and $result.resultingState -ceq 'unchanged' -and $script:table.Writes.Count -eq 0) 'A read-only target cell was written.'
Write-Output 'append: selection, checkbox, own row contract, surplus values, occupied slot and read-only cells are refused before any write.'

# An ordinary own failure restores every own value and proves the original values
# and summary. Qt keeps a materialized row: the own rows remain as empty rows,
# and the result says so instead of claiming a complete restore.
New-Fixture;$script:table.CorruptWrite=4
$result=Invoke-Append (New-Rows 3) '53,78'
Assert (-not $result.ok -and $result.kind -ceq 'postcondition-failed' -and $result.phase -ceq 'write' -and $result.mutationStarted -and
  $result.resultingState -ceq 'values-restored' -and -not $result.outcomeUnknown -and -not $result.retryable -and $result.rollback.versucht -and
  $result.rollback.werteWiederhergestellt -and -not $result.rollback.strukturEntfernt -and -not $result.rollback.erfolgreich -and
  $result.rollback.verbliebeneLeerzeilen -eq 2 -and $result.rollback.summe -ceq '20,45') 'A wrong cell readback did not restore the own values.'
Assert ((Get-Names) -ceq ($initialNames+"`n"+$emptyRow+"`n"+$emptyRow)) 'The restored model is not the original one plus the emptied own rows.'
Assert ($result.rows.Count -eq 2 -and $result.rows[1].zellen[1].ist -ceq 'Corrupted' -and -not $result.rows[1].zellen[1].ok) 'The failing cell is missing from the evidence.'
New-Fixture;$script:table.NoMaterialize=$true
$result=Invoke-Append (New-Rows 1)
Assert (-not $result.ok -and $result.kind -ceq 'postcondition-failed' -and $result.phase -ceq 'write' -and $result.error -like '*keine neue Anlegezeile*' -and
  $result.resultingState -ceq 'restored' -and $script:stateReads -eq 2) 'A row without a fresh input slot was not found while writing.'
New-Fixture;$script:table.NoMaterialize=$true
$result=Invoke-Append (New-Rows 2)
Assert (-not $result.ok -and $result.kind -ceq 'postcondition-failed' -and $result.resultingState -ceq 'restored' -and $result.rollback.erfolgreich -and
  $result.rollback.strukturEntfernt -and $result.rollback.verbliebeneLeerzeilen -eq 0 -and (Get-Names) -ceq $initialNames) 'A row that never left the input slot was not restored completely.'
New-Fixture
$result=Invoke-Append (New-Rows 3) '99,99'
Assert (-not $result.ok -and $result.kind -ceq 'postcondition-failed' -and $result.phase -ceq 'final-read' -and $result.resultingState -ceq 'values-restored' -and
  $result.rollback.werteWiederhergestellt -and $result.rollback.verbliebeneLeerzeilen -eq 3 -and $result.rollback.summe -ceq '20,45' -and
  (Get-Names) -ceq ($initialNames+"`n"+$emptyRow+"`n"+$emptyRow+"`n"+$emptyRow)) 'A wrong predicted sum did not restore the values of all rows.'
Assert ($script:table.Writes.Count -eq 15 -and $script:table.Writes[6] -ceq '4:6=' -and $script:table.Writes[7] -ceq '4:3=' -and $script:table.Writes[8] -ceq '4:2=' -and
  $script:table.Writes[14] -ceq '2:2=') 'Rows were not restored last row first and last column first.'
New-Fixture;$script:table.RemoveRowsOnClear=$true
$result=Invoke-Append (New-Rows 3) '99,99'
Assert (-not $result.ok -and $result.resultingState -ceq 'restored' -and $result.rollback.erfolgreich -and $result.rollback.strukturEntfernt -and
  $result.rollback.verbliebeneLeerzeilen -eq 0 -and (Get-Names) -ceq $initialNames) 'A table that gives emptied rows back was not reported as completely restored.'
New-Fixture;$script:checkerText='Synthetic row 2'
$result=Invoke-Append (New-Rows 2)
Assert (-not $result.ok -and $result.kind -ceq 'postcondition-failed' -and $result.resultingState -ceq 'values-restored' -and
  $result.rollback.verbliebeneLeerzeilen -eq 2 -and (Get-Names) -ceq ($initialNames+"`n"+$emptyRow+"`n"+$emptyRow)) 'A new checker message did not restore the own values.'
Write-Output 'append: wrong readback, missing slot, wrong sum and a new checker message restore the own values; rows Qt keeps are reported as empty rows.'

# A further window of the program stops the rows before the next one. The row
# in progress is completed, and one passive complete read, bound to the window
# set it finds, proves which rows stand.
New-Fixture;$script:table.ExtraWindowAtWrite=3
$result=Invoke-Append (New-Rows 5)
Assert (-not $result.ok -and $result.kind -ceq 'interference' -and $result.phase -ceq 'write' -and $result.mutationStarted -and
  $result.resultingState -ceq 'partially-completed-verified' -and -not $result.outcomeUnknown -and $result.retryable -and
  $result.completed -eq 2 -and $result.sumBefore -ceq '20,45' -and $result.sumAfter -ceq '42,67' -and
  -not $result.rollback.versucht) 'A changed window situation did not stop between rows with a proven partial state.'
Assert ($script:table.Writes.Count -eq 4 -and $script:table.Names.Count -eq 5 -and $script:stateReads -eq 2 -and
  $result.rows.Count -eq 2 -and $result.rows[1].zellen.Count -eq 2 -and $script:table.Names[3][3] -ceq '11,11' -and
  ($script:table.Names[4] -join '|') -ceq $emptyRow -and -not $script:SSE_CURSOR_PRESERVE_UNPROVEN_FOCUS) 'A row was left incomplete, writing went on after the stop, or a proven state kept the foreground.'
New-Fixture;$script:table.ExtraWindowAtWrite=1
$result=Invoke-Append (New-Rows 3)
Assert (-not $result.ok -and $result.kind -ceq 'interference' -and $result.resultingState -ceq 'partially-completed-verified' -and
  $result.completed -eq 1 -and $result.sumAfter -ceq '31,56' -and $script:table.Writes.Count -eq 2) 'A stop after the first row did not report exactly that row.'
Write-Output 'append: a changed window situation stops between rows; the completed rows and their sum are proved by one passive read.'

# What cannot be proved stays unknown and is never restored blindly.
New-Fixture;$script:table.TouchFormerRowAtWrite=3
$result=Invoke-Append (New-Rows 2)
Assert (-not $result.ok -and $result.kind -ceq 'postcondition-failed' -and $result.resultingState -ceq 'unknown' -and $result.outcomeUnknown -and
  $result.rollback.versucht -and -not $result.rollback.erfolgreich -and -not $result.rollback.werteWiederhergestellt -and $result.rollback.error -and
  $script:SSE_CURSOR_PRESERVE_UNPROVEN_FOCUS) 'A changed former row was reported as restored, or an unknown state gave the foreground away.'
New-Fixture;$script:table.ExtraWindowAtWrite=3;$script:table.TouchFormerRowAtWrite=3
$result=Invoke-Append (New-Rows 3)
Assert (-not $result.ok -and $result.kind -ceq 'interference' -and $result.resultingState -ceq 'unknown' -and $result.outcomeUnknown -and
  -not $result.retryable -and $result.completed -eq 0 -and $null -eq $result.sumAfter -and -not $result.rollback.versucht -and
  $result.rollback.zustandsbeweis -like '*exactly the completed rows*') 'A stop with a changed former row was reported as a proven partial state.'
New-Fixture;$script:table.ExtraWindowAtWrite=3;$script:table.ForeignValueAtWrite=3
$result=Invoke-Append (New-Rows 3)
Assert (-not $result.ok -and $result.kind -ceq 'interference' -and $result.resultingState -ceq 'unknown' -and -not $result.retryable -and
  $result.rollback.zustandsbeweis -like '*no longer shows*') 'A completed row with a foreign value was reported as a proven partial state.'
New-Fixture;$script:table.WindowGoneAtWrite=3
$result=Invoke-Append (New-Rows 3)
Assert (-not $result.ok -and $result.kind -ceq 'interference' -and $result.resultingState -ceq 'unknown' -and $result.outcomeUnknown -and
  -not $result.retryable -and $result.completed -eq 0 -and $script:table.Writes.Count -eq 4 -and $script:stateReads -eq 2) 'A state read without the live window was reported as a proven partial state.'
New-Fixture;$script:table.CorruptWrite=4;$script:table.ExtraWindowAtWrite=4
$result=Invoke-Append (New-Rows 3)
Assert (-not $result.ok -and $result.kind -ceq 'interference' -and $result.resultingState -ceq 'unknown' -and $result.outcomeUnknown -and
  -not $result.retryable -and $result.rollback.zustandsbeweis -like '*begun but not completed*' -and $script:stateReads -eq 1 -and
  $script:table.Writes.Count -eq 4) 'A row that was begun and not completed was restored blindly or reported as a proven state.'
New-Fixture;$script:table.CorruptWrite=4;$script:table.ForeignValueAtWrite=4
$result=Invoke-Append (New-Rows 3)
Assert (-not $result.ok -and $result.resultingState -ceq 'unknown' -and $result.rollback.versucht -and -not $result.rollback.werteWiederhergestellt -and
  $script:table.Names.Count -eq 5 -and $script:table.Names[2][2] -ceq 'Foreign value') 'A cell with a value this transaction did not write was overwritten by the restore.'
New-Fixture;$script:table.CorruptWrite=2;$script:table.IgnoreWrite=5
$result=Invoke-Append (New-Rows 1)
Assert (-not $result.ok -and $result.resultingState -ceq 'unknown' -and -not $result.rollback.werteWiederhergestellt -and
  $result.rollback.error -like '*recorded value*' -and $script:stateReads -eq 1 -and
  $script:table.Names[2][2] -ceq 'Synthetic row 1') 'A cell that kept its value after the restore was reported as restored.'
New-Fixture;$script:sumBiasFromWrite=7
$result=Invoke-Append (New-Rows 3) '99,99'
Assert (-not $result.ok -and $result.resultingState -ceq 'unknown' -and $result.rollback.versucht -and -not $result.rollback.werteWiederhergestellt -and
  $script:table.Names.Count -eq 6) 'A summary that differs after the restore was reported as restored.'
Write-Output 'append: a changed former row, a lost window, an incomplete row, a foreign cell value, a value that stays and a differing summary remain unknown without a blind restore.'
