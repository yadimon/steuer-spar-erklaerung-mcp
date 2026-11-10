// Read only the job inherited by a normal GUI child. No UI or process creation.
using System;
using System.Globalization;
using System.Runtime.InteropServices;

public static class SSEGuiLaunchLifetimeProbe {
  [StructLayout(LayoutKind.Sequential)] struct Limits {
    public long ProcessTime, JobTime;
    public uint Flags;
    public UIntPtr MinimumWorkingSet, MaximumWorkingSet;
    public uint ActiveProcesses;
    public UIntPtr Affinity;
    public uint Priority, Scheduling;
  }
  [DllImport("kernel32.dll", SetLastError=true)]
  static extern bool IsProcessInJob(IntPtr process, IntPtr job, out bool inside);
  [DllImport("kernel32.dll", SetLastError=true)]
  static extern bool QueryInformationJobObject(IntPtr job, int infoClass,
    out Limits limits, uint size, IntPtr returned);

  public static int Main(string[] args) {
    try {
      if (args.Length != 0) throw new ArgumentException();
      bool inside;
      if (!IsProcessInJob(new IntPtr(-1), IntPtr.Zero, out inside))
        throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
      uint flags = 0;
      if (inside) {
        Limits limits;
        if (!QueryInformationJobObject(IntPtr.Zero, 2, out limits,
            (uint)Marshal.SizeOf(typeof(Limits)), IntPtr.Zero))
          throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
        flags = limits.Flags;
      }
      // This describes the immediate inherited job, not every ancestor job.
      Console.WriteLine("{\"ok\":true,\"inJob\":" + (inside ? "true" : "false") +
        ",\"limitFlags\":" + flags.ToString(CultureInfo.InvariantCulture) + "}");
      return 0;
    } catch {
      Console.WriteLine("{\"ok\":false}");
      return 1;
    }
  }
}
