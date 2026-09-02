// Public Win32/MSAA interop used by the fresh per-action PowerShell worker.
// Kept in one compilation unit so Add-Type invokes the compiler only once.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Windows;
using System.Windows.Automation;

public class DSK {
  public delegate bool EP(IntPtr h, IntPtr l);
  [DllImport("user32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
  public static extern IntPtr CreateDesktop(string name, IntPtr dev, IntPtr dm, int flags, uint access, IntPtr sa);
  [DllImport("user32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
  public static extern IntPtr OpenDesktop(string name, int flags, bool inherit, uint access);
  [DllImport("user32.dll", SetLastError=true)] public static extern bool EnumDesktopWindows(IntPtr desktop, EP cb, IntPtr l);
  [DllImport("kernel32.dll")] public static extern void SetLastError(uint code);
  public static IntPtr[] ListDesktopWindows(IntPtr desktop) {
    var windows = new List<IntPtr>();
    EP callback = delegate(IntPtr hwnd, IntPtr context) {
      windows.Add(hwnd);
      return true;
    };
    // EnumDesktopWindows also returns FALSE for a desktop that currently owns
    // no top-level window, and it leaves the thread error untouched in that
    // case. A freshly created private desktop is exactly in that state until
    // the launched process shows its first window, so a leftover error such as
    // ERROR_ENVVAR_NOT_FOUND must never be reported as an enumeration failure.
    // The callback always returns true, so FALSE plus a cleared error can only
    // mean "nothing to enumerate"; a real error is still raised.
    SetLastError(0);
    if (!EnumDesktopWindows(desktop, callback, IntPtr.Zero)) {
      int lastError = Marshal.GetLastWin32Error();
      if (lastError != 0) throw new System.ComponentModel.Win32Exception(lastError);
    }
    return windows.ToArray();
  }
  [DllImport("user32.dll", SetLastError=true)] public static extern bool CloseDesktop(IntPtr h);
  [DllImport("user32.dll", SetLastError=true)] public static extern bool SetThreadDesktop(IntPtr h);
  [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr GetThreadDesktop(uint tid);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool TerminateProcess(IntPtr h, uint exitCode);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern uint WaitForSingleObject(IntPtr h, uint milliseconds);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool GetExitCodeProcess(IntPtr h, out uint code);
  [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
  public static extern IntPtr CreateJobObject(IntPtr sa, string name);
  [DllImport("kernel32.dll", SetLastError=true)]
  public static extern bool SetInformationJobObject(IntPtr job, int infoClass,
    ref JOBOBJECT_EXTENDED_LIMIT_INFORMATION info, uint length);
  [DllImport("kernel32.dll", SetLastError=true)]
  public static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern uint ResumeThread(IntPtr thread);
  [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
  public static extern bool CreateProcess(string app, StringBuilder cmd, IntPtr pa, IntPtr ta,
    bool inherit, uint flags, IntPtr env, string dir, ref SI si, out PI pi);
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public struct SI { public int cb; public string res; public string desktop; public string title;
    public int x,y,xs,ys,xc,yc,fill,flags; public short show,res2; public IntPtr res3,i,o,e; }
  [StructLayout(LayoutKind.Sequential)]
  public struct PI { public IntPtr hProcess, hThread; public int pid, tid; }
  [StructLayout(LayoutKind.Sequential)]
  public struct IO_COUNTERS { public ulong ReadOperationCount, WriteOperationCount, OtherOperationCount,
    ReadTransferCount, WriteTransferCount, OtherTransferCount; }
  [StructLayout(LayoutKind.Sequential)]
  public struct JOBOBJECT_BASIC_LIMIT_INFORMATION {
    public long PerProcessUserTimeLimit, PerJobUserTimeLimit; public uint LimitFlags;
    public UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize; public uint ActiveProcessLimit;
    public UIntPtr Affinity; public uint PriorityClass, SchedulingClass;
  }
  [StructLayout(LayoutKind.Sequential)]
  public struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION {
    public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation; public IO_COUNTERS IoInfo;
    public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed;
  }
}

// Fixed-session worker-controller ownership lives in the already precompiled
// native helper. Keeping the lifecycle here avoids registering a large pair of
// PowerShell functions in every replacement prewarm worker while preserving
// Win32's thread-affine mutex and abandonment semantics.
public sealed class SSEWorkerControllerLease {
  const uint WAIT_OBJECT_0 = 0x00000000;
  const uint WAIT_ABANDONED = 0x00000080;
  const uint WAIT_TIMEOUT = 0x00000102;
  IntPtr handle;
  bool owned;
  uint ownerThreadId;

  public string Status { get; private set; }
  public string Reason { get; private set; }

  SSEWorkerControllerLease(string status, string reason, IntPtr handle, bool owned, uint ownerThreadId) {
    Status = status;
    Reason = reason;
    this.handle = handle;
    this.owned = owned;
    this.ownerThreadId = ownerThreadId;
  }

  [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
  static extern IntPtr CreateMutex(IntPtr attributes, bool initialOwner, string name);
  [DllImport("kernel32.dll", SetLastError=true)]
  static extern bool ReleaseMutex(IntPtr mutex);

  static SSEWorkerControllerLease Result(string status, string reason) {
    return new SSEWorkerControllerLease(status, reason, IntPtr.Zero, false, 0);
  }

  public static SSEWorkerControllerLease Acquire(string name) {
    IntPtr handle = IntPtr.Zero;
    try {
      handle = CreateMutex(IntPtr.Zero, false, name);
      if (handle == IntPtr.Zero) return Result("unavailable", "controller-lock-unavailable");
      uint wait = DSK.WaitForSingleObject(handle, 0);
      if (wait == WAIT_TIMEOUT) {
        if (!DSK.CloseHandle(handle)) return Result("unavailable", "controller-lock-unavailable");
        return Result("busy", "session-controller-busy");
      }
      if (wait == WAIT_OBJECT_0 || wait == WAIT_ABANDONED) {
        return new SSEWorkerControllerLease(
          wait == WAIT_ABANDONED ? "abandoned" : "acquired",
          wait == WAIT_ABANDONED ? "controller-lock-abandoned" : null,
          handle,
          true,
          DSK.GetCurrentThreadId());
      }
      DSK.CloseHandle(handle);
      return Result("unavailable", "controller-lock-unavailable");
    } catch {
      if (handle != IntPtr.Zero) DSK.CloseHandle(handle);
      return Result("unavailable", "controller-lock-unavailable");
    }
  }

  public static string ReleaseAndClose(SSEWorkerControllerLease lease) {
    if (lease == null || lease.handle == IntPtr.Zero) return null;
    string failure = null;
    try {
      if (lease.owned) {
        if (DSK.GetCurrentThreadId() != lease.ownerThreadId) {
          failure = "controller-lock-thread-changed";
        } else if (!ReleaseMutex(lease.handle)) {
          failure = "controller-lock-release-failed";
        }
      }
    } finally {
      if (!DSK.CloseHandle(lease.handle) && failure == null) {
        failure = "controller-lock-dispose-failed";
      }
      lease.handle = IntPtr.Zero;
      lease.owned = false;
      lease.ownerThreadId = 0;
    }
    return failure;
  }
}

public class SW {
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h,IntPtr hdc,uint f);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h,out RC r);
  [DllImport("user32.dll")] public static extern IntPtr GetDlgItem(IntPtr h,int id);
  [DllImport("user32.dll", SetLastError=true)] public static extern bool EnumWindows(EP cb,IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr parent,EP cb,IntPtr l);
  [DllImport("user32.dll")] public static extern int GetDlgCtrlID(IntPtr h);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h,out uint pid);
  [DllImport("user32.dll", CharSet=CharSet.Unicode, ExactSpelling=true)] public static extern int GetWindowTextW(IntPtr h,StringBuilder s,int n);
  [DllImport("user32.dll", CharSet=CharSet.Unicode, ExactSpelling=true)] public static extern int GetClassNameW(IntPtr h,StringBuilder s,int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsWindowUnicode(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsHungAppWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr SendMessageTimeout(IntPtr h,uint m,IntPtr w,IntPtr l,uint f,uint t,out IntPtr r);
  [DllImport("user32.dll", CharSet=CharSet.Ansi, ExactSpelling=true)] public static extern IntPtr SendMessageTimeoutA(IntPtr h,uint m,IntPtr w,IntPtr l,uint f,uint t,out IntPtr r);
  [DllImport("user32.dll", CharSet=CharSet.Unicode, ExactSpelling=true)] public static extern IntPtr SendMessageTimeoutW(IntPtr h,uint m,IntPtr w,IntPtr l,uint f,uint t,out IntPtr r);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out PT p);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f,uint dx,uint dy,uint d,IntPtr e);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk,byte scan,uint flags,IntPtr extra);
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(PT p);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h,uint f);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h,int c);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h,IntPtr after,int x,int y,int cx,int cy,uint flags);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ScreenToClient(IntPtr h, ref PT p);
  [DllImport("user32.dll", SetLastError=true)] public static extern bool PostMessage(IntPtr h,uint m,IntPtr w,IntPtr l);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h,uint m,IntPtr w,IntPtr l);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern IntPtr GetLastActivePopup(IntPtr h);
  [DllImport("user32.dll", SetLastError=true)] public static extern bool GetLastInputInfo(ref LASTINPUTINFO info);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a,uint b,bool attach);
  [DllImport("user32.dll")] public static extern bool GetGUIThreadInfo(uint idThread,ref GUIINFO info);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  public struct RC { public int L,T,R,B; }
  public struct PT { public int X,Y; }
  [StructLayout(LayoutKind.Sequential)]
  public struct GUIINFO {
    public int cbSize;
    public uint flags;
    public IntPtr hwndActive,hwndFocus,hwndCapture,hwndMenuOwner,hwndMoveSize,hwndCaret;
    public RC rcCaret;
  }
  [StructLayout(LayoutKind.Sequential)]
  public struct INPUT { public uint type; public INPUTUNION input; }
  [StructLayout(LayoutKind.Explicit)]
  public struct INPUTUNION {
    [FieldOffset(0)] public MOUSEINPUT mouse;
    [FieldOffset(0)] public KEYBDINPUT keyboard;
    [FieldOffset(0)] public HARDWAREINPUT hardware;
  }
  [StructLayout(LayoutKind.Sequential)]
  public struct MOUSEINPUT { public int dx,dy; public uint mouseData,dwFlags,time; public UIntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)]
  public struct KEYBDINPUT { public ushort wVk,wScan; public uint dwFlags,time; public UIntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)]
  public struct HARDWAREINPUT { public uint uMsg; public ushort wParamL,wParamH; }
  [DllImport("user32.dll", SetLastError=true)] static extern uint SendInput(uint count,INPUT[] inputs,int size);
  public static bool SendUnicodeText(string text) {
    if (text == null) return false;
    int size = Marshal.SizeOf(typeof(INPUT));
    foreach (char ch in text) {
      INPUT[] pair = new INPUT[2];
      pair[0].type = 1;
      pair[0].input.keyboard.wScan = ch;
      pair[0].input.keyboard.dwFlags = 0x0004;
      pair[1].type = 1;
      pair[1].input.keyboard.wScan = ch;
      pair[1].input.keyboard.dwFlags = 0x0004 | 0x0002;
      if (SendInput(2, pair, size) != 2) return false;
    }
    return true;
  }
  [StructLayout(LayoutKind.Sequential)]
  public struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }
  public delegate bool EP(IntPtr h,IntPtr l);
}

// Plain records returned to PowerShell after the native callback has finished.
// Keeping the callback and its per-window work in managed C# avoids one
// PowerShell delegate transition for every top-level window on the desktop.
public sealed class SSEWindowNode {
  public long Hwnd;
  public int Pid;
  public int X, Y, W, H;
  public string ClassName;
  public string Title;
  public string TitleFingerprint;
  public bool Hung;
  public bool Minimized;
  internal int EnumerationOrder;
}

public static class SSEWindowEnumerator {
  static string Sha256(string value) {
    using (SHA256 algorithm = SHA256.Create()) {
      return BitConverter.ToString(algorithm.ComputeHash(Encoding.UTF8.GetBytes(value))).Replace("-", "");
    }
  }

  static void EnsureEnumerationCompleted(
    bool completed, int nativeError, int callbacksVisited, Exception callbackFailure) {
    // EnumWindows returns FALSE both for a native failure and when its callback
    // aborts enumeration. Preserve a managed callback failure as the primary
    // exception. Like EnumDesktopWindows, EnumWindows returns FALSE with no
    // error and no callback for a genuinely empty private desktop; only that
    // exact empty case is safe. FALSE after a callback would be a partial
    // snapshot and must fail closed even if Win32 omitted an error code.
    if (callbackFailure != null) {
      System.Runtime.ExceptionServices.ExceptionDispatchInfo.Capture(callbackFailure).Throw();
    }
    if (completed || (nativeError == 0 && callbacksVisited == 0)) return;
    if (nativeError != 0) {
      throw new System.ComponentModel.Win32Exception(nativeError, "window-enumeration-failed");
    }
    throw new InvalidOperationException("window-enumeration-failed");
  }

  public static SSEWindowNode[] Describe(int[] allowedProcessIds) {
    if (allowedProcessIds == null || allowedProcessIds.Length == 0) return new SSEWindowNode[0];
    var allowed = new HashSet<int>(allowedProcessIds);
    var output = new List<SSEWindowNode>();
    int order = 0;
    int callbacksVisited = 0;
    Exception callbackFailure = null;
    SW.EP callback = delegate(IntPtr hwnd, IntPtr context) {
      try {
        callbacksVisited++;
        uint processId = 0;
        SW.GetWindowThreadProcessId(hwnd, out processId);
        if (!allowed.Contains(unchecked((int)processId)) || !SW.IsWindowVisible(hwnd)) return true;

        var title = new StringBuilder(512);
        var className = new StringBuilder(256);
        SW.GetWindowTextW(hwnd, title, title.Capacity);
        SW.GetClassNameW(hwnd, className, className.Capacity);
        SW.RC rectangle;
        SW.GetWindowRect(hwnd, out rectangle);
        string titleText = title.ToString();
        output.Add(new SSEWindowNode {
          Hwnd = hwnd.ToInt64(), Pid = unchecked((int)processId),
          X = rectangle.L, Y = rectangle.T,
          W = rectangle.R - rectangle.L, H = rectangle.B - rectangle.T,
          ClassName = className.ToString(), Title = titleText,
          TitleFingerprint = Sha256(titleText),
          Hung = SW.IsHungAppWindow(hwnd), Minimized = SW.IsIconic(hwnd),
          EnumerationOrder = order++
        });
        return true;
      } catch (Exception failure) {
        callbackFailure = failure;
        return false;
      }
    };
    DSK.SetLastError(0);
    bool completed = SW.EnumWindows(callback, IntPtr.Zero);
    int nativeError = Marshal.GetLastWin32Error();
    EnsureEnumerationCompleted(completed, nativeError, callbacksVisited, callbackFailure);
    output.Sort(delegate(SSEWindowNode left, SSEWindowNode right) {
      long leftArea = (long)left.W * left.H;
      long rightArea = (long)right.W * right.H;
      int byArea = rightArea.CompareTo(leftArea);
      return byArea != 0 ? byArea : left.EnumerationOrder.CompareTo(right.EnumerationOrder);
    });
    return output.ToArray();
  }
}

// Read-only process command-line lookup for the common same-user path. The
// PowerShell worker deliberately keeps CIM as its compatibility fallback: an
// access-denied, exited or otherwise unsupported process is reported as null
// here rather than weakening the existing evidence rules.
public static class SSEProcessCommandLine {
  const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
  const int ProcessCommandLineInformation = 60;
  const int MaxBufferBytes = 128 * 1024;
  const int STATUS_SUCCESS = 0;
  const int STATUS_INFO_LENGTH_MISMATCH = unchecked((int)0xC0000004);

  [DllImport("kernel32.dll", SetLastError=true)]
  static extern IntPtr OpenProcess(uint access, bool inheritHandle, int processId);

  [DllImport("ntdll.dll")]
  static extern int NtQueryInformationProcess(
    IntPtr processHandle,
    int processInformationClass,
    IntPtr processInformation,
    int processInformationLength,
    out int returnLength);

  public static string TryGet(int processId) {
    if (processId <= 0) return null;
    IntPtr process = IntPtr.Zero;
    IntPtr buffer = IntPtr.Zero;
    try {
      process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, processId);
      if (process == IntPtr.Zero) return null;

      int requiredLength;
      int sizeStatus = NtQueryInformationProcess(
        process, ProcessCommandLineInformation, IntPtr.Zero, 0, out requiredLength);
      if (sizeStatus != STATUS_INFO_LENGTH_MISMATCH) return null;
      int headerBytes = IntPtr.Size == 8 ? 16 : 8;
      if (requiredLength < headerBytes || requiredLength > MaxBufferBytes) return null;

      buffer = Marshal.AllocHGlobal(requiredLength);
      int returnedLength;
      int status = NtQueryInformationProcess(
        process, ProcessCommandLineInformation, buffer, requiredLength, out returnedLength);
      if (status != STATUS_SUCCESS || returnedLength < headerBytes || returnedLength > requiredLength) return null;

      int textBytes = unchecked((ushort)Marshal.ReadInt16(buffer, 0));
      int maximumTextBytes = unchecked((ushort)Marshal.ReadInt16(buffer, 2));
      if ((textBytes & 1) != 0 || (maximumTextBytes & 1) != 0 ||
          textBytes > maximumTextBytes || maximumTextBytes > MaxBufferBytes) return null;
      IntPtr textPointer = Marshal.ReadIntPtr(buffer, IntPtr.Size == 8 ? 8 : 4);
      if (textPointer == IntPtr.Zero) return null;

      long allocationStart = buffer.ToInt64();
      long allocationEnd = allocationStart + returnedLength;
      long textStart = textPointer.ToInt64();
      long textEnd = textStart + textBytes;
      long maximumTextEnd = textStart + maximumTextBytes;
      if (allocationEnd < allocationStart || textEnd < textStart || maximumTextEnd < textStart ||
          (textStart & 1) != 0 || textStart < allocationStart + headerBytes ||
          textEnd > allocationEnd || maximumTextEnd > allocationEnd) return null;
      string commandLine = Marshal.PtrToStringUni(textPointer, textBytes / 2);
      return commandLine != null && commandLine.IndexOf('\0') < 0 ? commandLine : null;
    } catch {
      return null;
    } finally {
      if (buffer != IntPtr.Zero) Marshal.FreeHGlobal(buffer);
      if (process != IntPtr.Zero) DSK.CloseHandle(process);
    }
  }
}

public sealed class SSEAccNode {
  public string Name;
  public string Value;
  public string Description;
  public string Help;
  public string KeyboardShortcut;
  public int Role;
  public int State;
  public string DefaultAction;
  public int X, Y, W, H;
  public int[] Path;
}

public static class SSEAccessible {
  const uint OBJID_CLIENT = 0xFFFFFFFC;
  static readonly Guid IID_IAccessible = new Guid("618736e0-3c3d-11cf-810c-00aa00389b71");
  [StructLayout(LayoutKind.Sequential)] struct POINT { public int X, Y; }

  [DllImport("oleacc.dll")]
  static extern int AccessibleObjectFromWindow(
    IntPtr hwnd, uint id, ref Guid iid,
    [In, Out, MarshalAs(UnmanagedType.IUnknown)] ref object accessible);

  [DllImport("oleacc.dll")]
  static extern int AccessibleObjectFromPoint(
    POINT point,
    [Out, MarshalAs(UnmanagedType.Interface)] out object accessible,
    [Out, MarshalAs(UnmanagedType.Struct)] out object childId);

  [DllImport("oleacc.dll")]
  static extern int AccessibleChildren(
    [MarshalAs(UnmanagedType.Interface)] object container, int start, int count,
    [In, Out, MarshalAs(UnmanagedType.LPArray, SizeParamIndex = 2)] object[] children,
    out int obtained);

  static object Root(long hwnd) {
    object root = null;
    Guid iid = IID_IAccessible;
    int hr = AccessibleObjectFromWindow((IntPtr)hwnd, OBJID_CLIENT, ref iid, ref root);
    if (hr != 0 || root == null) throw new InvalidOperationException("AccessibleObjectFromWindow: " + hr);
    return root;
  }

  static object[] Children(object parent) {
    dynamic p = parent;
    int count = 0;
    try { count = Convert.ToInt32(p.accChildCount); } catch { }
    if (count <= 0) return new object[0];
    object[] result = new object[count];
    int obtained = 0;
    int hr = AccessibleChildren(parent, 0, count, result, out obtained);
    if (hr != 0) return new object[0];
    if (obtained == result.Length) return result;
    Array.Resize(ref result, obtained);
    return result;
  }

  static void Walk(object parent, List<int> path, List<SSEAccNode> output, int depth) {
    if (depth > 8 || output.Count >= 240) return;
    object[] children = Children(parent);
    for (int i = 0; i < children.Length && output.Count < 240; i++) {
      object child = children[i];
      // Simple integer child IDs are uncommon in Qt and cannot have descendants.
      // Native Win32 dialogs are handled by UIA, so ignore them in this fallback.
      if (child == null || child is int || child is short || child is long) continue;
      try {
        dynamic c = child;
        int x = 0, y = 0, w = 0, h = 0;
        try { c.accLocation(out x, out y, out w, out h, 0); } catch { }
        string name = "", value = "", description = "", help = "", shortcut = "", action = "";
        int role = 0, state = 0;
        try { name = Convert.ToString(c.accName(0)) ?? ""; } catch { }
        try { value = Convert.ToString(c.accValue(0)) ?? ""; } catch { }
        try { description = Convert.ToString(c.accDescription(0)) ?? ""; } catch { }
        try { help = Convert.ToString(c.accHelp(0)) ?? ""; } catch { }
        try { shortcut = Convert.ToString(c.accKeyboardShortcut(0)) ?? ""; } catch { }
        try { action = Convert.ToString(c.accDefaultAction(0)) ?? ""; } catch { }
        try { role = Convert.ToInt32(c.accRole(0)); } catch { }
        try { state = Convert.ToInt32(c.accState(0)); } catch { }
        var childPath = new List<int>(path); childPath.Add(i);
        output.Add(new SSEAccNode {
          Name = name, Value = value, Description = description, Help = help,
          KeyboardShortcut = shortcut, DefaultAction = action, Role = role, State = state,
          X = x, Y = y, W = w, H = h, Path = childPath.ToArray()
        });
        Walk(child, childPath, output, depth + 1);
      } catch { }
    }
  }

  public static SSEAccNode[] Describe(long hwnd) {
    var output = new List<SSEAccNode>();
    Walk(Root(hwnd), new List<int>(), output, 0);
    return output.ToArray();
  }

  static SSEAccNode DescribePointCore(int x, int y, bool includeExtended) {
    object accessible = null, childId = null;
    POINT point = new POINT { X = x, Y = y };
    int hr = AccessibleObjectFromPoint(point, out accessible, out childId);
    if (hr != 0 || accessible == null) return null;
    dynamic c = accessible;
    object id = childId ?? 0;
    int left = 0, top = 0, width = 0, height = 0;
    string name = "", value = "", description = "", help = "", shortcut = "", action = "";
    int role = 0, state = 0;
    try { c.accLocation(out left, out top, out width, out height, id); } catch { }
    try { name = Convert.ToString(c.accName(id)) ?? ""; } catch { }
    try { value = Convert.ToString(c.accValue(id)) ?? ""; } catch { }
    if (includeExtended) {
      try { description = Convert.ToString(c.accDescription(id)) ?? ""; } catch { }
      try { help = Convert.ToString(c.accHelp(id)) ?? ""; } catch { }
      try { shortcut = Convert.ToString(c.accKeyboardShortcut(id)) ?? ""; } catch { }
      try { action = Convert.ToString(c.accDefaultAction(id)) ?? ""; } catch { }
    }
    try { role = Convert.ToInt32(c.accRole(id)); } catch { }
    try { state = Convert.ToInt32(c.accState(id)); } catch { }
    return new SSEAccNode {
      Name = name, Value = value, Description = description, Help = help,
      KeyboardShortcut = shortcut, DefaultAction = action, Role = role, State = state,
      X = left, Y = top, W = width, H = height, Path = new int[0]
    };
  }

  public static SSEAccNode DescribePoint(int x, int y) {
    return DescribePointCore(x, y, true);
  }

  public static SSEAccNode DescribePointBasic(int x, int y) {
    return DescribePointCore(x, y, false);
  }

  public static void Invoke(long hwnd, int[] path) {
    if (path == null || path.Length == 0) throw new ArgumentException("MSAA path fehlt.");
    object current = Root(hwnd);
    for (int depth = 0; depth < path.Length; depth++) {
      object[] children = Children(current);
      int index = path[depth];
      if (index < 0 || index >= children.Length) throw new InvalidOperationException("MSAA path ist veraltet.");
      object child = children[index];
      if (child == null || child is int || child is short || child is long)
        throw new InvalidOperationException("Einfaches MSAA-Kind kann nicht sicher adressiert werden.");
      current = child;
    }
    dynamic target = current;
    target.accDoDefaultAction(0);
  }
}

// ------------------------------------------------------------ UIA-Baumlauf
// Derselbe Lauf lief bisher in PowerShell: ein frischer Arbeiter brauchte
// dafuer im Median 328 ms fuer 160 Knoten, hier sind es 237 ms. Gespart wird
// ausschliesslich der Interpreteraufwand je Knoten; die Folge der
// Provideraufrufe ist Schritt fuer Schritt dieselbe wie vorher.
//
// Das ist eine bewusste Entscheidung gegen den schnelleren Weg. Eine Fassung
// mit FindAll(TreeScope.Children) holte eine ganze Geschwisterreihe in EINEM
// Provideraufruf und war noch einmal 25 ms schneller - sie hat die
// UStVA-Phase der Live-Reise aber zum Haengen gebracht: SSE stand danach mit
// 2,26 GB und Responding=False, weil ein einzelner laufender Provideraufruf
// von unserer RuntimeId-Sperre nicht unterbrochen werden kann. Dasselbe war
// zuvor schon bei GetUpdatedCache(TreeScope.Subtree) beobachtet worden.
// Deshalb: CacheRequest auf TreeScope.Element, ein Provideraufruf je Knoten,
// und die Zyklussperre greift zwischen zwei Schritten.
public sealed class SSEUiaScrollState {
  public bool VerticallyScrollable;
  public double VerticalScrollPercent;
  public double VerticalViewSize;
  public bool HorizontallyScrollable;
  public double HorizontalScrollPercent;
}

public sealed class SSEUiaNode {
  public int Index;
  public int ParentIndex;
  public int Depth;
  public string ControlType;
  public string Name;
  public string AutomationId;
  public int X, Y, W, H;
  public bool Enabled;
  // null, wenn der Knotentyp keinen Wert traegt oder nicht danach gefragt wurde.
  public object Value;
  public object ReadOnly;
  // true, false, "unbestimmt" oder null - wie der bisherige PowerShell-Lauf.
  public object Checked;
  public object Selected;
  public SSEUiaScrollState Scroll;
  public string RuntimeId;
  // Lebendes Element fuer den RuntimeId-Zwischenspeicher des Arbeiters.
  public AutomationElement Element;
}

public sealed class SSEUiaSnapshot {
  public SSEUiaNode[] Nodes;
  public int NodeCount;
  public int WalkErrors;
  public int CycleHits;
  public int ValueErrors;
  public int ScrollErrors;
  public string CycleRuntimeId = "";
  public bool Truncated;
}

public static class SSEUiaTree {
  static readonly HashSet<string> ValueTypes =
    new HashSet<string>(new string[] { "Edit", "ComboBox", "Spinner" }, StringComparer.Ordinal);
  static readonly HashSet<string> ToggleTypes =
    new HashSet<string>(new string[] { "CheckBox" }, StringComparer.Ordinal);
  static readonly HashSet<string> SelectionTypes =
    new HashSet<string>(new string[] { "RadioButton", "TreeItem" }, StringComparer.Ordinal);
  static readonly HashSet<string> ScrollTypes =
    new HashSet<string>(
      new string[] { "Pane", "Custom", "Group", "Table", "List", "Tree", "Document" },
      StringComparer.Ordinal);

  sealed class WalkState {
    public List<SSEUiaNode> Output = new List<SSEUiaNode>();
    public HashSet<string> Seen = new HashSet<string>(StringComparer.Ordinal);
    public SSEUiaSnapshot Result = new SSEUiaSnapshot();
    public Stopwatch Watch = Stopwatch.StartNew();
    public int MaxNodes;
    public int TimeoutMs;
    public int MaxDepth;
    public bool WithValues;
    public bool WithScroll;
    public CacheRequest Request;
    public TreeWalker Walker;
  }

  static string Normalize(string value) {
    if (string.IsNullOrEmpty(value)) return "";
    return value.Replace('\r', ' ').Replace('\n', ' ').Replace('\t', ' ').Trim();
  }

  static bool LimitReached(WalkState state) {
    if (state.Result.NodeCount >= state.MaxNodes || state.Watch.ElapsedMilliseconds > state.TimeoutMs) {
      state.Result.Truncated = true;
      return true;
    }
    return false;
  }

  static string JoinRuntimeId(int[] parts) {
    if (parts == null || parts.Length == 0) return null;
    var text = new StringBuilder();
    for (int index = 0; index < parts.Length; index++) {
      if (index > 0) text.Append('.');
      text.Append(parts[index]);
    }
    return text.ToString();
  }

  static string RuntimeIdOf(WalkState state, AutomationElement element) {
    try {
      string cached = JoinRuntimeId(element.GetCachedPropertyValue(AutomationElement.RuntimeIdProperty) as int[]);
      if (cached != null) return cached;
      return JoinRuntimeId(element.GetRuntimeId());
    } catch {
      state.Result.WalkErrors++;
      return null;
    }
  }

  static CacheRequest BuildRequest() {
    var request = new CacheRequest();
    request.Add(AutomationElement.NameProperty);
    request.Add(AutomationElement.AutomationIdProperty);
    request.Add(AutomationElement.ControlTypeProperty);
    request.Add(AutomationElement.BoundingRectangleProperty);
    request.Add(AutomationElement.IsEnabledProperty);
    request.Add(AutomationElement.RuntimeIdProperty);
    request.TreeScope = TreeScope.Element;
    request.TreeFilter = Automation.ControlViewCondition;
    request.AutomationElementMode = AutomationElementMode.Full;
    return request;
  }

  static void FillPatterns(WalkState state, AutomationElement element, string controlType, SSEUiaNode node) {
    object pattern;
    if (state.WithValues && ValueTypes.Contains(controlType)) {
      try {
        if (element.TryGetCurrentPattern(ValuePattern.Pattern, out pattern)) {
          ValuePattern value = (ValuePattern)pattern;
          node.Value = value.Current.Value;
          node.ReadOnly = value.Current.IsReadOnly;
        }
      } catch {
        // NICHT verschlucken: ein fehlgeschlagener Wertabruf saehe sonst wie
        // ein leeres Feld aus. Bei Betraegen waere das ein Datenfehler.
        state.Result.ValueErrors++;
      }
    }
    if (state.WithValues && ToggleTypes.Contains(controlType)) {
      try {
        if (element.TryGetCurrentPattern(TogglePattern.Pattern, out pattern)) {
          ToggleState toggle = ((TogglePattern)pattern).Current.ToggleState;
          if (toggle == ToggleState.On) node.Checked = true;
          else if (toggle == ToggleState.Off) node.Checked = false;
          else node.Checked = "unbestimmt";
        }
      } catch { state.Result.ValueErrors++; }
    }
    if (state.WithValues && SelectionTypes.Contains(controlType)) {
      try {
        if (element.TryGetCurrentPattern(SelectionItemPattern.Pattern, out pattern)) {
          node.Selected = ((SelectionItemPattern)pattern).Current.IsSelected;
        }
      } catch { state.Result.ValueErrors++; }
    }
    if (state.WithScroll && ScrollTypes.Contains(controlType)) {
      try {
        if (element.TryGetCurrentPattern(ScrollPattern.Pattern, out pattern)) {
          ScrollPattern.ScrollPatternInformation current = ((ScrollPattern)pattern).Current;
          node.Scroll = new SSEUiaScrollState {
            VerticallyScrollable = current.VerticallyScrollable,
            VerticalScrollPercent = current.VerticalScrollPercent,
            VerticalViewSize = current.VerticalViewSize,
            HorizontallyScrollable = current.HorizontallyScrollable,
            HorizontalScrollPercent = current.HorizontalScrollPercent,
          };
        }
      } catch { state.Result.ScrollErrors++; }
    }
  }

  static SSEUiaNode BuildNode(
    WalkState state, AutomationElement element, int index, int parentIndex, int depth, string runtimeId) {
    AutomationElement.AutomationElementInformation cached = element.Cached;
    string controlType = cached.ControlType.ProgrammaticName.Replace("ControlType.", "");
    Rect rectangle = cached.BoundingRectangle;
    // Ein unsichtbarer Knoten meldet eine unendliche Flaeche. Ohne diese
    // Umsetzung rechnet jede Spalten-/Zuordnungslogik danach mit Unsinn.
    bool infinite = double.IsInfinity(rectangle.X);
    var node = new SSEUiaNode {
      Index = index,
      ParentIndex = parentIndex,
      Depth = depth,
      ControlType = controlType,
      Name = Normalize(cached.Name),
      AutomationId = cached.AutomationId == null ? "" : cached.AutomationId,
      X = infinite ? -1 : (int)rectangle.X,
      Y = infinite ? -1 : (int)rectangle.Y,
      W = infinite ? 0 : (int)rectangle.Width,
      H = infinite ? 0 : (int)rectangle.Height,
      Enabled = cached.IsEnabled,
      RuntimeId = runtimeId,
      Element = element,
    };
    FillPatterns(state, element, controlType, node);
    return node;
  }

  static void Walk(WalkState state, AutomationElement element, int depth, int parentIndex) {
    if (LimitReached(state)) return;
    AutomationElement child;
    try { child = state.Walker.GetFirstChild(element, state.Request); }
    catch {
      state.Result.WalkErrors++;
      return;
    }
    while (child != null) {
      if (LimitReached(state)) return;
      string runtimeId = RuntimeIdOf(state, child);
      // Ein wiedergesehener Knoten beendet die ganze Geschwisterreihe, genau
      // wie im bisherigen Lauf: GetNextSibling liefert auf einem zyklischen
      // Providerbaum sonst unbegrenzt denselben Knoten nach.
      if (runtimeId != null && !state.Seen.Add(runtimeId)) {
        state.Result.CycleHits++;
        if (state.Result.CycleRuntimeId.Length == 0) state.Result.CycleRuntimeId = runtimeId;
        return;
      }
      int index = state.Result.NodeCount;
      state.Result.NodeCount++;
      try { state.Output.Add(BuildNode(state, child, index, parentIndex, depth, runtimeId)); }
      catch { state.Result.WalkErrors++; }
      if (depth < state.MaxDepth) Walk(state, child, depth + 1, index);
      if (LimitReached(state)) return;
      try { child = state.Walker.GetNextSibling(child, state.Request); }
      catch {
        state.Result.WalkErrors++;
        return;
      }
    }
  }

  public static SSEUiaSnapshot Describe(
    IntPtr hwnd, int maxNodes, int timeoutMs, int maxDepth, bool withValues, bool withScroll) {
    if (hwnd == IntPtr.Zero) throw new ArgumentException("hwnd fehlt.");
    if (maxNodes <= 0) throw new ArgumentException("maxNodes muss positiv sein.");
    if (timeoutMs <= 0) throw new ArgumentException("timeoutMs muss positiv sein.");
    if (maxDepth <= 0) throw new ArgumentException("maxDepth muss positiv sein.");
    CacheRequest request = BuildRequest();
    var state = new WalkState {
      MaxNodes = maxNodes,
      TimeoutMs = timeoutMs,
      MaxDepth = maxDepth,
      WithValues = withValues,
      WithScroll = withScroll,
      Request = request,
      Walker = TreeWalker.ControlViewWalker,
    };
    AutomationElement root = AutomationElement.FromHandle(hwnd);
    AutomationElement cachedRoot = root.GetUpdatedCache(request);
    if (cachedRoot == null) throw new InvalidOperationException("GetUpdatedCache lieferte keinen Wurzelknoten.");
    Walk(state, cachedRoot, 0, -1);
    state.Result.Nodes = state.Output.ToArray();
    return state.Result;
  }
}
