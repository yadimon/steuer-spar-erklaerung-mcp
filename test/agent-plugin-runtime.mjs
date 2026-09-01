import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  rmdirSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

assert.equal(process.platform, "win32", "Die gebuendelte Produkt-Runtime ist ein Windows-Vertrag.");
assert.equal(process.arch, "x64", "Die gebuendelte Produkt-Runtime ist ein Windows-x64-Vertrag.");

const sourcePlugin = resolve("plugin", "steuer-spar-erklaerung");
const expectedVersion = JSON.parse(readFileSync("package.json", "utf8")).version;
const temporary = mkdtempSync(join(tmpdir(), "sse-agent-plugin-runtime-"));
const ownedPids = new Set();
let activeJunction;

async function freePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address === "object");
  await new Promise((resolveClose) => server.close(resolveClose));
  return address.port;
}

function configFor(name, port) {
  const path = resolve(temporary, `${name}.json`);
  writeFileSync(path, `${JSON.stringify({ profileId: "2025", host: "127.0.0.1", port }, null, 2)}\n`, "utf8");
  return path;
}

function isolatedPlugin(name, parent = temporary) {
  const destination = resolve(parent, name);
  cpSync(sourcePlugin, destination, { recursive: true, errorOnExist: true, force: false });
  return destination;
}

function installAncestorApi(hostRoot, bundledApiEntry, markerPath) {
  const packageRoot = join(hostRoot, "node_modules", "@yadimon", "steuer-spar-erklaerung-api");
  mkdirSync(join(packageRoot, "dist"), { recursive: true });
  writeFileSync(join(packageRoot, "package.json"), `${JSON.stringify({
    name: "@yadimon/steuer-spar-erklaerung-api",
    version: expectedVersion,
    type: "module",
    bin: { "steuer-spar-erklaerung-api": "dist/api.js" },
  }, null, 2)}\n`, "utf8");
  writeFileSync(join(packageRoot, "dist", "api.js"), [
    "import { writeFileSync } from \"node:fs\";",
    `writeFileSync(${JSON.stringify(markerPath)}, \"ancestor npm API selected\\n\", \"utf8\");`,
    `await import(${JSON.stringify(pathToFileURL(bundledApiEntry).href)});`,
    "",
  ].join("\n"), "utf8");
  return packageRoot;
}

function hasNodeModules(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === "node_modules") return true;
    if (entry.isDirectory() && hasNodeModules(join(directory, entry.name))) return true;
  }
  return false;
}

function isolatedEnvironment(configPath) {
  return {
    ...process.env,
    PATH: "",
    SSE_API_URL: "",
    SSE_API_CONFIG: configPath,
    npm_config_offline: "true",
    npm_config_registry: "http://127.0.0.1:1",
    NPM_CONFIG_AUDIT: "false",
    NPM_CONFIG_FUND: "false",
  };
}

async function health(port) {
  const response = await fetch(`http://127.0.0.1:${port}/healthz`);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.packageVersion, expectedVersion);
  assert(Number.isSafeInteger(payload.processId) && payload.processId > 0);
  return payload;
}

async function connect(pluginRoot, configPath) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(pluginRoot, "runtime", "dist", "mcp.js")],
    env: isolatedEnvironment(configPath),
  });
  const client = new Client({ name: "isolated-agent-plugin-test", version: "1.0.0" });
  await client.connect(transport);
  return client;
}

async function runSelftest(pluginRoot, configPath) {
  const child = spawn(process.execPath, [join(pluginRoot, "runtime", "dist", "mcp.js"), "--selftest"], {
    cwd: pluginRoot,
    env: isolatedEnvironment(configPath),
    windowsHide: true,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const [code, signal] = await once(child, "exit");
  return { code, signal, stdout, stderr };
}

function apiCommandLine(pid) {
  const script = [
    "$process = Get-CimInstance Win32_Process -Filter \"ProcessId=$env:SSE_TEST_PID\"",
    "if ($null -eq $process) { exit 3 }",
    "[Console]::Out.Write($process.CommandLine)",
  ].join("\n");
  const result = spawnSync("pwsh.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], {
    encoding: "utf8",
    windowsHide: true,
    env: { ...process.env, SSE_TEST_PID: String(pid) },
  });
  assert.equal(result.status, 0, `API-Prozesskommandozeile fuer PID ${pid} fehlt.`);
  return result.stdout;
}

function discoverTemporaryApiPids() {
  const script = [
    "$root = $env:SSE_TEST_ROOT",
    "$ids = @(Get-CimInstance Win32_Process | Where-Object {",
    "  $_.CommandLine -and $_.CommandLine.Contains($root) -and $_.CommandLine.Contains('api.js')",
    "} | Select-Object -ExpandProperty ProcessId)",
    "[Console]::Out.Write(($ids | ConvertTo-Json -Compress))",
  ].join("\n");
  const result = spawnSync("pwsh.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], {
    encoding: "utf8",
    windowsHide: true,
    env: { ...process.env, SSE_TEST_ROOT: temporary },
  });
  if (result.status !== 0 || !result.stdout.trim()) return [];
  try {
    const value = JSON.parse(result.stdout);
    return (Array.isArray(value) ? value : [value]).filter(Number.isSafeInteger);
  } catch {
    return [];
  }
}

try {
  const valid = isolatedPlugin("valid-plugin");
  assert(!hasNodeModules(valid), "Die ausgelieferte Plugin-Runtime darf kein node_modules benoetigen.");
  assert(!existsSync(join(dirname(valid), "node_modules")), "Die isolierte Testumgebung enthaelt unerwartet node_modules.");
  const port = await freePort();
  const config = configFor("valid", port);
  const first = await connect(valid, config);
  const listed = await first.listTools();
  assert(listed.tools.length >= 100, "Der isolierte MCP-Handshake stellte nicht den vollstaendigen Werkzeugkatalog bereit.");
  const firstHealth = await health(port);
  ownedPids.add(firstHealth.processId);
  const commandLine = apiCommandLine(firstHealth.processId);
  assert(commandLine.includes(join(valid, "runtime", "dist", "api.js")),
    "Der MCP-Supervisor startete nicht den benachbarten hashgebundenen Plugin-API-Einstieg.");
  assert.doesNotMatch(commandLine, /\b(?:npm|npx|pnpm|yarn)(?:\.cmd)?\b/iu,
    "Der Plugin-Kaltstart verwendete einen Paketmanager.");
  await first.close();

  const second = await connect(valid, config);
  const reused = await health(port);
  assert.equal(reused.processId, firstHealth.processId, "Die isolierte Plugin-Runtime ersetzte den API-Singleton.");
  await second.close();

  const ancestorHost = resolve(temporary, "ancestor-host");
  const ancestorPlugins = join(ancestorHost, "plugins");
  mkdirSync(ancestorPlugins, { recursive: true });
  const ancestorValid = isolatedPlugin("valid-plugin", ancestorPlugins);
  const ancestorMarker = join(ancestorHost, "ancestor-api-selected.txt");
  const ancestorPackage = installAncestorApi(
    ancestorHost,
    join(ancestorValid, "runtime", "dist", "api.js"),
    ancestorMarker,
  );
  const requireFromPlugin = createRequire(pathToFileURL(join(ancestorValid, "runtime", "dist", "mcp.js")));
  assert.equal(
    requireFromPlugin.resolve("@yadimon/steuer-spar-erklaerung-api/package.json"),
    join(ancestorPackage, "package.json"),
    "Die ancestor-node_modules-Regression stellt kein tatsaechlich aufloesbares API-Paket bereit.",
  );
  const ancestorPort = await freePort();
  const ancestorConfig = configFor("ancestor-valid", ancestorPort);
  const ancestorClient = await connect(ancestorValid, ancestorConfig);
  const ancestorHealth = await health(ancestorPort);
  ownedPids.add(ancestorHealth.processId);
  assert(apiCommandLine(ancestorHealth.processId).includes(join(ancestorValid, "runtime", "dist", "api.js")),
    "Ein ancestor node_modules verdraengte den benachbarten Plugin-API-Einstieg.");
  assert(!existsSync(ancestorMarker), "Die aufloesbare ancestor-npm-API wurde trotz Runtime-Lock ausgefuehrt.");
  await ancestorClient.close();

  const invalidAdjacent = isolatedPlugin("invalid-lock-plugin", ancestorPlugins);
  writeFileSync(join(invalidAdjacent, "runtime", "runtime-lock.json"), "{ kein json }\n", "utf8");
  const invalidAdjacentPort = await freePort();
  const invalidAdjacentResult = await runSelftest(
    invalidAdjacent,
    configFor("ancestor-invalid-lock", invalidAdjacentPort),
  );
  assert.equal(invalidAdjacentResult.code, 1);
  assert.equal(invalidAdjacentResult.stdout, "", "Ungueltiges benachbartes Lock verschmutzte MCP-stdout.");
  assert.match(invalidAdjacentResult.stderr, /Runtime-Lock/iu);
  assert(!existsSync(ancestorMarker),
    "Ein ungueltiges benachbartes Runtime-Lock fiel auf die ancestor-npm-API zurueck.");

  const tampered = isolatedPlugin("tampered-plugin");
  appendFileSync(join(tampered, "runtime", "dist", "api.js"), "\n// tampered\n", "utf8");
  const tamperedPort = await freePort();
  const tamperedResult = await runSelftest(tampered, configFor("tampered", tamperedPort));
  assert.equal(tamperedResult.code, 1);
  assert.equal(tamperedResult.signal, null);
  assert.equal(tamperedResult.stdout, "", "Integritaetsfehler verschmutzte MCP-stdout.");
  assert.match(tamperedResult.stderr, /Runtime-Lock/iu);
  await assert.rejects(fetch(`http://127.0.0.1:${tamperedPort}/healthz`),
    "Eine hashinkompatible Plugin-API wurde trotzdem gestartet.");

  const escaping = isolatedPlugin("escaping-plugin");
  const escapingLockPath = join(escaping, "runtime", "runtime-lock.json");
  const escapingLock = JSON.parse(readFileSync(escapingLockPath, "utf8"));
  escapingLock.entries.api = "../outside.js";
  writeFileSync(escapingLockPath, `${JSON.stringify(escapingLock, null, 2)}\n`, "utf8");
  const escapingPort = await freePort();
  const escapingResult = await runSelftest(escaping, configFor("escaping", escapingPort));
  assert.equal(escapingResult.code, 1);
  assert.equal(escapingResult.stdout, "", "Containment-Fehler verschmutzte MCP-stdout.");
  assert.match(escapingResult.stderr, /sicheren Einstieg/iu);

  const wrongVersion = isolatedPlugin("wrong-version-plugin");
  const wrongLockPath = join(wrongVersion, "runtime", "runtime-lock.json");
  const wrongLock = JSON.parse(readFileSync(wrongLockPath, "utf8"));
  wrongLock.pluginVersion = "0.1.0-beta.1";
  writeFileSync(wrongLockPath, `${JSON.stringify(wrongLock, null, 2)}\n`, "utf8");
  const wrongVersionPort = await freePort();
  const wrongVersionResult = await runSelftest(wrongVersion, configFor("wrong-version", wrongVersionPort));
  assert.equal(wrongVersionResult.code, 1);
  assert.equal(wrongVersionResult.stdout, "", "Versionsfehler verschmutzte MCP-stdout.");
  assert.match(wrongVersionResult.stderr, /nicht versionsgleich/iu);

  const junctionPlugin = isolatedPlugin("junction-plugin");
  const junctionDist = join(junctionPlugin, "runtime", "dist");
  const outsideDist = join(temporary, "outside-runtime-dist");
  renameSync(junctionDist, outsideDist);
  symlinkSync(outsideDist, junctionDist, "junction");
  activeJunction = junctionDist;
  const junctionPort = await freePort();
  const junctionResult = await runSelftest(junctionPlugin, configFor("junction", junctionPort));
  assert.equal(junctionResult.code, 1);
  assert.equal(junctionResult.stdout, "", "Junction-Containment-Fehler verschmutzte MCP-stdout.");
  assert.match(
    junctionResult.stderr,
    /(?:nicht sicher enthalten|kein sicher gebundenes Runtime-Lock|keine Plugin-Runtime gebunden)/iu,
  );
  rmdirSync(junctionDist);
  activeJunction = undefined;

  process.stdout.write(
    "Agent-Plugin-Runtime: isolierter MCP-Handshake, Lock-Prioritaet vor ancestor node_modules, API-Autostart ohne Paketmanager, Singleton sowie Hash-, Junction-/Containment- und Versions-Fail-closed bestanden\n",
  );
} finally {
  for (const pid of new Set([...ownedPids, ...discoverTemporaryApiPids()])) {
    spawnSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
  }
  if (activeJunction && existsSync(activeJunction)) rmdirSync(activeJunction);
  rmSync(resolve(temporary), { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
}
