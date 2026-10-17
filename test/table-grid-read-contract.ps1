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
