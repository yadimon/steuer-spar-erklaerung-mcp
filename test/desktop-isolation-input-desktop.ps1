# Opt-in native boundary test; requires a thread on the readable input desktop.
# No visible window, desktop switch, mouse, keyboard or product process.
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../powershell/load-native.ps1')
$null=Import-SSENativeInterop
Add-Type -AssemblyName System.Windows.Forms
Add-Type @'
using System;using System.Text;using System.Runtime.InteropServices;
public static class SseInputDesktopFixture {
 [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
 [DllImport("user32.dll")] static extern IntPtr GetThreadDesktop(uint thread);
 [DllImport("user32.dll")] static extern IntPtr OpenInputDesktop(uint flags,bool inherit,uint access);
 [DllImport("user32.dll")] static extern bool CloseDesktop(IntPtr desktop);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern bool GetUserObjectInformation(IntPtr handle,int index,StringBuilder text,uint length,out uint needed);
 static string Name(IntPtr handle){var text=new StringBuilder(256);uint needed;if(handle==IntPtr.Zero||!GetUserObjectInformation(handle,2,text,512,out needed))throw new InvalidOperationException("The opt-in fixture requires readable desktop identities.");return text.ToString();}
 public static string AssertInputThread(){
  var thread=Name(GetThreadDesktop(GetCurrentThreadId()));var input=OpenInputDesktop(0,false,1);
  if(input==IntPtr.Zero)throw new InvalidOperationException("The opt-in fixture requires a readable input desktop.");
  try{if(thread!=Name(input))throw new InvalidOperationException("The opt-in fixture must run on the input desktop.");return thread;}finally{CloseDesktop(input);}
 }
}
'@
$desktopName=[SseInputDesktopFixture]::AssertInputThread()
$window=New-Object Windows.Forms.NativeWindow
$parameters=New-Object Windows.Forms.CreateParams
$parameters.Caption='Synthetic input desktop boundary'
$parameters.Parent=[IntPtr](-3)
try {
  $window.CreateHandle($parameters)
  if ($window.Handle -eq [IntPtr]::Zero -or [DSK]::IsIsolatedWindowDesktop($window.Handle,$desktopName)) {
    throw 'Matching worker and window desktop names incorrectly authorized the current input desktop.'
  }
} finally { $window.DestroyHandle() }
Write-Output 'Native desktop isolation: matching names on the actual input desktop are refused.'
