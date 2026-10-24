$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../powershell/load-native.ps1')
$source=[IO.File]::ReadAllText((Join-Path $PSScriptRoot '../powershell/sse-native.cs'))
$contract=@'
public static class MsaaDocumentContract {
  sealed class Node {
    public int Id, CountReads;
    public object Focus=(int)0, Hit=(int)0;
    public object[] Children = new object[0];
    public Node(int id) { Id=id; }
  }
  sealed class Source : SSEAccessible.IDocumentSource {
    public Node Root=new Node(1);
    public bool ThrowRead, ThrowChildren, ShortChildren, ChangeCount;
    public int SleepMs, ChildrenSleepMs;
    public bool ThrowIdentity, ThrowFinalCount, NegativeCount;
    public System.Collections.Generic.List<int> Batches=new System.Collections.Generic.List<int>();
    public object GetRoot(long hwnd) { return Root; }
    public int GetChildCount(object obj) {
      var node=(Node)obj; node.CountReads++;
      if(ThrowFinalCount&&node.CountReads>1)throw new System.InvalidOperationException("final count failed");
      if(NegativeCount)return -1;
      return node.Children.Length + (ChangeCount && node.CountReads>1 ? 1 : 0);
    }
    public SSEAccDocumentNode Read(object obj,int childId) {
      if(ThrowRead) throw new System.InvalidOperationException("read failed");
      if(SleepMs>0)System.Threading.Thread.Sleep(SleepMs);
      return new SSEAccDocumentNode {
        Name=childId==0 ? "root" : "text "+childId,
        Role=childId==0 ? 15 : 41,
        ChildCount=childId==0 ? GetChildCount(obj) : 0
      };
    }
    public object[] ReadChildren(object obj,int start,int count) {
      if(ThrowChildren)throw new System.InvalidOperationException("children failed");
      if(ChildrenSleepMs>0)System.Threading.Thread.Sleep(ChildrenSleepMs);
      Batches.Add(count);
      var values=new object[ShortChildren ? count-1 : count];
      System.Array.Copy(((Node)obj).Children,start,values,0,values.Length);
      return values;
    }
    public string Identity(object obj) { if(ThrowIdentity)throw new System.InvalidOperationException("identity failed");return ((Node)obj).Id.ToString(); }
    public object Focus(object obj) { return ((Node)obj).Focus; }
    public object Hit(object obj,int x,int y) { return ((Node)obj).Hit; }
  }
  static void Assert(bool condition,string message) { if(!condition)throw new System.Exception(message); }
  static Source TwoLeaves() { var s=new Source();s.Root.Children=new object[] {1,2};return s; }
  static bool Complete(SSEAccDocumentSnapshot r) { return r.Errors==0&&r.CycleHits==0&&!r.Truncated&&!r.DepthLimited; }
  static SSEAccDocumentSnapshot Run(Source s,int nodes=100,int ms=1000,int depth=24) {
    return SSEAccessible.DescribeDocumentCore(s,1,nodes,ms,depth);
  }
  public static void Check() {
    var r=Run(TwoLeaves(),3);
    Assert(Complete(r)&&r.Nodes.Length==3,"Exact node budget rejected a complete tree.");
    Assert(r.Nodes[1].ParentIndex==0&&r.Nodes[2].ParentIndex==0&&r.Nodes[2].Path[0]==1&&r.Nodes[2].Name=="text 2",
      "Simple child IDs or ordered parent/path binding were lost.");
    r=Run(TwoLeaves(),2);Assert(r.Truncated&&!Complete(r),"Node truncation became complete.");
    r=Run(TwoLeaves(),100,1000,0);Assert(r.DepthLimited&&!Complete(r),"Depth truncation became complete.");
    var s=TwoLeaves();s.SleepMs=10;r=Run(s,100,1);Assert(r.Truncated&&!Complete(r),"A provider call over the time budget became complete.");
    s=TwoLeaves();s.ThrowRead=true;r=Run(s);Assert(r.Errors==1&&!Complete(r),"Failed properties became empty successful data.");
    s=TwoLeaves();s.ThrowChildren=true;r=Run(s);Assert(r.Errors==1&&!Complete(r),"Failed children became a complete empty tree.");
    s=TwoLeaves();s.ShortChildren=true;r=Run(s);Assert(r.Errors==1&&!Complete(r),"A short child batch became complete.");
    s=TwoLeaves();s.ChangeCount=true;r=Run(s);Assert(r.Errors==1&&!Complete(r),"An inventory change during the read was accepted.");
    s=TwoLeaves();s.Root.Children=new object[] {s.Root};r=Run(s);Assert(r.CycleHits==1&&!Complete(r),"Object cycle was accepted.");
    s=TwoLeaves();s.Root.Children=new object[] {1,1};r=Run(s);Assert(r.CycleHits==1&&!Complete(r),"Repeated simple child identity was accepted.");
    s=TwoLeaves();s.Root.Children=new object[] {0};r=Run(s);Assert(r.Errors==1&&!Complete(r),"A zero child ID replayed the parent.");
    s=TwoLeaves();s.Root.Children=new object[] {null};r=Run(s);Assert(r.Errors==1&&!Complete(r),"A missing child was ignored.");
    s=TwoLeaves();s.Root=null;r=Run(s);Assert(r.Errors==1&&!Complete(r),"A missing root was accepted.");
    s=TwoLeaves();s.Root.Children=new object[70];for(int i=0;i<70;i++)s.Root.Children[i]=i+1;
    r=Run(s);Assert(Complete(r)&&r.Nodes.Length==71&&s.Batches.Count==3&&s.Batches[0]==32&&s.Batches[1]==32&&s.Batches[2]==6,
      "Child reads were not bounded, ordered batches.");
    bool rejected=false;try{Run(TwoLeaves(),0);}catch(System.ArgumentOutOfRangeException){rejected=true;}
    Assert(rejected,"An invalid node budget was accepted.");
    s=TwoLeaves();var branch=new Node(2);branch.Children=new object[] {1,2};var sibling=new Node(3);
    s.Root.Children=new object[] {branch,sibling};
    r=Run(s,5);Assert(Complete(r)&&r.Nodes.Length==5&&r.Nodes[2].ParentIndex==1&&r.Nodes[2].Depth==2&&
      r.Nodes[2].Path[0]==0&&r.Nodes[2].Path[1]==0&&r.Nodes[4].ParentIndex==0&&r.Nodes[4].Path[0]==1,
      "Nested object parents, depth, order or paths changed.");
    s=TwoLeaves();branch=new Node(2);branch.Children=new object[] {1,2};s.Root.Children=new object[] {branch,new Node(3)};
    r=Run(s,4);Assert(r.Truncated&&r.Nodes.Length==4&&!Complete(r),"Descendants exhausted the budget without reporting truncation.");
    s=TwoLeaves();s.ChildrenSleepMs=10;r=Run(s,100,1);Assert(r.Truncated&&!Complete(r),"A slow child batch became complete.");
    s=TwoLeaves();s.ThrowIdentity=true;r=Run(s);Assert(r.Errors==1&&!Complete(r),"A failed identity was accepted.");
    s=TwoLeaves();s.ThrowFinalCount=true;r=Run(s);Assert(r.Errors==1&&!Complete(r),"A failed final count was accepted.");
    s=TwoLeaves();s.NegativeCount=true;r=Run(s);Assert(r.Errors==1&&!Complete(r),"A negative child count was accepted.");
    s=TwoLeaves();s.Root.Children=new object[] {"invalid accessible child"};r=Run(s);Assert(r.Errors==1&&!Complete(r),"An invalid child became complete.");
    s=TwoLeaves();var target=new Node(5);s.Root.Focus=target;s.Root.Hit=target;
    Assert(SSEAccessible.ResolveDocumentTargetCore(s,1,true,0,0).Role==15,"Focused object chain did not resolve.");
    target.Hit=(int)3;
    Assert(SSEAccessible.ResolveDocumentTargetCore(s,1,false,10,20).Name=="text 3","Hit-test simple child did not resolve.");
    s.Root.Focus=null;Assert(SSEAccessible.ResolveDocumentTargetCore(s,1,true,0,0)==null,"Missing focus became a target.");
    s.Root.Focus=s.Root;rejected=false;
    try{SSEAccessible.ResolveDocumentTargetCore(s,1,true,0,0);}catch(System.InvalidOperationException){rejected=true;}
    Assert(rejected,"A focus cycle was accepted.");
    s.Root.Hit=(int)(-1);rejected=false;
    try{SSEAccessible.ResolveDocumentTargetCore(s,1,false,0,0);}catch(System.InvalidOperationException){rejected=true;}
    Assert(rejected,"A negative hit child was accepted.");
    s=TwoLeaves();var previous=s.Root;
    for(int i=0;i<25;i++){var next=new Node(i+2);previous.Focus=next;previous=next;}
    rejected=false;try{SSEAccessible.ResolveDocumentTargetCore(s,1,true,0,0);}catch(System.InvalidOperationException){rejected=true;}
    Assert(rejected,"An excessive focus chain was accepted.");
  }
}
'@
Add-Type -TypeDefinition ($source + [Environment]::NewLine + $contract) -ReferencedAssemblies (Get-SSENativeReferencedAssemblies)
[MsaaDocumentContract]::Check()
Write-Output 'Bounded MSAA document inventory: simple children, parent binding, batches, provider errors, limits, cycles and drift checked.'
