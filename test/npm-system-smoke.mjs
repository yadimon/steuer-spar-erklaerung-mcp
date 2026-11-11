/** Real installed MCP/API smoke; no production modules are imported from source. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { removeDirectoryWhenFree } from "./remove-when-free.mjs";

const mcpName = "@yadimon/steuer-spar-erklaerung-mcp";
const apiName = "@yadimon/steuer-spar-erklaerung-api";
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex").toUpperCase();

function syntheticCase() {
  const integer = value => { const bytes = Buffer.alloc(4); bytes.writeUInt32LE(value); return bytes; };
  const text = (name, value) => {
    const key = Buffer.from(`${name}\0`), data = Buffer.from(`${value}\0`);
    return Buffer.concat([integer(key.length), key, Buffer.from([4]), integer(data.length), data]);
  };
  const uuid = Buffer.from("12345678-1234-1234-1234-123456789abc\0");
  return Buffer.concat([Buffer.from("AKAD"), Buffer.alloc(8), integer(uuid.length), uuid,
    Buffer.from("FIIF"), text("FileType", "Gew"), text("VJahr", "2025"),
    text("Steuernummer", "synthetic-smoke"), text("ElsterTransferTime", "")]);
}

async function freePort() {
  const server = createServer();
  await new Promise((done, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", done); });
  const port = server.address().port;
  await new Promise((done, reject) => server.close(error => error ? reject(error) : done()));
  return port;
}

export async function runInstalledSystemSmoke({ installRoot, temporary, expectedVersion }) {
  const mcpRoot = join(installRoot, "node_modules", "@yadimon", "steuer-spar-erklaerung-mcp");
  const apiRoot = join(installRoot, "node_modules", "@yadimon", "steuer-spar-erklaerung-api");
  const manifest = JSON.parse(readFileSync(join(mcpRoot, "package.json"), "utf8"));
  const apiManifest = JSON.parse(readFileSync(join(apiRoot, "package.json"), "utf8"));
  assert.equal(manifest.name, mcpName);
  assert.equal(apiManifest.name, apiName);
  assert.equal(manifest.version, apiManifest.version);
  assert.equal(manifest.dependencies[apiName], apiManifest.version);
  assert.equal(manifest.version, expectedVersion);
  const sandbox = join(temporary, "system-smoke");
  mkdirSync(sandbox);
  const config = { host: "127.0.0.1", port: await freePort(), profileId: "2025" };
  for (const [key, directory] of Object.entries({ caseDir: "cases", documentsDir: "documents",
    workspaceDir: "workspace", resultDir: "results", backupsDir: "backups" })) {
    config[key] = join(sandbox, directory);
    mkdirSync(config[key]);
  }
  const configPath = join(sandbox, "api.json");
  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
  const env = { ...process.env };
  for (const key of Object.keys(env).filter(key => key.startsWith("SSE_"))) delete env[key];
  env.SSE_API_CONFIG = configPath;
  const transport = new StdioClientTransport({ command: process.execPath,
    args: [join(mcpRoot, "dist", "index.js")], cwd: installRoot, env, stderr: "pipe" });
  let diagnostic = "", connected = false, instanceId, shutdownAttempted = false, calls = 0;
  transport.stderr.on("data", chunk => { diagnostic = (diagnostic + chunk).slice(-64 * 1024); });
  const client = new Client({ name: "npm-system-smoke", version: "1.0.0" });
  async function call(name, args = {}, expectSuccess = true) {
    const raw = await client.callTool({ name, arguments: args }, undefined, { timeout: 120_000 });
    calls += 1;
    const result = raw.structuredContent;
    assert(result && typeof result === "object", `${name}: structuredContent is missing: ${JSON.stringify(raw).slice(0, 4000)}`);
    assert.equal(result.ok, expectSuccess, `${name}: ${JSON.stringify(result)}`);
    return result;
  }
  async function stopOwnApi() {
    const fresh = await call("sse_api_control", { action: "status" });
    assert.equal(fresh.instanceId, instanceId, "The owned API instance changed; do not stop another process.");
    shutdownAttempted = true;
    const stopped = await call("sse_api_control", { action: "shutdown", confirm: true, instanceId });
    assert.equal(stopped.processExited, true);
    assert.equal(stopped.state, "stopped");
  }
  try {
    await client.connect(transport);
    connected = true;
    const status = await call("sse_api_control", { action: "status" });
    instanceId = status.instanceId;
    assert.equal(status.state, "running");
    assert.equal(typeof instanceId, "string");
    const response = await fetch(`http://127.0.0.1:${config.port}/healthz`, { signal: AbortSignal.timeout(10_000) });
    assert.equal(response.status, 200);
    const health = await response.json();
    assert.equal(health.instanceId, instanceId);
    assert.equal(health.processId, status.processId);
    assert.equal(health.packageName, apiName);
    assert.equal(health.packageVersion, expectedVersion);
    const preflight = await call("sse_preflight");
    assert.equal(preflight.workspace.ready, true);
    const catalog = (await client.listTools()).tools;
    const names = new Set(catalog.map(tool => tool.name));
    assert.equal(names.size, catalog.length);
    for (const tool of catalog) {
      assert(tool.name.startsWith("sse_") && tool.description && tool.inputSchema && tool.outputSchema,
        "Every installed tool must expose its complete metadata.");
    }
    for (const name of ["sse_preflight", "sse_instances", "sse_case_hash", "sse_make_working_copy",
      "sse_workspace_write_text", "sse_workspace_read_text", "sse_workspace_files", "sse_api_control"]) {
      assert(names.has(name), `Required installed tool is missing: ${name}`);
    }
    assert.equal((await call("sse_instances")).count, 0, "Close SSE before this smoke; no user case is touched.");
    const payload = "Synthetic npm smoke: äöü\n";
    const written = await call("sse_workspace_write_text", { ref: "workspace:smoke.txt", text: payload });
    const read = await call("sse_workspace_read_text", { ref: "workspace:smoke.txt" });
    assert.equal(read.text, payload);
    assert.equal(read.sha256, written.sha256);
    assert.equal(sha256(readFileSync(join(config.workspaceDir, "smoke.txt"))), sha256(Buffer.from(payload)));
    assert.equal((await call("sse_workspace_write_text", { ref: "workspace:smoke.txt", text: "replace" }, false)).ok, false);
    assert.equal(readFileSync(join(config.workspaceDir, "smoke.txt"), "utf8"), payload);
    const bytes = syntheticCase(), expectedHash = sha256(bytes);
    const source = join(config.caseDir, "smoke.Gew2025");
    writeFileSync(source, bytes, { flag: "wx" });
    assert.equal((await call("sse_list_cases")).count, 1);
    assert.equal((await call("sse_case_hash", { ref: "cases:smoke.Gew2025" })).sha256, expectedHash);
    const copy = await call("sse_make_working_copy", { sourceRef: "cases:smoke.Gew2025",
      targetRef: "backups:smoke.Gew2025", expectedSourceHash: expectedHash });
    assert.equal(copy.verified, true);
    assert.equal(copy.targetHash, expectedHash);
    assert.equal(sha256(readFileSync(join(config.backupsDir, "smoke.Gew2025"))), expectedHash);
    const rejected = await call("sse_make_working_copy", { sourceRef: "cases:smoke.Gew2025",
      targetRef: "backups:rejected.Gew2025", expectedSourceHash: "0".repeat(64) }, false);
    assert.equal(rejected.kind, "precondition-failed");
    assert.equal(existsSync(join(config.backupsDir, "rejected.Gew2025")), false);
    assert.equal(sha256(readFileSync(source)), expectedHash);
    const inventory = await call("sse_workspace_files", { ref: "backups:." });
    const listedCopy = inventory.files.find(file => file.ref === "backups:smoke.Gew2025");
    assert(listedCopy && typeof listedCopy.sha256 === "string");
    assert.equal(listedCopy.sha256.toUpperCase(), expectedHash);
    await stopOwnApi();
    return { version: expectedVersion, tools: catalog.length, calls, filesVerified: 3, apiStopped: true };
  } finally {
    try { if (connected && instanceId && !shutdownAttempted) await stopOwnApi(); }
    finally {
      await client.close();
      writeFileSync(join(sandbox, "mcp-stderr.txt"), diagnostic);
    }
  }
}

async function main() {
  assert(process.platform === "win32" && process.arch === "x64", "The package smoke requires Windows x64.");
  const args = process.argv.slice(2);
  assert(args.length === 0 || args.length === 2 && args[0] === "--version", "Usage: npm run smoke:npm -- [--version latest|VERSION]");
  const version = args[1] ?? "latest";
  assert(/^(?:latest|\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?)$/u.test(version), "Use latest or one exact package version.");
  const temporary = mkdtempSync(join(realpathSync(tmpdir()), "sse-npm-smoke-"));
  const installRoot = join(temporary, "installation");
  const npmCli = process.env.npm_execpath ?? join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
  let passed = false;
  try {
    assert(existsSync(npmCli), "Run this test through npm run smoke:npm.");
    mkdirSync(installRoot);
    writeFileSync(join(installRoot, ".npmrc"), "@yadimon:registry=https://registry.npmjs.org/\n");
    const installed = spawnSync(process.execPath, [npmCli, "install", "--ignore-scripts", "--no-audit", "--no-fund",
      `${mcpName}@${version}`], { cwd: installRoot, env: { ...process.env, npm_config_cache: join(temporary, "npm-cache") },
      windowsHide: true, encoding: "utf8", timeout: 180_000, maxBuffer: 4 * 1024 * 1024 });
    writeFileSync(join(temporary, "npm-install.txt"), `${installed.stdout ?? ""}\n${installed.stderr ?? ""}`);
    assert.equal(installed.status, 0, "Registry installation failed; see npm-install.txt in the preserved sandbox.");
    const actual = JSON.parse(readFileSync(join(installRoot, "node_modules", "@yadimon", "steuer-spar-erklaerung-mcp", "package.json"), "utf8")).version;
    if (version !== "latest") assert.equal(actual, version);
    const result = await runInstalledSystemSmoke({ installRoot, temporary, expectedVersion: actual });
    writeFileSync(join(temporary, "result.json"), JSON.stringify(result, null, 2) + "\n");
    passed = true;
    console.log(`npm system smoke passed: ${JSON.stringify(result)}`);
  } finally {
    if (passed) {
      assert.equal(dirname(resolve(temporary)), realpathSync(tmpdir()));
      assert(basename(temporary).startsWith("sse-npm-smoke-") && !lstatSync(temporary).isSymbolicLink());
      await removeDirectoryWhenFree(temporary);
      assert.equal(existsSync(temporary), false);
      console.log("Temporary installation and synthetic files removed.");
    } else {
      console.error(`Smoke failed; diagnostic sandbox preserved: ${temporary}`);
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
