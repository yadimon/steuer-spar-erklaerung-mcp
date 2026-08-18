import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

if (process.platform !== "win32" || process.arch !== "x64") {
  throw new Error("Der Clean-install-Smoke fuer das API-Paket braucht Windows x64.");
}

const npmCli = process.env.npm_execpath ?? join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
assert(existsSync(npmCli), `npm CLI fehlt: ${npmCli}`);
const temporary = mkdtempSync(join(tmpdir(), "sse-npm-install-"));

function npm(args, options = {}) {
  const result = spawnSync(process.execPath, [npmCli, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
    ...options,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout;
}

try {
  const tarballs = [];
  for (const directory of ["packages/mcp", "packages/api"]) {
    const output = npm(["pack", `./${directory}`, "--json", "--ignore-scripts", "--pack-destination", temporary]);
    const [packed] = JSON.parse(output);
    const tarball = join(temporary, basename(packed.filename));
    assert(existsSync(tarball), `Tarball fehlt: ${tarball}`);
    tarballs.push(tarball);
  }
  const apiTarball = tarballs.find((path) => basename(path).includes("-api-"));
  assert(apiTarball, "API-Tarball wurde nicht erzeugt.");

  const installRoot = join(temporary, "installation");
  npm([
    "install",
    "--prefix", installRoot,
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    ...tarballs,
  ]);

  const apiOnlyRoot = join(temporary, "api-only-installation");
  npm([
    "install",
    "--prefix", apiOnlyRoot,
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    apiTarball,
  ]);
  assert(
    existsSync(join(apiOnlyRoot, "node_modules", ".bin", "steuer-spar-erklaerung-setup.cmd")),
    "API-only-Installation enthaelt den Setup-Einstieg nicht.",
  );
  assert(
    !existsSync(join(apiOnlyRoot, "node_modules", "@yadimon", "steuer-spar-erklaerung-mcp")),
    "API-only-Installation hat MCP unerwartet mitinstalliert.",
  );

  const binRoot = join(installRoot, "node_modules", ".bin");
  const commands = [
    "steuer-spar-erklaerung-api",
    "steuer-spar-erklaerung-call",
    "steuer-spar-erklaerung-setup",
    "steuer-spar-erklaerung-mcp",
  ];
  for (const command of commands) {
    const shim = join(binRoot, `${command}.cmd`);
    assert(existsSync(shim), `npm-Bin-Shim fehlt: ${shim}`);
    const help = spawnSync(shim, ["--help"], {
      encoding: "utf8",
      windowsHide: true,
      shell: true,
      timeout: 10_000,
    });
    assert.equal(help.status, 0, `${command} --help fehlgeschlagen:\n${help.stderr || help.stdout}`);
    assert.match(help.stdout, /SteuerSparErklaerung|Aufruf:/u, `${command} liefert keine Hilfe.`);
  }

  const apiRoot = join(installRoot, "node_modules", "@yadimon", "steuer-spar-erklaerung-api");
  const mcpRoot = join(installRoot, "node_modules", "@yadimon", "steuer-spar-erklaerung-mcp");
  assert(!existsSync(join(apiRoot, "dist", "index.js")), "API-Paket enthaelt den MCP-Einstieg.");
  assert(!existsSync(join(mcpRoot, "powershell")), "MCP-Paket enthaelt PowerShell.");
  assert(!existsSync(join(mcpRoot, "profiles")), "MCP-Paket enthaelt Produktprofile.");
  assert.match(readFileSync(join(apiRoot, "README.md"), "utf8"), /keinen MCP-Server/u);
  assert.match(readFileSync(join(mcpRoot, "README.md"), "utf8"), /PC-blinder MCP-Wrapper/u);
  const installedWindowsRuntime = await import(pathToFileURL(join(apiRoot, "dist", "windows-runtime.js")).href);
  assert.equal(
    installedWindowsRuntime.resolveProductMcpEntry(apiRoot),
    join(mcpRoot, "dist", "index.js"),
    "API-Setup findet den getrennt installierten MCP-Einstieg nicht.",
  );

  const installedMcpContract = spawnSync(
    process.execPath,
    ["test/mcp-wrapper-all-tools.mjs"],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      windowsHide: true,
      timeout: 30_000,
      env: { ...process.env, SSE_TEST_MCP_ENTRY: join(mcpRoot, "dist", "index.js") },
    },
  );
  assert.equal(installedMcpContract.status, 0, installedMcpContract.stderr || installedMcpContract.stdout);
  assert.match(installedMcpContract.stdout, /87 Werkzeuge.*\d+ API-Roundtrips/u, "Installierter MCP-Vertrag ist unvollstaendig.");

  process.stdout.write(
    `npm-Clean-install: ${commands.length} CLI-Einstiege und 87-Tool-MCP-Vertrag aus zwei getrennten Tarballs bestanden\n`,
  );
} finally {
  rmSync(resolve(temporary), { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
}
