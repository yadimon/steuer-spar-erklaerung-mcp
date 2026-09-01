// Public Win32/MSAA interop used by the fresh per-action PowerShell worker.
// Kept in one compilation unit so Add-Type invokes the compiler only once.
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;

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
    bool completed, int nativeError, Exception callbackFailure) {
    // EnumWindows returns FALSE both for a native failure and when its callback
    // aborts enumeration. Preserve a managed callback failure as the primary
    // exception. Unlike EnumDesktopWindows, a successful EnumWindows call on
    // an empty current desktop returns TRUE without invoking the callback.
    // Every FALSE is therefore a failure and must never expose a partial or
    // apparently empty snapshot, even if Win32 omitted an error code.
    if (callbackFailure != null) {
      System.Runtime.ExceptionServices.ExceptionDispatchInfo.Capture(callbackFailure).Throw();
    }
    if (completed) return;
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
    Exception callbackFailure = null;
    SW.EP callback = delegate(IntPtr hwnd, IntPtr context) {
      try {
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
    EnsureEnumerationCompleted(completed, nativeError, callbackFailure);
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
