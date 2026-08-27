import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { callWorker } from "../dist/worker.js";

const systemRoot = process.env.SystemRoot ?? process.env.WINDIR ?? "C:\\Windows";
const compilerCandidates = [
  join(systemRoot, "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe"),
  join(systemRoot, "Microsoft.NET", "Framework", "v4.0.30319", "csc.exe"),
];
const compiler = compilerCandidates.find((candidate) => existsSync(candidate));
assert(compiler, "Der Windows-.NET-Framework-Compiler fuer den Prozessfixture-Test fehlt.");

const sandbox = mkdtempSync(join(tmpdir(), "sse-worker-inherited-pipe-"));
const source = join(sandbox, "inherited-pipe.cs");
const shim = join(sandbox, "powershell.exe");
const previousPowerShell = process.env.SSE_POWERSHELL_EXE;

writeFileSync(source, `
using System.Diagnostics;
using System.Reflection;
using System.Threading;

public static class Program {
  public static int Main(string[] args) {
    if (args.Length == 1 && args[0] == "--hold") {
      Thread.Sleep(13000);
      return 0;
    }
    Process.Start(new ProcessStartInfo {
      FileName = Assembly.GetExecutingAssembly().Location,
      Arguments = "--hold",
      UseShellExecute = false,
      CreateNoWindow = true
    });
    return 0;
  }
}
`, "utf8");

try {
  execFileSync(compiler, ["/nologo", "/target:exe", `/out:${shim}`, source], {
    cwd: sandbox,
    windowsHide: true,
    stdio: "pipe",
  });
  process.env.SSE_POWERSHELL_EXE = shim;

  await assert.rejects(
    callWorker("health", {}, 500),
    (error) => error?.kind === "timeout" && /nicht nachweislich beendet/.test(error.message),
    "Ein beendeter Parent ohne geschlossenes Pipe-/Prozessbaum-Lifecycle muss die Worker-Isolation verriegeln.",
  );

  const alreadyAborted = new AbortController();
  alreadyAborted.abort();
  await assert.rejects(
    callWorker("health", {}, 500, alreadyAborted.signal),
    (error) => error?.kind === "worker-isolation-lost",
    "Nach nicht nachweisbarem Cleanup darf selbst ein vorab abgebrochener Folgeaufruf keinen Workerpfad mehr betreten.",
  );

  process.stdout.write("Worker-Prozessbaum: geerbte Pipe verriegelt Folgeaufrufe fail-closed\n");
} finally {
  if (previousPowerShell === undefined) delete process.env.SSE_POWERSHELL_EXE;
  else process.env.SSE_POWERSHELL_EXE = previousPowerShell;
  // Der absichtlich entkoppelte Fixture-Enkel endet selbst; erst danach kann
  // Windows seine laufende EXE im Temp-Verzeichnis sicher entfernen.
  await delay(3_000);
  rmSync(sandbox, {
    recursive: true,
    force: true,
    maxRetries: 50,
    retryDelay: 100,
  });
}
