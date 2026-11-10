param([string]$ModulePath=(Join-Path $PSScriptRoot '..\powershell\table-grid-read.ps1'))
$ErrorActionPreference='Stop'
Set-StrictMode -Version 2
$worker=Join-Path $PSScriptRoot '..\powershell\sse-worker.ps1'
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($worker,[ref]$tokens,[ref]$errors)
if($errors.Count) {throw 'Worker cannot be parsed.'}
$functions=@($ast.FindAll({param($node)
  $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq 'New-SSETableRowDetails'
},$true))
if($functions.Count -ne 1) {throw 'Expected the actual typed row-details helper.'}
. ([scriptblock]::Create($functions[0].Extent.Text))
. $ModulePath

function Assert($Condition,[string]$Message) {if(-not $Condition) {throw $Message}}
function Same($Actual,$Expected,[string]$Message) {
  if(($Actual | ConvertTo-Json -Depth 25 -Compress) -cne ($Expected | ConvertTo-Json -Depth 25 -Compress)) {throw $Message}
}
function Copy-Scan($Scan) {$Scan | ConvertTo-Json -Depth 25 -Compress | ConvertFrom-Json}
function Project($Scan,[int]$MaxRows=1000) {
  ConvertTo-SSEGridTableProjection $Scan (Copy-Scan $Scan) $MaxRows
}
function Reject($Scan,[string]$Name,[int]$MaxRows=1000) {
  $failed=$false
  try {$null=Project $Scan $MaxRows} catch {$failed=$true}
  Assert $failed ('Malformed Grid observation was accepted: '+$Name)
}
function New-Scan($Matrix,$States,[int]$TotalRows=-1) {
  if($TotalRows -lt 0) {$TotalRows=$Matrix.Count}
  $headers=New-Object System.Collections.ArrayList
  $names=@('Nr.','Datum','Bezeichnung','Betrag','N','','Netto')
  for($column=0;$column -lt 7;$column++) {
    $hidden=$column -eq 5
    $rect=$(if($hidden) {[pscustomobject]@{empty=$true;x=$null;y=$null;width=$null;height=$null}}
      else {[pscustomobject]@{empty=$false;x=[double]($column*100);y=[double]10;width=[double]99;height=[double]20}})
    $null=$headers.Add([pscustomobject]@{column=$column;name=$names[$column];rid=('Header.'+$column);visible=(-not $hidden);rect=$rect})
  }
  $cells=New-Object System.Collections.ArrayList
  for($row=0;$row -lt $Matrix.Count;$row++) {
    for($column=0;$column -lt 7;$column++) {
      $value=[string]$Matrix[$row][$column]
      $semantic=$(if($column -eq 4) {
        $state=[string]$States[$row]
        [pscustomobject]@{ok=$true;type='boolean';value=$(if($state -ceq 'On'){$true}elseif($state -ceq 'Off'){$false}else{$null});checkboxState=$state}
      } else {[pscustomobject]@{ok=$true;type='text';value=$value;checkboxState=$null}})
      $null=$cells.Add([pscustomobject]@{row=$row;column=$column;rid=('Cell.'+$row+'.'+$column);name=$value;semantic=$semantic})
    }
  }
  [pscustomobject]@{rows=$TotalRows;readRows=$Matrix.Count;columns=7;headers=@($headers);cells=@($cells)}
}

# Three equal-looking zero/blank rows are distinct model coordinates. A named
# zero-value business row and the input slot must both survive the projection.
$matrix=@(
  @('','','','0,00','','hidden input metadata','0,00'),
  @('','','Named zero','0,00','','hidden zero metadata','0,00'),
  @('','','Named zero','0,00','','hidden zero metadata','0,00'),
  @('','','','','','',''),
  @('5','03.02','Checked row','4,00','','hidden checked metadata','4,00')
)
$scan=New-Scan $matrix @('Off','Off','Off','Indeterminate','On')
$result=Project $scan
Same $result.kopf @('Nr.','Datum','Bezeichnung','Betrag','N','Netto') 'Hidden raw column was not projected by header geometry.'
Same $result.zeilen @(
  @('','','','0,00','','0,00'),
  @('','','Named zero','0,00','','0,00'),
  @('','','Named zero','0,00','','0,00'),
  @('','','','','',''),
  @('5','03.02','Checked row','4,00','','4,00')
) 'Blank, zero, duplicate or input rows were removed, reordered or altered.'
Same $result.anzahl 5 'Raw row count was filtered.'
Same $result.gridRead.visibleColumns @(0,1,2,3,4,6) 'Visible raw-column identities changed.'
Same $result.gridRead.rowFilter 'none' 'Grid reader claims a business-row filter.'
Same $result.gridRead.inputSlotsIncluded $true 'Input-slot inclusion was lost.'
Same $result.gridRead.consistency 'two-equal-observations' 'Enumeration overclaimed its consistency.'
Same $result.gridRead.atomic $false 'Sequential Grid observations cannot claim atomicity.'
Same $result.vollstaendig $true 'Full Grid dimensions were not recognized.'
Same $result.limitReached $false 'Complete enumeration was incorrectly limited.'
Same $result.stopKind 'end-of-grid' 'Full Grid stop kind differs.'
for($row=0;$row -lt $result.rowDetails.Count;$row++) {
  $detail=$result.rowDetails[$row]
  Same $detail.gridRowIndex $row 'Original raw row identity was lost.'
  Same $detail.rowIndex $row 'Output row index differs.'
  Same $detail.cellTypes @('text','text','text','text','boolean','text') 'Checkbox type or text type differs.'
  Same $detail.semanticsComplete $true 'Typed Grid semantics were marked incomplete.'
  Same $detail.semanticReadErrors @() 'Successful Grid semantics contain errors.'
}
Same $result.rowDetails[0].typedValues @('','','','0,00',$false,'0,00') 'Off checkbox was not false.'
Same $result.rowDetails[3].typedValues @('','','','',$null,'') 'Indeterminate checkbox was not null.'
Same $result.rowDetails[4].typedValues @('5','03.02','Checked row','4,00',$true,'4,00') 'On checkbox was not true.'
Same $result.rowDetails[0].checkboxStates @($null,$null,$null,$null,'Off',$null) 'Off state was lost.'
Same $result.rowDetails[3].checkboxStates @($null,$null,$null,$null,'Indeterminate',$null) 'Indeterminate state was lost.'
Same $result.rowDetails[4].checkboxStates @($null,$null,$null,$null,'On',$null) 'On state was lost.'
$wire=$result | ConvertTo-Json -Depth 25 -Compress | ConvertFrom-Json
Same $wire.zeilen $result.zeilen 'Windows PowerShell JSON changed the nested row arrays.'
foreach($wireRow in $wire.zeilen) {
  Assert ($wireRow -is [array]) 'JSON serialized a row as a value/Count wrapper.'
  foreach($wireCell in $wireRow) {Assert ($wireCell -is [string]) 'JSON row cells must remain strings.'}
}
Assert ($wire.rowDetails[0].typedValues[4] -is [bool] -and -not $wire.rowDetails[0].typedValues[4]) 'JSON changed typed false.'
Assert ($wire.rowDetails[4].typedValues[4] -is [bool] -and $wire.rowDetails[4].typedValues[4]) 'JSON changed typed true.'
Same $wire.rowDetails[3].typedValues[4] $null 'JSON changed typed Indeterminate null.'
Same $wire.rowDetails[3].checkboxStates[4] 'Indeterminate' 'JSON changed the checkbox state tag.'

$largeMatrix=New-Object System.Collections.ArrayList
$largeStates=New-Object System.Collections.ArrayList
$largeExpected=New-Object System.Collections.ArrayList
for($index=0;$index -lt 123;$index++) {
  $name='Independent row '+$index
  $amount=([string]$index)+',00'
  $null=$largeMatrix.Add(@([string]($index+1),'01.03',$name,$amount,'','hidden',$amount))
  $null=$largeStates.Add('Off')
  $null=$largeExpected.Add(@([string]($index+1),'01.03',$name,$amount,'',$amount))
}
$large=New-Scan @($largeMatrix) @($largeStates)
$largeResult=Project $large
Same $largeResult.zeilen @($largeExpected) 'All independently expected rows beyond 99 must be preserved.'
Same $largeResult.anzahl 123 'Large Grid was truncated without a limit.'
$largeWire=$largeResult | ConvertTo-Json -Depth 25 -Compress | ConvertFrom-Json
Same $largeWire.zeilen @($largeExpected) 'Large nested Grid rows changed at the Windows PowerShell JSON boundary.'
$limited=New-Scan @($largeMatrix | Select-Object -First 17) @($largeStates | Select-Object -First 17) 123
$limitedResult=Project $limited 17
Same $limitedResult.zeilen @($largeExpected | Select-Object -First 17) 'maxRows did not apply to raw rows.'
Same $limitedResult.gridRead.readModelRows 17 'Limited raw read count differs.'
Same $limitedResult.gridRead.modelRows 123 'Limited full raw count differs.'
Same $limitedResult.vollstaendig $false 'Limited Grid claimed full enumeration.'
Same $limitedResult.limitReached $true 'Limited Grid did not disclose its limit.'
Same $limitedResult.stopKind 'max-rows' 'Limit stop kind differs.'

# Same dimensions and sum do not authorize altered row contents. The producer
# compares complete observations, not only a count or summary fingerprint.
$second=Copy-Scan $scan
$second.cells[9].name='Changed name with unchanged sum'
$second.cells[9].semantic.value=$second.cells[9].name
$failed=$false
try {$null=ConvertTo-SSEGridTableProjection $scan $second 1000} catch {
  $failed=$true
  Same $_.Exception.Data['SSEGridDifference'] ([pscustomobject]@{category='cell-name';collection='cells';index=9}) 'Safe Grid difference diagnosis was lost.'
  Assert (-not $_.Exception.Message.Contains($second.cells[9].name)) 'Grid diagnostic exposed an observed value.'
}
Assert $failed 'A changed second observation with equal dimensions was accepted.'
$churn=Copy-Scan $scan
foreach($header in $churn.headers) {$header.rid='Fresh.'+$header.rid}
$rejected=$false
try {$null=ConvertTo-SSEGridTableProjection $scan $churn 1000}catch{$rejected=$true}
Assert $rejected 'Cached raw header identities must remain equal across scans.'
foreach($change in @(
  {param($s)$s.headers[0].name='Other header'},
  {param($s)$s.headers[0].column=1},
  {param($s)$s.headers[0].rect.width=98},
  {param($s)$swap=$s.headers[0];$s.headers[0]=$s.headers[1];$s.headers[1]=$swap},
  {param($s)$s.headers[1].rid=$s.headers[0].rid},
  {param($s)$s.headers[0].rid=$s.cells[0].rid},
  {param($s)$s.cells[0].rid='Fresh.Cell.0.0'}
)) {
  $changedChurn=Copy-Scan $scan;& $change $changedChurn;$rejected=$false
  try {$null=ConvertTo-SSEGridTableProjection $scan $changedChurn 1000}catch{$rejected=$true}
  Assert $rejected 'Header logical changes/aliases or cell runtime-id churn were ignored.'
}

$invalid=Copy-Scan $scan;$invalid.cells[1].rid=$invalid.cells[0].rid;Reject $invalid 'aliased cell runtime id'
$invalid=Copy-Scan $scan;$invalid.cells[1].rid=$invalid.headers[0].rid;Reject $invalid 'header-cell runtime-id alias'
$invalid=Copy-Scan $scan;$invalid.cells[1].rid='';Reject $invalid 'missing cell identity'
$invalid=Copy-Scan $scan;$invalid.cells[1].column=0;Reject $invalid 'coordinate repeated'
$invalid=Copy-Scan $scan;$invalid.cells[1].column=2;Reject $invalid 'coordinate gap'
$invalid=Copy-Scan $scan;$invalid.cells[1].row=1;Reject $invalid 'wrong row'
$invalid=Copy-Scan $scan;$invalid.cells[1].column='1';Reject $invalid 'coerced column identity'
$invalid=Copy-Scan $scan;$invalid.cells=@($invalid.cells | Select-Object -Skip 1);Reject $invalid 'missing coordinate'
$invalid=Copy-Scan $scan;$invalid.headers[1].column=0;Reject $invalid 'header column repeated'
$invalid=Copy-Scan $scan;$invalid.headers[1].column=2;Reject $invalid 'header column gap'
$invalid=Copy-Scan $scan;$invalid.headers[1].rid=$invalid.headers[0].rid;Reject $invalid 'header runtime id repeated'
$invalid=Copy-Scan $scan;$invalid.headers[1].rid='';Reject $invalid 'missing header identity'
$invalid=Copy-Scan $scan;$invalid.headers[1].visible=$false;Reject $invalid 'visibility contradicts geometry'
$invalid=Copy-Scan $scan;$invalid.headers[5].visible=$true;Reject $invalid 'hidden geometry exposed'
$invalid=Copy-Scan $scan;$invalid.headers[1].rect.x=[double]::PositiveInfinity;Reject $invalid 'infinite geometry'
$invalid=Copy-Scan $scan;$invalid.headers[1].rect.width='99';Reject $invalid 'coerced geometry'
$invalid=Copy-Scan $scan;$invalid.headers=@($invalid.headers | Select-Object -Skip 1);Reject $invalid 'missing header'
$invalid=Copy-Scan $scan;$invalid.cells[0].semantic.ok=$false;Reject $invalid 'failed semantic read'
$invalid=Copy-Scan $scan;$invalid.cells[0].semantic.type='unknown';Reject $invalid 'unknown cell type'
$invalid=Copy-Scan $scan;$invalid.cells[0].semantic.value='different';Reject $invalid 'text name and typed value differ'
$invalid=Copy-Scan $scan;$invalid.cells[0].semantic.checkboxState='Off';Reject $invalid 'text claims checkbox state'
$invalid=Copy-Scan $scan;$invalid.cells[4].semantic.value='false';Reject $invalid 'checkbox has string false'
$invalid=Copy-Scan $scan;$invalid.cells[4].semantic.value=$true;Reject $invalid 'Off state has true value'
$invalid=Copy-Scan $scan;$invalid.cells[32].semantic.value=$false;Reject $invalid 'On state has false value'
$invalid=Copy-Scan $scan;$invalid.cells[25].semantic.value=$false;Reject $invalid 'Indeterminate state has false value'
$invalid=Copy-Scan $scan;$invalid.cells[4].semantic.checkboxState='unknown';Reject $invalid 'unknown checkbox state'
$invalid=Copy-Scan $scan;$invalid.rows=-1;Reject $invalid 'negative raw rows'
$invalid=Copy-Scan $scan;$invalid.rows='5';Reject $invalid 'coerced raw rows'
$invalid=Copy-Scan $scan;$invalid.readRows=4;Reject $invalid 'read-row dimensions differ'
$invalid=Copy-Scan $scan;$invalid.columns=0;Reject $invalid 'empty raw columns'
Reject $scan 'invalid maxRows' 0
Reject $scan 'oversized maxRows' 1001

# Scan owns live UIA identity/PID/span validation. Projection consumes only the
# resulting scalar observation, so it cannot manufacture those live proofs.
$moduleAst=[Management.Automation.Language.Parser]::ParseFile($ModulePath,[ref]$tokens,[ref]$errors)
if($errors.Count) {throw 'Grid module cannot be parsed.'}
$scanFunctions=@($moduleAst.FindAll({param($node)
  $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq 'Read-SSEGridTableScan'
},$true))
Assert ($scanFunctions.Count -eq 1) 'Exactly one live Grid scan helper is required.'
$scanSource=$scanFunctions[0].Extent.Text
foreach($required in @(
  '[int]$cc.ProcessId -ne $ProcessId',
  '$item.Row -ne $row', '$item.Column -ne $column',
  '$item.RowSpan -ne 1', '$item.ColumnSpan -ne 1',
  '[int]$container.Current.ProcessId -ne $ProcessId',
  "(`$container.GetRuntimeId() -join '.') -cne `$TableRid",
  '[string]$container.Current.AutomationId -cne $TableAid'
)) {Assert ($scanSource.Contains($required)) ('Live Grid scan lost identity guard '+$required)}
Assert ($scanSource -notmatch '\.(SetFocus|Select|SetValue|Invoke|Toggle|Scroll|SetScrollPercent)\(') 'Grid scan invokes an input provider.'

# Exercise the actual scan guard against scalar provider records. These types
# have no UIA/Win32 dependency and cannot attach to any desktop or process.
Add-Type -TypeDefinition @'
namespace Windows.Automation {
 public class GridPattern {
  public static object Pattern=new object();
  public GridInfo Current=new GridInfo();
  public SyntheticElement[,] Cells;
  public int Calls;
  public int ThrowAt=-1;
  public SyntheticElement GetItem(int row,int column) {
   if(Calls++==ThrowAt) throw new System.Exception("synthetic-uia-failure");
   return Cells[row,column];
  }
 }
 public class GridInfo {public int RowCount;public int ColumnCount;}
 public class TablePattern {public static object Pattern=new object();public HeaderInfo Current=new HeaderInfo();}
 public class HeaderInfo {
  public SyntheticElement[] Headers;public int Calls;
  public SyntheticElement[] GetColumnHeaders(){Calls++;throw new System.Exception("Allocating Qt header provider must never be called");}
 }
 public static class ControlType {public static string Header="Header",HeaderItem="HeaderItem",Pane="Pane",DataItem="DataItem",Table="Table",DataGrid="DataGrid";}
 public class TreeWalker {
  public static TreeWalker RawViewWalker=new TreeWalker();public int Calls;
  public SyntheticElement GetFirstChild(SyntheticElement node){Calls++;return node.Children.Length==0 ? null : node.Children[0];}
  public SyntheticElement GetNextSibling(SyntheticElement node){
   Calls++;if(node.NextOverride!=null)return node.NextOverride;
   var children=node.Parent.Children;int index=System.Array.IndexOf(children,node);return index>=0&&index+1<children.Length ? children[index+1] : null;
  }
  public SyntheticElement GetParent(SyntheticElement node){Calls++;return node.Parent;}
 }
 public class GridItemPattern {public static object Pattern=new object();public ItemInfo Current=new ItemInfo();}
 public class ItemInfo {public int Row;public int Column;public int RowSpan=1;public int ColumnSpan=1;public SyntheticElement ContainingGrid;}
 public class TogglePattern {public static object Pattern=new object();public ToggleInfo Current=new ToggleInfo();}
 public class ToggleInfo {public string ToggleState="Off";}
 public class Rect {public bool IsEmpty;public double X;public double Y;public double Width=90;public double Height=20;}
 public class ElementInfo {
  public int ProcessId=17;public string AutomationId="Synthetic.Table";public string Name="";
  public bool IsEnabled=true;public string ControlType="DataItem";public Rect BoundingRectangle=new Rect();
 }
 public class SyntheticElement {
  public ElementInfo Current=new ElementInfo();public int[] Id;
  public SyntheticElement Parent,NextOverride;public SyntheticElement[] Children=new SyntheticElement[0];
  public GridPattern Grid;public TablePattern Table;public GridItemPattern Item;public TogglePattern Toggle;
  public int[] GetRuntimeId(){return Id;}
  public bool TryGetCurrentPattern(object pattern,out object result) {
   result=pattern==GridPattern.Pattern ? (object)Grid : pattern==TablePattern.Pattern ? (object)Table :
    pattern==GridItemPattern.Pattern ? (object)Item : pattern==TogglePattern.Pattern ? (object)Toggle : null;
   return result!=null;
  }
 }
 public static class GridFixture {
  public static SyntheticElement Create(int rows,int columns) {
   var table=new SyntheticElement {Id=new int[]{42,1},Grid=new GridPattern(),Table=new TablePattern()};
   table.Current.ControlType=ControlType.Table;
   table.Grid.Current.RowCount=rows;table.Grid.Current.ColumnCount=columns;
   table.Grid.Cells=new SyntheticElement[rows,columns];
   table.Table.Current.Headers=new SyntheticElement[columns];
   for(int column=0;column<columns;column++) {
    var header=new SyntheticElement {Id=new int[]{42,100+column}};
    header.Current.ControlType=ControlType.HeaderItem;header.Parent=table;
    header.Current.Name="Column "+column;header.Current.BoundingRectangle.X=column*100;
    table.Table.Current.Headers[column]=header;
   }
   for(int row=0;row<rows;row++) for(int column=0;column<columns;column++) {
    var cell=new SyntheticElement {Id=new int[]{42,1000+row*columns+column},Item=new GridItemPattern()};
    cell.Current.Name="Cell "+row+"/"+column;
    cell.Item.Current.Row=row;cell.Item.Current.Column=column;cell.Item.Current.ContainingGrid=table;
    table.Grid.Cells[row,column]=cell;
   }
   var corner=new SyntheticElement {Id=new int[]{42,2},Parent=table};
   corner.Current.ControlType=ControlType.Pane;corner.Current.BoundingRectangle.IsEmpty=true;
   corner.Current.BoundingRectangle.Width=0;corner.Current.BoundingRectangle.Height=0;
   table.Children=new SyntheticElement[columns+1];table.Children[0]=corner;
   for(int column=0;column<columns;column++)table.Children[column+1]=table.Table.Current.Headers[column];
   return table;
  }
 }
}
'@
function Read-SyntheticGrid($Table,[int]$MaxRows=10,[scriptblock]$Guard={$true},[int]$BudgetMs=20000) {
  Read-SSEGridTableScan -Table $Table -ProcessId 17 -TableRid '42.1' -TableAid 'Synthetic.Table' `
    -MaxRows $MaxRows -Guard $Guard -Watch ([Diagnostics.Stopwatch]::StartNew()) -BudgetMs $BudgetMs
}
function Reject-SyntheticGrid($Table,[string]$Name) {
  $failed=$false
  try {$null=Read-SyntheticGrid $Table} catch {$failed=$true}
  Assert $failed ('Live Grid identity guard accepted '+$Name)
}
$provider=[Windows.Automation.GridFixture]::Create(3,3)
$provider.Grid.Cells[1,1].Toggle=New-Object Windows.Automation.TogglePattern
$provider.Grid.Cells[1,1].Toggle.Current.ToggleState='Indeterminate'
$observation=Read-SyntheticGrid $provider
Same $provider.Grid.Calls 9 'Live scanner did not read every raw coordinate exactly once.'
Same $provider.Table.Current.Calls 0 'Live scanner called the allocating Qt header provider.'
Same $observation.cells[4].semantic.type 'boolean' 'Actual scan did not use TogglePattern.'
Same $observation.cells[4].semantic.value $null 'Actual scan lost Indeterminate state.'
Same $observation.cells[4].semantic.checkboxState 'Indeterminate' 'Actual scan changed checkbox state.'
$sameObservation=Read-SyntheticGrid $provider
$actualProjected=ConvertTo-SSEGridTableProjection $observation $sameObservation 10
Same $actualProjected.zeilen @(@('Cell 0/0','Cell 0/1','Cell 0/2'),@('Cell 1/0','Cell 1/1','Cell 1/2'),@('Cell 2/0','Cell 2/1','Cell 2/2')) `
  'Actual consecutive scalar scans did not reach the projection unchanged.'
Same $provider.Table.Current.Calls 0 'Second scan called the allocating Qt header provider.'
$emptyProvider=[Windows.Automation.GridFixture]::Create(0,3)
$emptyOne=Read-SyntheticGrid $emptyProvider;$emptyTwo=Read-SyntheticGrid $emptyProvider
$emptyProjection=ConvertTo-SSEGridTableProjection $emptyOne $emptyTwo 10
Same $emptyProjection.zeilen @() 'Empty Grid could not retain its cached headers without row zero.'
Same $emptyProjection.kopf @('Column 0','Column 1','Column 2') 'Empty Grid header mapping differs.'
Same $emptyProjection.vollstaendig $true 'Zero-row Grid was not complete.'
Same $emptyProvider.Table.Current.Calls 0 'Empty Grid called cellAt(0) through the allocating header provider.'
$hiddenProvider=[Windows.Automation.GridFixture]::Create(1,3)
$hiddenProvider.Table.Current.Headers[1].Current.BoundingRectangle.IsEmpty=$true
$hiddenProvider.Table.Current.Headers[1].Current.BoundingRectangle.Width=0
$hiddenOne=Read-SyntheticGrid $hiddenProvider;$hiddenTwo=Read-SyntheticGrid $hiddenProvider
$hiddenProjection=ConvertTo-SSEGridTableProjection $hiddenOne $hiddenTwo 10
Same $hiddenProjection.kopf @('Column 0','Column 2') 'Actual scan did not project a hidden cached header.'
Same $hiddenProjection.zeilen @(,@('Cell 0/0','Cell 0/2')) 'Actual scan mapped hidden raw column incorrectly.'
$provider=[Windows.Automation.GridFixture]::Create(1,3)
$provider.Children=@($provider.Children | Select-Object -Skip 1)
$noCorner=Read-SyntheticGrid $provider
Same $noCorner.headers.Count 3 'A table without a corner must have exactly its direct headers.'
$provider=[Windows.Automation.GridFixture]::Create(3,3)
$observation=Read-SyntheticGrid $provider 1
Same $provider.Grid.Calls 3 'Raw-row limit was not respected by the actual scanner.'
Same $observation.readRows 1 'Actual scan did not disclose raw-row truncation.'

$provider=[Windows.Automation.GridFixture]::Create(3,3);$provider.Current.ProcessId=99;Reject-SyntheticGrid $provider 'foreign table PID'
$provider=[Windows.Automation.GridFixture]::Create(3,3);$provider.Children[0].Current.ControlType='Button';Reject-SyntheticGrid $provider 'unproved corner button'
$provider=[Windows.Automation.GridFixture]::Create(3,3);$provider.Children[0].Current.Name='Unknown pane';Reject-SyntheticGrid $provider 'named leading pane'
$provider=[Windows.Automation.GridFixture]::Create(3,3);$provider.Children[0].Current.BoundingRectangle.IsEmpty=$false;Reject-SyntheticGrid $provider 'nonempty leading pane'
$provider=[Windows.Automation.GridFixture]::Create(3,3);$provider.Children[0].NextOverride=$provider.Children[0];Reject-SyntheticGrid $provider 'corner sibling cycle'
$provider=[Windows.Automation.GridFixture]::Create(3,3);$provider.Table.Current.Headers[1].Current.ControlType='Custom';Reject-SyntheticGrid $provider 'unknown raw header'
$provider=[Windows.Automation.GridFixture]::Create(3,3);$provider.Table.Current.Headers[1].Id=$provider.Table.Current.Headers[0].Id;Reject-SyntheticGrid $provider 'aliased raw header'
$provider=[Windows.Automation.GridFixture]::Create(3,3);$provider.Table.Current.Headers[0].Id=$provider.Id;Reject-SyntheticGrid $provider 'table-header alias'
$provider=[Windows.Automation.GridFixture]::Create(3,3);$provider.Children=@($provider.Children | Select-Object -First 3);Reject-SyntheticGrid $provider 'missing raw header'
$provider=[Windows.Automation.GridFixture]::Create(3,3);$provider.Table.Current.Headers[0].Parent=[Windows.Automation.GridFixture]::Create(1,1)
$provider.Table.Current.Headers[0].Parent.Id=@(42,99);Reject-SyntheticGrid $provider 'foreign raw-header parent'
$provider=[Windows.Automation.GridFixture]::Create(3,3);$provider.Grid.Cells[0,0].Id=$provider.Children[0].Id;Reject-SyntheticGrid $provider 'corner-cell alias'
$provider=[Windows.Automation.GridFixture]::Create(3,3);$provider.Table.Current.Headers[0].Current.ProcessId=99;Reject-SyntheticGrid $provider 'foreign header PID'
$provider=[Windows.Automation.GridFixture]::Create(3,3);$provider.Grid.Cells[0,0].Current.ProcessId=99;Reject-SyntheticGrid $provider 'foreign cell PID'
$provider=[Windows.Automation.GridFixture]::Create(3,3);$provider.Grid.Cells[0,0].Item.Current.RowSpan=2;Reject-SyntheticGrid $provider 'row span'
$provider=[Windows.Automation.GridFixture]::Create(3,3);$provider.Grid.Cells[0,0].Item.Current.ColumnSpan=2;Reject-SyntheticGrid $provider 'column span'
$provider=[Windows.Automation.GridFixture]::Create(3,3);$provider.Grid.Cells[0,0].Item.Current.Row=1;Reject-SyntheticGrid $provider 'wrong GridItem row'
$provider=[Windows.Automation.GridFixture]::Create(3,3);$provider.Grid.Cells[0,0].Item.Current.Column=1;Reject-SyntheticGrid $provider 'wrong GridItem column'
$provider=[Windows.Automation.GridFixture]::Create(3,3);$provider.Grid.Cells[0,1].Id=$provider.Grid.Cells[0,0].Id;Reject-SyntheticGrid $provider 'cell runtime-id alias'
$provider=[Windows.Automation.GridFixture]::Create(3,3);$provider.Grid.Cells[0,0].Item=$null;Reject-SyntheticGrid $provider 'missing GridItem pattern'
$provider=[Windows.Automation.GridFixture]::Create(3,3);$foreign=[Windows.Automation.GridFixture]::Create(1,1)
$foreign.Current.ProcessId=99;$provider.Grid.Cells[0,0].Item.Current.ContainingGrid=$foreign;Reject-SyntheticGrid $provider 'foreign containing Grid PID'
$provider=[Windows.Automation.GridFixture]::Create(3,3);$foreign=[Windows.Automation.GridFixture]::Create(1,1)
$foreign.Id=@(42,99);$provider.Grid.Cells[0,0].Item.Current.ContainingGrid=$foreign;Reject-SyntheticGrid $provider 'foreign containing Grid RID'
$provider=[Windows.Automation.GridFixture]::Create(3,3);$foreign=[Windows.Automation.GridFixture]::Create(1,1)
$foreign.Current.AutomationId='Other.Table';$provider.Grid.Cells[0,0].Item.Current.ContainingGrid=$foreign;Reject-SyntheticGrid $provider 'foreign containing Grid AID'
$provider=[Windows.Automation.GridFixture]::Create(3,3);$provider.Grid.ThrowAt=0
Reject-SyntheticGrid $provider 'provider failure'
Same $provider.Grid.Calls 1 'A failed UIA provider must end the scan without further coordinate reads.'
$provider=[Windows.Automation.GridFixture]::Create(3,3);$failed=$false
try {$null=Read-SyntheticGrid $provider 10 {$false}} catch {$failed=$true}
Assert $failed 'Changed window/input guard was accepted.'
Same $provider.Grid.Calls 0 'Grid was read after the window/input guard failed.'
$provider=[Windows.Automation.GridFixture]::Create(3,3);$failed=$false
try {$null=Read-SyntheticGrid $provider 10 {$true} 0} catch {$failed=$true}
Assert $failed 'Expired deadline was accepted.'
Same $provider.Grid.Calls 0 'Grid was read after the deadline expired.'
Write-Host 'Read-only Grid projection: raw zero/blank/duplicate rows, 123 rows, limits, typed states, exact coordinates and malformed observations passed.'

function Model($Scan,[int]$Limit=1000){ConvertTo-SSEGridLogicalModel $Scan (Copy-Scan $Scan) $Limit 7 'Synthetic.Table'}
$rows=@(
 @('','01.01','Duplicate','0,00','','Hidden alpha','0,00'),
 @('','02.01','Duplicate','0,00','','Hidden beta','0,00'),
 @('','','','','','','')
)
$beforeScan=New-Scan $rows @('Off','Off','Off');$before=Model $beforeScan
$afterScan=New-Scan @($rows[0],$rows[2]) @('Off','Off');$after=Model $afterScan
Same (Get-SSEGridDeleteOutcome $before $after 1) 'deleted-exact' 'A zero-amount duplicate deletion was not identified by complete model difference.'
Same (Get-SSEGridDeleteOutcome $before (Model $beforeScan) 1) 'unchanged' 'An ineffective deletion was not identified as unchanged.'
Assert ($after.key -cne $before.key) 'An ineffective undo was accepted as restoration merely because a duplicate and zero sum remain.'
Same (Get-SSEGridDeleteOutcome $before (Model (New-Scan @($rows[1],$rows[2]) @('Off','Off'))) 1) 'unexpected' 'The wrong duplicate row was accepted.'
Same (Get-SSEGridDeleteOutcome $before (Model (New-Scan (,$rows[2]) @('Off'))) 1) 'unexpected' 'Two removed rows were accepted.'
$more=New-Scan @($rows[0],$rows[1],$rows[2],@('','03.01','Other','1,00','','Hidden other','1,00')) @('Off','Off','Off','Off')
Same (Get-SSEGridDeleteOutcome $before (Model $more) 1) 'unexpected' 'An added row was accepted.'
$changed=Copy-Scan $afterScan;$changed.cells[4].semantic.checkboxState='On';$changed.cells[4].semantic.value=$true
Same (Get-SSEGridDeleteOutcome $before (Model $changed) 1) 'unexpected' 'An untouched checkbox change was accepted.'
$hidden=Copy-Scan $afterScan;$hidden.cells[5].name='Changed hidden value';$hidden.cells[5].semantic.value='Changed hidden value'
Same (Get-SSEGridDeleteOutcome $before (Model $hidden) 1) 'unexpected' 'An untouched hidden-column change was accepted.'
$headers=Copy-Scan $afterScan;$headers.headers[1].name='Changed header'
Same (Get-SSEGridDeleteOutcome $before (Model $headers) 1) 'unexpected' 'Changed table structure was accepted.'
$visibility=Copy-Scan $afterScan;$visibility.headers[5].visible=$true;$visibility.headers[5].rect=[pscustomobject]@{empty=$false;x=500.0;y=10.0;width=99.0;height=20.0}
Same (Get-SSEGridDeleteOutcome $before (Model $visibility) 1) 'unexpected' 'Changed hidden-column visibility was accepted.'
$rebuilt=Copy-Scan $beforeScan
foreach($header in $rebuilt.headers){$header.rid='Rebuilt.Header.'+$header.column;if($header.visible){$header.rect.x+=50;$header.rect.y+=20}}
foreach($cell in $rebuilt.cells){$cell.rid='Rebuilt.Cell.'+$cell.row+'.'+$cell.column}
Same (Model $rebuilt).key $before.key 'RIDs or layout were incorrectly treated as business data.'
Same (Get-SSEGridDeleteOutcome $before (Model $rebuilt) 1) 'unchanged' 'A completely restored model with fresh IDs was rejected.'
$reordered=New-Scan @($rows[1],$rows[0],$rows[2]) @('Off','Off','Off')
Same (Get-SSEGridDeleteOutcome $before (Model $reordered) 1) 'unexpected' 'Restoration at the wrong row position was accepted.'
$twins=Model (New-Scan @($rows[0],$rows[0],$rows[2]) @('Off','Off','Off'))
Assert (-not (Test-SSEGridRowUnique $twins 1)) 'Fully indistinguishable exposed rows were granted target authority.'
Same (Get-SSEGridDeleteOutcome $twins $after 1) 'unexpected' 'An indistinguishable target was accepted without row uniqueness.'
$coordinate=Resolve-SSEGridCellCoordinate $beforeScan 'Cell.1.2'
Same $coordinate ([pscustomobject]@{row=1;column=2;name='Duplicate'}) 'Fresh RID did not retain exact model coordinates.'
Assert ($null -eq (Resolve-SSEGridCellCoordinate $beforeScan 'Missing.Rid')) 'A missing RID received coordinates.'
$incomplete=New-Scan $rows @('Off','Off','Off') 5;$refused=$false
try{$null=Model $incomplete 3}catch{$refused=$true}
Assert $refused 'A partial exposed model was accepted as complete.'
Same (Get-SSEGridDeleteOutcome $before $before -1) 'unexpected' 'An invalid target row was accepted as a known unchanged outcome.'
$tampered=Copy-Scan $before;$tampered.rowKeys[0]='Tampered key'
Same (Get-SSEGridDeleteOutcome $before $tampered 1) 'unexpected' 'A stale cached model key hid changed row data.'
$largeRows=@(for($index=0;$index -lt 200;$index++){,@([string]$index,'01.01',('Row '+$index),'1,00','',('Hidden '+$index),'1,00')})
$largeStates=@(for($index=0;$index -lt 200;$index++){'Off'})
$remaining=@(for($index=0;$index -lt 200;$index++){if($index -ne 150){,$largeRows[$index]}})
$remainingStates=@(for($index=0;$index -lt 199;$index++){'Off'})
Same (Get-SSEGridDeleteOutcome (Model (New-Scan $largeRows $largeStates)) (Model (New-Scan $remaining $remainingStates)) 150) 'deleted-exact' 'A virtualized model row was confused with visible rank.'
Write-Output 'Logical Grid delete policy: complete observed rows, zero values, hidden data, restoration and model coordinates passed.'

# Exercise the actual table_read entry snapshot, not a replacement dispatcher.
# The existing strict ClientFrame resolver owns its live root/ancestry proof;
# this scalar fixture supplies its result or its fail-closed null result.
# All window geometry below is managed fake data, without native imports.
Add-Type -TypeDefinition @'
public static class SW {
 public struct RC {public int L,T,R,B;}
 public static bool GetWindowRect(System.IntPtr hwnd,ref RC rect) {
  rect.L=0;rect.T=0;rect.R=1000;rect.B=700;return true;
 }
}
'@
foreach($helper in @('Get-ContentBounds','LiesZeilen','Test-SSEGridContentBinding')) {
  $definitions=@($ast.FindAll({param($node)
    $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $helper
  },$true))
  Assert ($definitions.Count -eq 1) ('Expected exactly one actual scope consumer: '+$helper)
  . ([scriptblock]::Create($definitions[0].Extent.Text))
}
$comboAst=[Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot '..\powershell\table-combobox.ps1'),[ref]$tokens,[ref]$errors)
Assert ($errors.Count -eq 0) 'Table input-state module cannot be parsed.'
$inputState=@($comboAst.FindAll({param($node)
  $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq 'Get-SSETableSnapshotInputState'
},$true))
Assert ($inputState.Count -eq 1) 'The actual table input-state proof is missing.'
. ([scriptblock]::Create($inputState[0].Extent.Text))
function New-FormReadFixture {
  $aid='Synthetic.RedThreadContent.ClientFrameSSE.Table'
  $nodes=@(
    [pscustomobject]@{i=0;p=-1;type='Table';name='';aid=$aid;rid='Form.0';on=$true;x=70;y=40;w=400;h=150},
    [pscustomobject]@{i=1;p=0;type='Header';name='Nr.';aid=$aid;rid='Form.1';on=$true;x=80;y=50;w=100;h=20},
    [pscustomobject]@{i=2;p=0;type='Header';name='Betrag';aid=$aid;rid='Form.2';on=$true;x=180;y=50;w=100;h=20},
    [pscustomobject]@{i=3;p=0;type='DataItem';name='1';aid=$aid;rid='Form.3';on=$true;x=80;y=80;w=100;h=20},
    [pscustomobject]@{i=4;p=0;type='DataItem';name='3,00';aid=$aid;rid='Form.4';on=$true;x=180;y=80;w=100;h=20}
  )
  [pscustomobject]@{nodes=$nodes;contentBounds=[pscustomobject]@{minX=60;maxX=480};
    stats=[pscustomobject]@{truncated=$false;depthLimited=$false;err=0;cyc=0;valErr=0}}
}
function Invoke-FormReadFixture([bool]$Grid,$Form,[int]$NavigationCycles=1) {
  $gridRequested=$Grid;$sumLabel='Gesamt';$sumOccurrence=1
  $latestTableSnapshot=[pscustomobject]@{tree=$null}
  $script:formScopeReads=0;$script:fullScopeReads=0;$script:scopeFailure=$null
  $full=New-FormReadFixture
  $full.PSObject.Properties.Remove('contentBounds')
  $full.stats.cyc=$NavigationCycles
  $full.nodes+= [pscustomobject]@{i=5;p=5;type='Tree';name='';aid='Synthetic.Nav';rid='Nav.1';on=$true;x=-60;y=20;w=130;h=500}
  function Get-SSEMainContentTree {
    param($Window,$MaxNodes,[switch]$WithValues)
    Assert ($Window -eq [IntPtr]4242 -and $MaxNodes -eq 4000 -and $WithValues) 'Grid did not request the exact valued form snapshot.'
    $script:formScopeReads++
    $Form
  }
  function Walk-BoundTree {
    param($Window,[switch]$WithValues)
    Assert ($Window -eq [IntPtr]4242 -and $WithValues) 'The existing cursor snapshot arguments changed.'
    $script:fullScopeReads++
    $full
  }
  function Get-CurrentHeading {param($Window,$Tree) 'Synthetic page'}
  function Read-LabeledValueFromTree {
    param($Tree,$Window,$Label,$Occurrence)
    [pscustomobject]@{selected=[pscustomobject]@{aid='Synthetic.Form.Sum';rid='Form.Sum'};value='3,00';candidateCount=1}
  }
  function Get-SSETableRegion {
    param($Tree,$Window,$Summary)
    [pscustomobject]@{ok=$true;cells=@($Tree.nodes | Where-Object {$_.type -ceq 'DataItem'});
      previousSummaryY=$null;targetSumY=160;scopePrefix='Synthetic.Form';selectionMethod='synthetic-bound-summary'}
  }
  function Get-SSETextSha256 {param($Text) 'synthetic-content-hash'}
  function Read-SSETableCellSemantic {param($Cell) [pscustomobject]@{type='text';value=$Cell.name}}
  function Fail {param($Message,$Kind) $script:scopeFailure=$Kind;throw 'scope-read-failed'}
  $snapshot=$null
  try {$snapshot=LiesZeilen ([IntPtr]4242)} catch {
    Assert ($_.Exception.Message -ceq 'scope-read-failed') ('Unexpected scope-consumer error: '+$_.Exception.Message)
  }
  [pscustomobject]@{snapshot=$snapshot;formReads=$script:formScopeReads;fullReads=$script:fullScopeReads;failure=$script:scopeFailure}
}
$formRead=Invoke-FormReadFixture $true (New-FormReadFixture)
Assert ($formRead.snapshot.navigationBinding.complete -and $formRead.snapshot.navigationBinding.editorFree -and
  $formRead.formReads -eq 1 -and $formRead.fullReads -eq 0 -and $formRead.snapshot.zeilen.Count -eq 1) `
  'A complete form beside cyclic navigation did not remain readable without a global walk.'
Same $formRead.snapshot.kopf @('Nr.','Betrag') 'Scoped header geometry was replaced by window fractions.'
Same $formRead.snapshot.zeilen @(,@('1','3,00')) 'Scoped cells were dropped by window fractions.'
foreach($scenario in @('foreign-or-missing-root','missing-bounds','null-bounds','invalid-bounds','missing-stats','cycle','error','value-error','truncated','depth-limited')) {
  $form=New-FormReadFixture
  switch($scenario) {
    'foreign-or-missing-root' {$form=$null}
    'missing-bounds' {$form.PSObject.Properties.Remove('contentBounds')}
    'null-bounds' {$form.contentBounds=$null}
    'invalid-bounds' {$form.contentBounds.maxX=[double]::NaN}
    'missing-stats' {$form.stats=$null}
    'cycle' {$form.stats.cyc=1}
    'error' {$form.stats.err=1}
    'value-error' {$form.stats.valErr=1}
    'truncated' {$form.stats.truncated=$true}
    'depth-limited' {$form.stats.depthLimited=$true}
  }
  $refused=Invoke-FormReadFixture $true $form
  Assert ($null -eq $refused.snapshot -and $refused.failure -ceq 'precondition-failed' -and
    $refused.formReads -eq 1 -and $refused.fullReads -eq 0) ('Grid scope failed open or used a global fallback: '+$scenario)
}
$cursor=Invoke-FormReadFixture $false (New-FormReadFixture) 0
Assert ($cursor.fullReads -eq 1 -and $cursor.formReads -eq 0 -and $cursor.snapshot.navigationBinding.complete) `
  'The existing full-window cursor snapshot was changed.'
$cyclicCursor=Invoke-FormReadFixture $false (New-FormReadFixture) 1
Assert ($cyclicCursor.fullReads -eq 1 -and $cyclicCursor.formReads -eq 0 -and -not $cyclicCursor.snapshot.navigationBinding.complete) `
  'The existing cursor completeness guard no longer rejects a global cycle.'
Write-Output 'Grid entry scope: exact valued form, adjacent navigation cycle excluded, local failures closed, cursor scope unchanged.'

# The unchanged combined guard reports only booleans/counts and an allowlisted
# editor-state category. Dirty=false is readable and must never be mistaken
# for a missing dirty-state observation.
$guardNodes=@($ast.FindAll({param($node)
  $node -is [Management.Automation.Language.IfStatementAst] -and
  $node.Clauses[0].Item1.Extent.Text.StartsWith('$null -eq $inputBefore -or $null -eq $dirtyBefore',[StringComparison]::Ordinal) -and
  $node.Extent.Text.Contains('Read-only Grid requires one exact, editor-free and unobstructed table.')
},$true))
Assert ($guardNodes.Count -eq 1) 'The combined Grid precondition is not unique.'
$gridPrecondition=[scriptblock]::Create($guardNodes[0].Extent.Text)
function Invoke-GridPreconditionFixture([string]$Scenario) {
  $inputBefore=19;$dirtyBefore=$false
  $erst=[pscustomobject]@{tabelleAnzahl=1;navigationBinding=[pscustomobject]@{complete=$true;editorFree=$true};
    tableRoot=[pscustomobject]@{rid='SYNTHETIC-IDENTITY-MUST-NOT-APPEAR'};editorStateReason='complete-bound-table-without-editor'}
  $windowsBefore=[pscustomobject]@{windows=@([pscustomobject]@{role='main';title='SYNTHETIC-VALUE-MUST-NOT-APPEAR'})}
  switch($Scenario) {
    'input' {$inputBefore=$null}
    'dirty' {$dirtyBefore=$null}
    'table-count' {$erst.tabelleAnzahl=2}
    'incomplete' {$erst.navigationBinding.complete=$false}
    'editor' {$erst.navigationBinding.editorFree=$false;$erst.editorStateReason='active-table-editor'}
    'root' {$erst.tableRoot=$null}
    'windows' {$windowsBefore.windows+=@([pscustomobject]@{role='other';title='SYNTHETIC-VALUE-MUST-NOT-APPEAR'},[pscustomobject]@{role='other';title='SYNTHETIC-VALUE-MUST-NOT-APPEAR'})}
  }
  $script:gridGuardFailure=$null
  function Fail {param($Message,$Kind) $script:gridGuardFailure=[pscustomobject]@{message=$Message;kind=$Kind};throw 'grid-precondition-failed'}
  try {. $gridPrecondition} catch {Assert ($_.Exception.Message -ceq 'grid-precondition-failed') 'Unexpected diagnostic guard exception.'}
  $script:gridGuardFailure
}
Assert ($null -eq (Invoke-GridPreconditionFixture 'valid')) 'A valid table with dirty=false no longer passes its original guard.'
foreach($case in @(
  @('input','inputReadable=False'),@('dirty','dirtyReadable=False'),@('table-count','tableCount=2'),
  @('incomplete','complete=False'),@('editor','editorFree=False'),@('root','tableRootBound=False'),@('windows','blockingWindowCount=2')
)) {
  $failure=Invoke-GridPreconditionFixture $case[0]
  Assert ($failure.kind -ceq 'precondition-failed' -and $failure.message.Contains($case[1])) ('Grid failure predicate is missing: '+$case[0])
  Assert ($failure.message -cmatch '\(inputReadable=(True|False); dirtyReadable=(True|False); tableCount=[0-9]+; complete=(True|False); editorFree=(True|False); tableRootBound=(True|False); blockingWindowCount=[0-9]+; editorStateReason=[a-z-]+\)$') `
    'Grid precondition diagnosis contains fields other than safe booleans/counts/category.'
  Assert (-not $failure.message.Contains('SYNTHETIC-')) 'Grid precondition diagnosis exposed observed identity or value.'
}
$editorForm=New-FormReadFixture
$editorForm.nodes+=[pscustomobject]@{i=5;p=0;type='Edit';name='SYNTHETIC-EDITOR-VALUE-MUST-NOT-APPEAR';aid='Synthetic.Table.Editor';rid='Form.5';on=$true;x=80;y=80;w=100;h=20}
$editorRead=Invoke-FormReadFixture $true $editorForm
Assert (-not $editorRead.snapshot.navigationBinding.editorFree -and $editorRead.snapshot.editorStateReason -ceq 'active-table-editor') `
  'The internal editor-state category was not preserved from the actual input-state proof.'
Write-Output 'Grid precondition diagnosis: every negative predicate, readable clean state, safe categories and no observed identities/values.'

$rebindNodes=@($ast.FindAll({param($node)
  $node -is [Management.Automation.Language.IfStatementAst] -and
  $node.Clauses[0].Item1.Extent.Text -ceq '-not $resolved.ok' -and
  $node.Extent.Text.Contains('Exact fresh Grid table could not be rebound.')
},$true))
Assert ($rebindNodes.Count -eq 1) 'The actual Grid rebind failure guard is not unique.'
$gridRebindGuard=[scriptblock]::Create($rebindNodes[0].Extent.Text)
function Invoke-GridRebindGuardFixture([bool]$Ok,$Reason) {
  $resolved=[pscustomobject]@{ok=$Ok;reason=$Reason;element='SYNTHETIC-IDENTITY-MUST-NOT-APPEAR'}
  try {. $gridRebindGuard} catch {return $_.Exception.Message}
  $null
}
foreach($reason in @('fresh-grid-walk-cycle','fresh-grid-walk-limited','fresh-grid-walk-depth','fresh-grid-walk-error','fresh-grid-element-unbound','fresh-grid-root-unbound')) {
  Same (Invoke-GridRebindGuardFixture $false $reason) ('Exact fresh Grid table could not be rebound. (reason='+$reason+')') `
    'Known raw rebind failure category was lost.'
}
foreach($unknown in @($null,'fresh-exact-grid-table','fresh-focus-walk-cycle','FRESH-GRID-WALK-CYCLE','SYNTHETIC-VALUE-MUST-NOT-APPEAR')) {
  Same (Invoke-GridRebindGuardFixture $false $unknown) 'Exact fresh Grid table could not be rebound. (reason=unavailable)' `
    'Unrecognized raw rebind reason exposed unbounded provider text.'
}
Assert ($null -eq (Invoke-GridRebindGuardFixture $true 'fresh-exact-focus-element')) 'The original successful rebind guard changed.'
Write-Output 'Grid rebind diagnosis: fixed raw failure categories, unknown text withheld, successful guard unchanged.'

$binding=[pscustomobject]@{hwnd=[long]4242;pid=123;windowRid='Window.1';windowAid='Synthetic';rid='Form.1';
  aid='Synthetic.Form';type='Group';rect=@(60.0,40.0,420.0,300.0)}
Assert (Test-SSEGridContentBinding $binding (Copy-Scan $binding)) 'Equal scalar form bindings were rejected.'
foreach($field in @('hwnd','pid','windowRid','windowAid','rid','aid','type','rect')) {
  $changed=Copy-Scan $binding
  if($field -ceq 'rect'){$changed.rect[0]+=0.25}else{$changed.$field='changed'}
  Assert (-not (Test-SSEGridContentBinding $binding $changed)) ('Grid form drift was ignored: '+$field)
}
Assert (-not (Test-SSEGridContentBinding $binding $null)) 'A missing final form binding was accepted.'
$gridCalls=@($ast.FindAll({param($node)
  $node -is [Management.Automation.Language.AssignmentStatementAst] -and $node.Left.Extent.Text -ceq '$resolved' -and
  $node.Right.Extent.Text.StartsWith('Get-SSEGridReadUncachedTable ',[StringComparison]::Ordinal)
},$true))
Assert ($gridCalls.Count -eq 1) 'Grid lost its dedicated scoped raw bridge.'
$finalRootChecks=@($ast.FindAll({param($node)
  $node -is [Management.Automation.Language.CommandAst] -and $node.GetCommandName() -ceq 'Test-SSEGridContentBinding'
},$true))
Assert ($finalRootChecks.Count -eq 1) 'Grid did not compare its fresh form binding after both scans.'
$unknownEditor=New-FormReadFixture
$unknownEditor.nodes+=[pscustomobject]@{i=5;p=0;type='Custom';name='';aid='Synthetic.Table.Unknown';rid='Form.5';on=$true;x=80;y=80;w=100;h=20}
$unknownRead=Invoke-FormReadFixture $true $unknownEditor
Assert (-not $unknownRead.snapshot.navigationBinding.editorFree) 'The new scoped resolver relaxed the unknown table-editor guard.'
Write-Output 'Grid scalar root binding: stable across observations, identity/subpixel drift rejected, dedicated bridge, unknown editor still blocked.'
