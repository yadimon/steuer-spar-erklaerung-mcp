import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSE_API_OPERATIONS } from "../dist/api-contract.js";
import { SSE_MCP_TOOL_OPERATIONS } from "../dist/operation-catalog.js";

const repoRoot = process.cwd();
const bundle = resolve(repoRoot, "artifacts", "portable", "test-bundle");
const foreignBundle = resolve(repoRoot, "artifacts", "portable", `foreign-${process.pid}`);
try {
  mkdirSync(foreignBundle, { recursive: true });
  writeFileSync(join(foreignBundle, "sentinel.txt"), "fremd\n", "utf8");
  const refusedForeign = spawnSync(
    process.execPath,
    ["scripts/package-portable.mjs", "--output", `artifacts/portable/foreign-${process.pid}`],
    { cwd: repoRoot, encoding: "utf8", windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
  );
  assert.notEqual(refusedForeign.status, 0, "Portable-Build darf einen fremden Ausgabeordner nicht rekursiv ersetzen.");
  assert.equal(readFileSync(join(foreignBundle, "sentinel.txt"), "utf8"), "fremd\n");
} finally {
  rmSync(foreignBundle, { recursive: true, force: true });
}
const packaged = spawnSync(
  process.execPath,
  ["scripts/package-portable.mjs", "--output", "artifacts/portable/test-bundle"],
  { cwd: repoRoot, encoding: "utf8", windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
);
assert.equal(packaged.status, 0, `Portable-Paketierung scheiterte: ${packaged.stderr || packaged.stdout}`);

const portableNode = join(bundle, "runtime", "node.exe");
const apiMain = join(bundle, "dist", "api-main.js");
const apiCli = join(bundle, "dist", "api-cli.js");
const mcpMain = join(bundle, "dist", "index.js");
const setupMain = join(bundle, "dist", "setup-main.js");
const manifest = JSON.parse(readFileSync(join(bundle, "portable-manifest.json"), "utf8"));
assert.equal(manifest.platform, "win32");
assert.deepEqual(manifest.userInstalledRuntimes, []);
assert.equal(manifest.systemRequirements.windowsPowerShell.startsWith(">=5.1"), true);
assert.equal(manifest.bundledRuntimes.node.executableSha256.length, 64);
assert(existsSync(portableNode) && existsSync(join(bundle, "runtime", "LICENSE-node.txt")));
assert(existsSync(join(bundle, ".sse-portable-build.json")), "Portable-Paket besitzt keine Build-Eigentumsmarke.");
assert(!existsSync(join(bundle, "powershell", "akad-parse.py")), "Portable-Paket enthaelt weiterhin den Python-Parser.");
assert.equal(
  manifest.files.some((file) => file.path.startsWith("powershell/.sse-native-")),
  false,
  "Portable-Paket enthaelt ein natives Build-Temp-Artefakt.",
);
assert(!existsSync(join(bundle, "runtime", "npm.cmd")), "Portable Runtime darf npm nicht an Endnutzer ausliefern.");
assert(!existsSync(join(bundle, "node_modules", "typescript")), "Portable-Paket enthaelt eine Dev-Abhaengigkeit.");
assert(!existsSync(join(bundle, "node_modules", "@types", "node")), "Portable-Paket enthaelt @types/node.");
assert(existsSync(join(bundle, "profiles", "2025", "profile.json")), "Portable-Paket enthaelt das Produktprofil nicht.");
assert(existsSync(join(bundle, "profiles", "2025", "page-objects.json")), "Portable-Paket enthaelt die Page-Objects nicht.");
assert(existsSync(join(bundle, "skills", "steuer-spar-erklaerung", "SKILL.md")), "Portable-Paket enthaelt den Haupt-Skill nicht.");
assert(existsSync(join(bundle, "skills", "steuer-spar-erklaerung-setup", "SKILL.md")), "Portable-Paket enthaelt den Setup-Skill nicht.");
const setupCommand = readFileSync(join(bundle, "sse-setup.cmd"), "utf8");
assert(setupCommand.includes("dist\\setup-main.js") && setupCommand.includes("%*"));
for (const file of manifest.files) {
  const packagedPath = join(bundle, ...file.path.split("/"));
  assert(existsSync(packagedPath), `Manifest-Datei fehlt im Paket: ${file.path}`);
  const bytes = readFileSync(packagedPath);
  assert.equal(bytes.length, file.bytes, `Manifest-Groesse stimmt nicht: ${file.path}`);
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    file.sha256,
    `Manifest-SHA256 stimmt nicht: ${file.path}`,
  );
}

const reservePort = async () => {
  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const address = probe.address();
  assert(address && typeof address === "object");
  await new Promise((resolveClose) => probe.close(resolveClose));
  return address.port;
};

const temporary = mkdtempSync(join(tmpdir(), "sse-portable-test-"));
const workspaceDir = join(temporary, "workspace");
const resultDir = join(workspaceDir, "results");
const configPath = join(temporary, "config.json");
const token = "portable-package-token-with-at-least-24-characters";
mkdirSync(resultDir, { recursive: true });
const port = await reservePort();
writeFileSync(
  configPath,
  `${JSON.stringify({ host: "127.0.0.1", port, token, workspaceDir, resultDir }, null, 2)}\n`,
  "utf8",
);

const restrictedPath = join(process.env.SystemRoot ?? "C:\\Windows", "System32");
const portableEnv = {
  ...process.env,
  PATH: restrictedPath,
  SSE_API_URL: `http://127.0.0.1:${port}`,
  SSE_API_TOKEN: token,
};
const portableSetupHelp = spawnSync(
  portableNode,
  [setupMain, "--help"],
  { cwd: bundle, env: portableEnv, encoding: "utf8", windowsHide: true, maxBuffer: 1024 * 1024 },
);
assert.equal(portableSetupHelp.status, 0, `Portable Setup-Hilfe scheiterte: ${portableSetupHelp.stderr}`);
assert.match(portableSetupHelp.stdout, /steuer-spar-erklaerung-setup --help/);
assert(!portableSetupHelp.stdout.includes("Steuerjahr\/Produktprofil"));
const systemPowerShell = join(
  process.env.SystemRoot ?? "C:\\Windows",
  "System32",
  "WindowsPowerShell",
  "v1.0",
  "powershell.exe",
);
const bundledWorker = join(bundle, "powershell", "sse-worker.ps1");
const productInfo = (forceSource) => {
  const result = spawnSync(
    systemPowerShell,
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", bundledWorker, "-Op", "product_info"],
    {
      cwd: bundle,
      env: { ...portableEnv, ...(forceSource ? { SSE_MCP_FORCE_NATIVE_SOURCE: "1" } : {}) },
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
    },
  );
  assert.equal(result.status, 0, `Gebundelter PS5-Worker scheiterte: ${result.stderr || result.stdout}`);
  return JSON.parse(result.stdout);
};
const precompiled = productInfo(false);
assert.equal(precompiled.ok, true);
assert.equal(precompiled.workerInitializationMs.nativeInteropMode, "precompiled-dll");
assert.equal(precompiled.workerInitializationMs.nativeHashMatch, true);
assert.equal(precompiled.workerInitializationMs.nativeDllHashMatch, true);
const sourceFallback = productInfo(true);
assert.equal(sourceFallback.ok, true);
assert.equal(sourceFallback.workerInitializationMs.nativeInteropMode, "source-fallback");

const api = spawn(portableNode, [apiMain, "--config", configPath], {
  cwd: bundle,
  env: portableEnv,
  windowsHide: true,
  stdio: ["ignore", "ignore", "pipe"],
});
let apiError = "";
api.stderr.on("data", (chunk) => { apiError += chunk.toString("utf8"); });

let client;
try {
  let healthy = false;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/healthz`);
      healthy = response.ok;
      if (healthy) break;
    } catch {
      // Portable API startet noch.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  assert.equal(healthy, true, `Portable API wurde nicht gesund: ${apiError}`);

  const unauthorizedDiscovery = await fetch(`http://127.0.0.1:${port}/v1/operations`);
  assert.equal(unauthorizedDiscovery.status, 401, "Portable Discovery darf ohne Token nicht lesbar sein.");
  const portableDiscoveryResponse = await fetch(`http://127.0.0.1:${port}/v1/operations`, {
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(portableDiscoveryResponse.status, 200, "Portable API liefert den Discovery-Katalog nicht.");
  const portableDiscovery = await portableDiscoveryResponse.json();
  assert.deepEqual(portableDiscovery.operations, [...SSE_API_OPERATIONS]);
  assert.equal(Object.keys(portableDiscovery.argumentSchemas).length, SSE_API_OPERATIONS.length);

  const portableOpenApiResponse = await fetch(`http://127.0.0.1:${port}/v1/openapi.json`, {
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(portableOpenApiResponse.status, 200, "Portable API liefert den OpenAPI-Katalog nicht.");
  const portableOpenApi = await portableOpenApiResponse.json();
  assert.equal(portableOpenApi.openapi, "3.1.0");
  assert.equal(Object.keys(portableOpenApi.paths).length, SSE_API_OPERATIONS.length + 3);
  assert.equal(portableOpenApi.paths["/v1/operations/keys"], undefined);

  const portableCli = spawnSync(
    portableNode,
    [apiCli, "health", "--config", configPath],
    { cwd: bundle, env: portableEnv, encoding: "utf8", windowsHide: true, maxBuffer: 1024 * 1024 },
  );
  assert.equal(portableCli.status, 0, `Portable API-CLI scheiterte: ${portableCli.stderr}`);
  assert.equal(JSON.parse(portableCli.stdout).ok, true);

  const portableCliStdin = spawnSync(
    portableNode,
    [apiCli, "workspace_status", "--args-file", "-", "--config", configPath],
    {
      cwd: bundle,
      env: portableEnv,
      input: "{}",
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    },
  );
  assert.equal(portableCliStdin.status, 0, `Portable API-CLI-stdin scheiterte: ${portableCliStdin.stderr}`);
  assert.equal(JSON.parse(portableCliStdin.stdout).workspaceReady, true);

  client = new Client({ name: "sse-portable-package-test", version: "1.0.0" });
  await client.connect(new StdioClientTransport({
    command: portableNode,
    args: [mcpMain],
    env: portableEnv,
  }));
  const portableTools = (await client.listTools()).tools;
  assert.equal(portableTools.length, Object.keys(SSE_MCP_TOOL_OPERATIONS).length);
  assert.deepEqual(
    portableTools.map((tool) => tool.name).sort(),
    Object.keys(SSE_MCP_TOOL_OPERATIONS).sort(),
  );
  const response = await client.callTool({ name: "sse_workspace_status", arguments: {} });
  assert.notEqual(response.isError, true, JSON.stringify(response));
  const text = response.content.filter((entry) => entry.type === "text").map((entry) => entry.text).join("\n");
  const status = JSON.parse(text);
  assert.equal(status.workspaceReady, true);
  assert.equal(status.resultAreaReady, true);
} finally {
  if (client) await client.close();
  api.kill("SIGTERM");
  await once(api, "exit");
  rmSync(temporary, { recursive: true, force: true });
  rmSync(bundle, { recursive: true, force: true });
}

process.stdout.write("Portable-Paket: gebuendeltes Node, kein npm/Python und echter CLI/MCP/API-Start bestanden\n");
