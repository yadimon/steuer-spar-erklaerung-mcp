import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

const temporary = mkdtempSync(join(tmpdir(), "sse-api-cleanup-contract-"));
const environment = { ...process.env };
for (const key of Object.keys(environment).filter(key => /^SSE_/iu.test(key))) delete environment[key];
delete environment.NODE_OPTIONS;
delete environment.NODE_V8_COVERAGE;

function removeOwnSandbox(path) {
  const target = resolve(path);
  assert.equal(dirname(target).toLowerCase(), resolve(tmpdir()).toLowerCase(), "Only a recorded direct temporary child may be removed.");
  assert.match(basename(target), /^sse-api-test-[a-zA-Z0-9]{6}$/u);
  rmSync(target, { recursive: true, force: true });
  assert.equal(existsSync(target), false);
}

function run(name, { code = 0, missing = false, removeFailure = false, serverFailure = false, serverThrow = false, traceFailure = false, preserve = false, blockFlush = false } = {}) {
  const capturePath = join(temporary, `${name}.jsonl`);
  const reportPath = join(temporary, `${name}.report.json`);
  const tracePath = `${reportPath}.execution.jsonl`;
  // The preloader affects only the actual wrapper. Its Node child does not
  // inherit --import, and no product operation or native worker is started.
  const preloader = [
    "import fs from 'node:fs';",
    "import http from 'node:http';",
    "import {syncBuiltinESMExports} from 'node:module';",
    `const capturePath=${JSON.stringify(capturePath)};`,
    `const tracePath=${JSON.stringify(tracePath)};`,
    "const record=value=>fs.appendFileSync(capturePath,JSON.stringify(value)+'\\n');",
    "const originalMkdtemp=fs.mkdtempSync;",
    "fs.mkdtempSync=(...args)=>{const path=originalMkdtemp(...args);record({phase:'created',path});return path;};",
    "const originalRemove=fs.rmSync;",
    `fs.rmSync=(path,...args)=>{record({phase:'sandbox',path});${removeFailure ? "throw Object.assign(new Error('synthetic-sandbox-failure'),{code:'EIO'});" : "return originalRemove(path,...args);"}};`,
    "const originalCloseServer=http.Server.prototype.close;",
    `http.Server.prototype.close=function(callback){record({phase:'http-server'});const result=originalCloseServer.call(this,error=>callback(${serverFailure ? "error??new Error('synthetic-http-server-failure')" : "error"}));${serverThrow ? "throw new Error('synthetic-http-server-throw');" : "return result;"}};`,
    "let traceDescriptor;",
    "const originalOpen=fs.openSync;",
    "fs.openSync=(path,...args)=>{const descriptor=originalOpen(path,...args);if(path===tracePath)traceDescriptor=descriptor;return descriptor;};",
    "const originalCloseFile=fs.closeSync;",
    `fs.closeSync=(descriptor)=>{const result=originalCloseFile(descriptor);if(descriptor===traceDescriptor){record({phase:'execution-log'});${traceFailure ? "throw new Error('synthetic-execution-log-failure');" : ""}}return result;};`,
    ...(blockFlush ? ["const originalWrite=process.stderr.write;process.stderr.write=function(chunk,...args){if(chunk===''){record({phase:'flush-blocked'});return true;}return originalWrite.call(this,chunk,...args);};"] : []),
    "syncBuiltinESMExports();",
  ].join("\n");
  const command = missing ? join(temporary, "deliberately-missing-command.exe") : process.execPath;
  const commandArgs = missing ? [] : ["-e", `process.exitCode=${code};`];
  const started = performance.now();
  const result = spawnSync(process.execPath, [
    "--import", "data:text/javascript," + encodeURIComponent(preloader),
    "test/with-api.mjs", command, ...commandArgs,
  ], {
    cwd: process.cwd(),
    env: { ...environment, SSE_MEGA_RAW_REPORT: reportPath, SSE_PRESERVE_TEST_SANDBOX_ON_FAILURE: preserve ? "1" : "0" },
    encoding: "utf8", windowsHide: true, timeout: 15_000, maxBuffer: 1024 * 1024,
  });
  const captures = readFileSync(capturePath, "utf8").trim().split("\n").map(line => JSON.parse(line));
  const created = captures.filter(entry => entry.phase === "created");
  assert.equal(created.length, 1, `${name}: exactly one owned wrapper sandbox is required`);
  const sandbox = created[0].path;
  const retained = existsSync(sandbox);
  try {
    assert.equal(result.error, undefined, `${name}: wrapper must finish without timeout or driver error`);
    assert.equal(result.signal, null, `${name}: wrapper must finish normally`);
    assert.deepEqual(captures.map(entry => entry.phase), [
      "created", "http-server", "execution-log", ...((preserve && (code !== 0 || missing || serverFailure || serverThrow || traceFailure)) ? [] : ["sandbox"]), ...(blockFlush ? ["flush-blocked"] : []),
    ], `${name}: later independent cleanup phases must run exactly once`);
    const failed = missing || code !== 0 || removeFailure || serverFailure || serverThrow || traceFailure;
    assert.equal(result.status, code !== 0 ? code : failed ? 1 : 0, `${name}: preserve original child exit status`);
    assert.equal(retained, preserve && failed || removeFailure, `${name}: sandbox finalization must account for test and cleanup failures`);
    assert.equal(result.stderr.includes("Test-Sandbox zur Diagnose erhalten:"), preserve && failed);
    assert.equal(result.stderr.includes("Test-Cleanup fehlgeschlagen [http-server]:"), serverFailure || serverThrow);
    assert.equal(result.stderr.includes("Test-Cleanup fehlgeschlagen [execution-log]:"), traceFailure);
    assert.equal(result.stderr.includes("Test-Cleanup fehlgeschlagen [sandbox]:"), removeFailure);
    const primary = missing ? "ENOENT" : code !== 0 ? `Exit-Code ${code}` : null;
    if (primary) {
      assert(result.stderr.includes(primary), `${name}: original child failure must remain visible`);
      const secondaryIndex = result.stderr.indexOf("Test-Cleanup fehlgeschlagen");
      assert(result.stderr.indexOf(primary) < (secondaryIndex === -1 ? Infinity : secondaryIndex), `${name}: primary failure must precede secondary cleanup errors`);
    }
    if (blockFlush) assert(performance.now() - started >= 4_500, `${name}: the diagnostic watchdog must remain referenced without native handles`);
    return result;
  } finally {
    removeOwnSandbox(sandbox);
  }
}

function runLifecycle(name, { code = 23, missing = false, nativeFailure = false, prewarmFailure = false, traceFailure = false, blockFlush = false } = {}) {
  const lifecycleTemporary = mkdtempSync(join(temporary, `${name}-`));
  const capturePath = join(temporary, `${name}.jsonl`), reportPath = join(temporary, `${name}.report.json`);
  const tracePath = `${reportPath}.execution.jsonl`, markerPath = join(lifecycleTemporary, "sse-mcp-desktop.txt");
  const nativeStub = [
    "import fs from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';",
    `const record=phase=>fs.appendFileSync(${JSON.stringify(capturePath)},JSON.stringify({phase})+'\\n');`,
    "export function createQtNativeRuntime(config,profile,signal){",
    "const marker=join(tmpdir(),'sse-mcp-desktop.txt');fs.writeFileSync(marker,'synthetic unproved owner',{flag:'wx'});record('native-created');",
    "signal.addEventListener('abort',()=>record('native-shutdown'));",
    "const unexpected=()=>{throw new Error('Native/product operations forbidden in lifecycle injection.');};",
    "return{client:unexpected,desktopStatus:unexpected,desktopStart:unexpected,desktopStop:unexpected,beforeWorker:unexpected,afterWorker:unexpected,",
    `close(){record('native-runtime');${nativeFailure ? "setInterval(()=>{},1000);throw Object.assign(new Error('synthetic native retirement unproved'),{kind:'native-retirement-unproven'});" : "fs.unlinkSync(marker);"}}};}`,
  ].join("\n");
  const prewarmStub = [
    "import fs from 'node:fs';",
    `const record=phase=>fs.appendFileSync(${JSON.stringify(capturePath)},JSON.stringify({phase})+'\\n');`,
    "export const enableWorkerPrewarm=()=>record('prewarm-enable');export const isWarmSpareReady=()=>true;",
    "export const lastPrewarmFailure=()=>null;export const prewarmStartupTimeoutMs=()=>1000;",
    `export const shutdownWarmSpare=()=>{record('worker-prewarm');${prewarmFailure ? "setInterval(()=>{},1000);throw new Error('synthetic prewarm shutdown failure');" : ""}};`,
    "export const warmSparePoolStatus=()=>({ready:1,starting:0,target:1});",
    "export const ensureWarmSpare=()=>{throw new Error('Real workers forbidden.');};export const takeWarmSpare=()=>{throw new Error('Real workers forbidden.');};",
  ].join("\n");
  const preloader = [
    "import fs from 'node:fs';import http from 'node:http';import {registerHooks,syncBuiltinESMExports} from 'node:module';",
    `const tracePath=${JSON.stringify(tracePath)};const record=value=>fs.appendFileSync(${JSON.stringify(capturePath)},JSON.stringify(value)+'\\n');`,
    "const originalMkdtemp=fs.mkdtempSync;fs.mkdtempSync=(...args)=>{const path=originalMkdtemp(...args);record({phase:'created',path});return path;};",
    "const originalRemove=fs.rmSync;fs.rmSync=(path,...args)=>{record({phase:'sandbox',path});return originalRemove(path,...args);};",
    "const originalCloseServer=http.Server.prototype.close;http.Server.prototype.close=function(callback){record({phase:'http-server'});return originalCloseServer.call(this,callback);};",
    "let traceDescriptor;const originalOpen=fs.openSync;fs.openSync=(path,...args)=>{const descriptor=originalOpen(path,...args);if(path===tracePath)traceDescriptor=descriptor;return descriptor;};",
    `const originalCloseFile=fs.closeSync;fs.closeSync=(descriptor)=>{const result=originalCloseFile(descriptor);if(descriptor===traceDescriptor){record({phase:'execution-log'});${traceFailure ? "throw new Error('synthetic trace close failure');" : ""}}return result;};`,
    `registerHooks({load(url,context,nextLoad){if(url.endsWith('/dist/qt-native-runtime.js'))return{format:'module',source:${JSON.stringify(nativeStub)},shortCircuit:true};if(url.endsWith('/dist/worker-prewarm.js'))return{format:'module',source:${JSON.stringify(prewarmStub)},shortCircuit:true};return nextLoad(url,context);}});`,
    ...(blockFlush ? ["const originalWrite=process.stderr.write;process.stderr.write=function(chunk,...args){if(chunk===''){record({phase:'flush-blocked'});return true;}return originalWrite.call(this,chunk,...args);};"] : []),
    "syncBuiltinESMExports();",
  ].join("\n");
  const command = missing ? join(lifecycleTemporary, "deliberately-missing-command.exe") : process.execPath;
  const commandArgs = missing ? [] : ["-e", `process.exitCode=${code};`];
  const started = performance.now();
  const result = spawnSync(process.execPath, ["--import", "data:text/javascript," + encodeURIComponent(preloader), "test/with-api.mjs", command, ...commandArgs], {
    cwd: process.cwd(), env: { ...environment, TEMP: lifecycleTemporary, TMP: lifecycleTemporary,
      SSE_TEST_NATIVE_PACKAGE: lifecycleTemporary, SSE_TEST_NATIVE_MANIFEST_SHA256: "0".repeat(64), SSE_TEST_API_PREWARM: "1", SSE_MEGA_RAW_REPORT: reportPath },
    encoding: "utf8", windowsHide: true, timeout: 15_000, maxBuffer: 1024 * 1024,
  });
  const elapsedMs = performance.now() - started;
  const captures = readFileSync(capturePath, "utf8").trim().split("\n").map(line => JSON.parse(line));
  const created = captures.filter(entry => entry.phase === "created");
  assert.equal(created.length, 1, `${name}: one own sandbox required`);
  const sandbox = resolve(created[0].path);
  assert.equal(dirname(sandbox).toLowerCase(), resolve(lifecycleTemporary).toLowerCase());
  assert.match(basename(sandbox), /^sse-api-test-[a-zA-Z0-9]{6}$/u);
  try {
    assert.equal(result.error, undefined, `${name}: cleanup must finish inside the subprocess deadline`);
    assert.equal(result.signal, null);
    assert.equal(result.status, missing ? 1 : code || (nativeFailure || prewarmFailure || traceFailure ? 1 : 0));
    assert.deepEqual(captures.map(entry => entry.phase), ["created", "native-created", "prewarm-enable", "http-server", "native-shutdown", "native-runtime", "worker-prewarm", "execution-log",
      ...(nativeFailure ? [] : ["sandbox"]), ...(blockFlush ? ["flush-blocked"] : [])]);
    assert.equal(existsSync(sandbox), nativeFailure, `${name}: uncertain native ownership must retain the sandbox automatically`);
    assert.equal(existsSync(markerPath), nativeFailure, `${name}: the wrapper must not erase the unproved marker`);
    if (nativeFailure) assert.equal(readFileSync(markerPath, "utf8"), "synthetic unproved owner");
    assert.equal(result.stderr.includes("Test-Sandbox zur Diagnose erhalten:"), nativeFailure);
    const cleanupPhases = [...result.stderr.matchAll(/^Test-Cleanup fehlgeschlagen \[([^\]]+)\]:/gmu)].map(match => match[1]);
    assert.deepEqual(cleanupPhases, [...(nativeFailure ? ["native-runtime"] : []), ...(prewarmFailure ? ["worker-prewarm"] : []), ...(traceFailure ? ["execution-log"] : [])]);
    const primary = missing ? "ENOENT" : code !== 0 ? `Exit-Code ${code}` : null;
    if (primary) {
      assert(result.stderr.includes(primary));
      const secondaryIndex = result.stderr.indexOf("Test-Cleanup fehlgeschlagen");
      assert(result.stderr.indexOf(primary) < (secondaryIndex === -1 ? Infinity : secondaryIndex));
    }
    if (blockFlush) assert(elapsedMs >= 4_500 && elapsedMs < 14_000, `${name}: bounded diagnostics watchdog must terminate its own wrapper`);
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
}

function runPendingOrStartup(name, { pending, startup, code = 23, holdHandle = true } = {}) {
  const lifecycleTemporary = mkdtempSync(join(temporary, `${name}-`));
  const capturePath = join(temporary, `${name}.jsonl`), markerPath = join(lifecycleTemporary, "sse-mcp-desktop.txt");
  const recordSource = `import fs from 'node:fs';const record=phase=>fs.appendFileSync(${JSON.stringify(capturePath)},JSON.stringify({phase})+'\\n');`;
  const hangSource = `const hang=()=>{${holdHandle ? "setInterval(()=>{},1000);" : ""}return new Promise(()=>{});};`;
  const nativeStub = [recordSource, hangSource,
    "export function createQtNativeRuntime(config,profile,signal){record('native-create');",
    startup === "native" ? "throw new Error('synthetic-startup-native');" : "",
    `fs.writeFileSync(${JSON.stringify(markerPath)},'synthetic unproved owner',{flag:'wx'});`,
    "signal.addEventListener('abort',()=>record('native-shutdown'));",
    "const unexpected=()=>{throw new Error('Product operations forbidden.');};",
    "return{client:unexpected,desktopStatus:unexpected,desktopStart:unexpected,desktopStop:unexpected,beforeWorker:unexpected,afterWorker:unexpected,",
    "close(){record('native-runtime');",
    pending === "native-runtime" ? "return hang();" : `fs.unlinkSync(${JSON.stringify(markerPath)});`,
    "}};}",
  ].join("\n");
  const prewarmStub = [recordSource, hangSource,
    "export const enableWorkerPrewarm=()=>{record('prewarm-enable');",
    startup === "prewarm" ? "throw new Error('synthetic-startup-prewarm');" : "",
    "};export const isWarmSpareReady=()=>true;export const lastPrewarmFailure=()=>null;export const prewarmStartupTimeoutMs=()=>1000;",
    "export const warmSparePoolStatus=()=>({target:1});export const ensureWarmSpare=()=>{};export const takeWarmSpare=()=>null;",
    "export const shutdownWarmSpare=()=>{record('worker-prewarm');",
    pending === "worker-prewarm" ? "return hang();" : "",
    "};",
  ].join("\n");
  const traceStub = [recordSource, hangSource, "export const createExecutionTraceLog=()=>({record(){},close(){record('execution-log');",
    pending === "execution-log" ? "return hang();" : "", "}});"].join("\n");
  const sandboxStub = [recordSource, hangSource, "export const removeDirectoryWhenFree=()=>{record('sandbox');return hang();};"].join("\n");
  const source = [
    "import fs from 'node:fs';import http from 'node:http';import {registerHooks,syncBuiltinESMExports} from 'node:module';",
    `const pending=${JSON.stringify(pending ?? null)},startup=${JSON.stringify(startup ?? null)};`,
    `const record=value=>fs.appendFileSync(${JSON.stringify(capturePath)},JSON.stringify(value)+'\\n');`,
    hangSource,
    "const originalMkdtemp=fs.mkdtempSync;fs.mkdtempSync=(...args)=>{const path=originalMkdtemp(...args);record({phase:'created',path});return path;};",
    "const originalMkdir=fs.mkdirSync;fs.mkdirSync=(path,...args)=>{if(startup==='mkdir'&&path.endsWith('workspace'))throw new Error('synthetic-startup-mkdir');return originalMkdir(path,...args);};",
    "const originalRemove=fs.rmSync;fs.rmSync=(path,...args)=>{record({phase:'sandbox',path});return originalRemove(path,...args);};",
    "const originalClose=http.Server.prototype.close;http.Server.prototype.close=function(callback){record({phase:'http-server'});if(pending==='http-server'){originalClose.call(this,()=>{});hang();return this;}return originalClose.call(this,callback);};",
    "const originalListen=http.Server.prototype.listen;http.Server.prototype.listen=function(...args){if(startup==='listen')throw new Error('synthetic-startup-listen');return originalListen.apply(this,args);};",
    ...(pending === "native-shutdown" ? ["const OriginalAbortController=globalThis.AbortController;globalThis.AbortController=class extends OriginalAbortController{abort(...args){super.abort(...args);return hang();}};"] : []),
    `registerHooks({load(url,context,next){if(url.endsWith('/dist/qt-native-runtime.js'))return{format:'module',source:${JSON.stringify(nativeStub)},shortCircuit:true};if(url.endsWith('/dist/worker-prewarm.js'))return{format:'module',source:${JSON.stringify(prewarmStub)},shortCircuit:true};if(url.endsWith('/test/execution-trace-log.mjs'))return{format:'module',source:${JSON.stringify(traceStub)},shortCircuit:true};${pending === "sandbox" ? `if(url.endsWith('/test/remove-when-free.mjs'))return{format:'module',source:${JSON.stringify(sandboxStub)},shortCircuit:true};` : ""}return next(url,context);}});`,
    "syncBuiltinESMExports();",
  ].join("\n");
  const started = performance.now();
  const result = spawnSync(process.execPath, ["--import", "data:text/javascript," + encodeURIComponent(source), "test/with-api.mjs", process.execPath, "-e", `process.exitCode=${code};`], {
    cwd: process.cwd(), env: { ...environment, TEMP: lifecycleTemporary, TMP: lifecycleTemporary,
      SSE_TEST_NATIVE_PACKAGE: lifecycleTemporary, SSE_TEST_NATIVE_MANIFEST_SHA256: "0".repeat(64), SSE_TEST_API_PREWARM: "1", SSE_MEGA_RAW_REPORT: join(temporary, `${name}.report.json`) },
    encoding: "utf8", windowsHide: true, timeout: 25_000, maxBuffer: 1024 * 1024,
  });
  const captures = readFileSync(capturePath, "utf8").trim().split("\n").map(line => JSON.parse(line));
  const created = captures.find(entry => entry.phase === "created");
  assert(created, `${name}: wrapper must record its owned sandbox`);
  const sandbox = resolve(created.path);
  assert.equal(dirname(sandbox).toLowerCase(), resolve(lifecycleTemporary).toLowerCase());
  assert.match(basename(sandbox), /^sse-api-test-[a-zA-Z0-9]{6}$/u);
  try {
    assert.equal(result.error, undefined, `${name}: wrapper must bound unresolved cleanup (${result.stderr})`);
    assert.equal(result.signal, null);
    assert.equal(result.status, startup ? 1 : code || 1);
    assert.doesNotThrow(() => process.kill(peer.pid, 0), `${name}: unrelated peer must remain alive after wrapper shutdown`);
    const phases = captures.map(entry => entry.phase);
    const expected = startup === "mkdir" ? ["created", "sandbox"] : ["created", "native-create",
      ...(startup === "native" ? [] : [...(startup === "listen" ? [] : ["prewarm-enable"]), "http-server", "native-shutdown", "native-runtime", ...(startup === "listen" ? [] : ["worker-prewarm"])]),
      "execution-log", ...(pending === "native-runtime" ? [] : ["sandbox"])];
    assert.deepEqual(phases, expected, `${name}: release every acquired independent resource exactly once`);
    assert.equal(existsSync(markerPath), pending === "native-runtime");
    assert.equal(existsSync(sandbox), pending === "native-runtime" || pending === "sandbox");
    assert.equal(result.stderr.includes("Test-Sandbox zur Diagnose erhalten:"), pending === "native-runtime");
    if (pending) {
      assert(result.stderr.includes(`Test-Cleanup fehlgeschlagen [${pending}]:`));
      assert(result.stderr.includes("cleanup-timeout"), `${name}: deadline reason must identify unresolved completion`);
      assert(performance.now() - started >= (pending === "sandbox" ? 14_500 : 5_500), `${name}: the cleanup deadline must remain referenced without relying on a resource handle`);
      const primary = startup ? `synthetic-startup-${startup}` : code ? `Exit-Code ${code}` : null;
      if (primary) assert(result.stderr.indexOf(primary) >= 0 && result.stderr.indexOf(primary) < result.stderr.indexOf("Test-Cleanup fehlgeschlagen"));
    } else assert(result.stderr.includes(`synthetic-startup-${startup}`), `${name}: preserve original startup error`);
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
}


const peer = spawn(process.execPath, ["-e", "setInterval(()=>{},1000);"], { stdio: "ignore", windowsHide: true });
assert(Number.isSafeInteger(peer.pid) && peer.pid > 0, "The independent peer subprocess must have an owned PID.");
peer.on("error", error => { throw error; });
try {
  runPendingOrStartup("pending-http-close", { pending: "http-server" });
  runPendingOrStartup("pending-http-without-handles", { pending: "http-server", code: 0, holdHandle: false });
  runPendingOrStartup("pending-shutdown", { pending: "native-shutdown" });
  runPendingOrStartup("pending-native-close", { pending: "native-runtime" });
  runPendingOrStartup("pending-native-after-success", { pending: "native-runtime", code: 0 });
  runPendingOrStartup("pending-prewarm-close", { pending: "worker-prewarm" });
  runPendingOrStartup("pending-trace-close", { pending: "execution-log" });
  runPendingOrStartup("pending-sandbox-cleanup", { pending: "sandbox" });
  runPendingOrStartup("startup-mkdir", { startup: "mkdir" });
  runPendingOrStartup("startup-native", { startup: "native" });
  runPendingOrStartup("startup-listen", { startup: "listen" });
  runPendingOrStartup("startup-prewarm", { startup: "prewarm" });
  runPendingOrStartup("startup-prewarm-with-pending-native", { startup: "prewarm", pending: "native-runtime" });
  runLifecycle("native-and-prewarm-failures", { nativeFailure: true, prewarmFailure: true, traceFailure: true });
  runLifecycle("native-failure-after-success", { code: 0, nativeFailure: true });
  runLifecycle("prewarm-failure", { prewarmFailure: true });
  runLifecycle("successful-native-cleanup");
  runLifecycle("native-failure-and-spawn-error", { missing: true, nativeFailure: true });
  runLifecycle("bounded-diagnostic-flush", { nativeFailure: true, blockFlush: true });
  const success = run("success");
  assert.equal(success.stderr, "");
  run("child-failure-and-cleanup", { code: 23, removeFailure: true });
  run("spawn-failure-and-cleanup", { missing: true, removeFailure: true });
  run("success-and-cleanup-failure", { removeFailure: true });
  run("independent-cleanup-failures", { serverFailure: true, traceFailure: true, removeFailure: true });
  run("synchronous-server-failure", { serverThrow: true, traceFailure: true, removeFailure: true });
  run("cleanup-failure-flush-no-handles", { code: 23, removeFailure: true, blockFlush: true });
  run("preserve-after-cleanup-failure", { serverFailure: true, traceFailure: true, preserve: true });
  run("preserve-after-child-failure", { code: 23, preserve: true });
  const preservedSuccess = run("successful-test-not-preserved", { preserve: true });
  assert.equal(preservedSuccess.stderr, "");
  assert.doesNotThrow(() => process.kill(peer.pid, 0), "Cleanup must not terminate the independent peer subprocess.");
  process.stdout.write("API test wrapper: bounded cleanup, startup failures, exact child status, independent peer and sandbox retention verified\n");
} finally {
  peer.kill();
  const target = resolve(temporary);
  assert.equal(dirname(target).toLowerCase(), resolve(tmpdir()).toLowerCase());
  assert.match(basename(target), /^sse-api-cleanup-contract-[a-zA-Z0-9]{6}$/u);
  rmSync(target, { recursive: true, force: true });
}
