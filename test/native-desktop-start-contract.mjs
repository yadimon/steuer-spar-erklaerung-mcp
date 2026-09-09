import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareNativeDesktopStart, parseNativeDesktopStart, executeNativeDesktopStart } from "../dist/native-desktop-start.js";
import { loadProductProfile } from "../dist/product-profiles.js";
import { createApiExecutor } from "../dist/api-executor.js";
import { loadApiServerConfig } from "../dist/api-config.js";

export async function verifyNativeDesktopStartContract() {
  const directory = mkdtempSync(join(tmpdir(), "sse-start-contract-"));
  try {
    const profile = loadProductProfile("2025"), cases = join(directory, "cases"); mkdirSync(cases);
    const executable = join(directory, "Steuerjahr 2025", "SSE.exe");
    const nativePackage = { loaderPath: join(directory, "must-not-run.exe"), manifest: { buildIdentity: "SyntheticIdentity" } };
    const options = { package: nativePackage, profile, executable, args: {}, timeoutMs: 10000 };
    const sample = join(cases, "Synthetic.Gew2025"); writeFileSync(sample, "synthetic");
    assert.equal(prepareNativeDesktopStart(options).name, "SSEAuto");
    assert.deepEqual(prepareNativeDesktopStart({ ...options, args: { file: sample } }).caseIdentity,
      { path: sample, documentType: "Gew", taxYear: 2025, mode: "einur", supported: true });
    const nextYear = join(cases, "Synthetic.GewErfass2026_Backup"); writeFileSync(nextYear, "synthetic");
    assert.equal(prepareNativeDesktopStart({ ...options, args: { file: nextYear, mode: "einurvor" } }).caseIdentity.taxYear, 2026);
    for (const [args, expected] of [[{ name: "Default\\Other" }, "bad-args"], [{ mode: "unknown" }, "bad-args"],
      [{ file: sample, mode: "normal" }, "mode-mismatch"], [{ file: sample.replace("2025", "2024") }, "unsupported-year"],
      [{ file: sample + ".txt" }, "unsupported-case"], [{ file: sample.replace("Synthetic", "Missing") }, "not-found"],
      [{ file: "relative.Gew2025" }, "bad-args"], [{ exe: executable.replace("SSE.exe", "Other.exe") }, "unsupported-version"],
      [{ timeoutSec: 91 }, "bad-args"], [{ timeoutSec: 2.5 }, "bad-args"]]) {
      assert.throws(() => prepareNativeDesktopStart({ ...options, args }), error => error.kind === expected);
    }
    const cancelled = new AbortController(); cancelled.abort();
    const aborted = await executeNativeDesktopStart({ ...options, signal: cancelled.signal });
    assert.equal(aborted.kind, "aborted"); assert.equal(aborted.outcomeUnknown, false);
    assert.equal((await executeNativeDesktopStart({ ...options, timeoutMs: 6000 })).kind, "native-deadline");
    const prepared = prepareNativeDesktopStart(options);
    const window = { pid: 99, hwnd: 42, x: 0, y: 0, w: 1200, h: 800, cls: "Synthetic", title: "SteuerSparErklärung", hung: false, minimiert: false };
    const result = { ok: true, desktop: "SSEAuto", pid: 99, startPid: 99, wartesekunden: 0.1, kommandozeile: "synthetic",
      fenster: [window], dialogWindows: [], ready: true, blockedByDialog: false,
      instance: { pid: 99, hwnd: 42, title: window.title, bindingMode: "desktop-launch-window" },
      product: { image: executable, fileMajor: 31, fileVersion: "31.0.2.0", productName: "Synthetic", companyName: "Synthetic" },
      loaderBuildIdentity: nativePackage.manifest.buildIdentity, loaderMs: 20 };
    assert.equal(parseNativeDesktopStart(result, prepared, options).product.taxYear, 2025);
    for (const patch of [{ pid: 98 }, { desktop: "Other" }, { ready: false }, { blockedByDialog: true },
      { product: { ...result.product, fileMajor: 30 } }, { loaderBuildIdentity: "Other" },
      { instance: { ...result.instance, hwnd: 43 } }, { fenster: [{ ...window, pid: 98 }] }])
      assert.throws(() => parseNativeDesktopStart({ ...result, ...patch }, prepared, options));
    const configPath = join(directory, "api.json");
    writeFileSync(configPath, JSON.stringify({ sseExecutable: executable, caseDir: cases, workspaceDir: join(directory, "workspace") }));
    const config = loadApiServerConfig({ SSE_API_CONFIG: configPath });
    const calls = [];
    const execute = createApiExecutor(config, async () => assert.fail("Native start must not invoke the legacy worker"), {
      nativeDesktopStart: async (args, timeoutMs) => { calls.push({ args, timeoutMs }); return { ok: false, kind: "native-timeout", outcomeUnknown: true }; },
    });
    const failed = await execute("desktop_start", { caseRef: "cases:Synthetic.Gew2025" }, 10000);
    assert.equal(failed.outcomeUnknown, true); assert.equal(calls.length, 1, "Uncertain launches must not be replayed");
    assert.equal(calls[0].args.file, sample); assert.equal(calls[0].args.exe, executable); assert.equal(calls[0].timeoutMs, 10000);
    assert.deepEqual(failed.resourceRefs, { caseRef: "cases:Synthetic.Gew2025" });
    assert.equal((await execute("desktop_start", { exe: executable }, 10000)).ok, false);
    assert.equal((await execute("desktop_start", { caseRef: "cases:../escape.Gew2025" }, 10000)).ok, false);
    assert.equal(calls.length, 1, "Resource and executable guards must precede native dispatch");
  } finally { rmSync(directory, { recursive: true, force: true }); }
}
