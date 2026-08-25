import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

if (process.platform !== "win32" || process.arch !== "x64") {
  throw new Error("Der Clean-install-Smoke fuer das API-Paket braucht Windows x64.");
}

const publishedMode = process.argv.includes("--published");
const unexpectedArguments = process.argv.slice(2).filter((argument) => argument !== "--published");
assert.deepEqual(unexpectedArguments, [], `Unbekannte Argumente: ${unexpectedArguments.join(", ")}`);
const rootPackage = JSON.parse(readFileSync("package.json", "utf8"));
const expectedVersion = rootPackage.version;
const mcpPackageName = "@yadimon/steuer-spar-erklaerung-mcp";
const apiPackageName = "@yadimon/steuer-spar-erklaerung-api";

const npmCli = process.env.npm_execpath ?? join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
assert(existsSync(npmCli), `npm CLI fehlt: ${npmCli}`);
const temporary = mkdtempSync(join(tmpdir(), "sse-npm-install-"));

function npm(args, options = {}) {
  const { env: optionEnv = {}, ...spawnOptions } = options;
  const result = spawnSync(process.execPath, [npmCli, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
    env: {
      ...process.env,
      npm_config_cache: join(temporary, "npm-cache"),
      ...optionEnv,
    },
    ...spawnOptions,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout;
}

try {
  const installSources = [];
  if (publishedMode) {
    installSources.push(`${mcpPackageName}@${expectedVersion}`, `${apiPackageName}@${expectedVersion}`);
  } else {
    for (const directory of ["packages/mcp", "packages/api"]) {
      const output = npm(["pack", `./${directory}`, "--json", "--ignore-scripts", "--pack-destination", temporary]);
      const [packed] = JSON.parse(output);
      const tarball = join(temporary, basename(packed.filename));
      assert(existsSync(tarball), `Tarball fehlt: ${tarball}`);
      installSources.push(tarball);
    }
  }
  const apiSource = publishedMode
    ? `${apiPackageName}@${expectedVersion}`
    : installSources.find((path) => basename(path).includes("-api-"));
  assert(apiSource, "API-Installationsquelle wurde nicht erzeugt.");

  const npxRoot = join(temporary, "npx-working-directory");
  mkdirSync(npxRoot, { recursive: true });
  const npxApiHelp = npm([
    "exec", "--yes", "--package", apiSource, "--", "steuer-spar-erklaerung-api", "--help",
  ], { cwd: npxRoot });
  assert.match(npxApiHelp, /Ohne --config liegt alles unter %LOCALAPPDATA%/u);
  const npxCliHelp = npm([
    "exec", "--yes", "--package", apiSource, "--", "steuer-spar-erklaerung-call", "--help",
  ], { cwd: npxRoot });
  assert.match(npxCliHelp, /steuer-spar-erklaerung-call health/u);

  const installRoot = join(temporary, "installation");
  npm([
    "install",
    "--prefix", installRoot,
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    ...installSources,
  ]);

  const apiOnlyRoot = join(temporary, "api-only-installation");
  npm([
    "install",
    "--prefix", apiOnlyRoot,
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    apiSource,
  ]);
  assert(
    existsSync(join(apiOnlyRoot, "node_modules", ".bin", "steuer-spar-erklaerung-api.cmd")),
    "API-only-Installation enthaelt den API-Einstieg nicht.",
  );
  assert(
    !existsSync(join(apiOnlyRoot, "node_modules", "@yadimon", "steuer-spar-erklaerung-mcp")),
    "API-only-Installation hat MCP unerwartet mitinstalliert.",
  );

  const binRoot = join(installRoot, "node_modules", ".bin");
  const commands = [
    "steuer-spar-erklaerung-api",
    "steuer-spar-erklaerung-call",
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
  assert.equal(JSON.parse(readFileSync(join(apiRoot, "package.json"), "utf8")).version, expectedVersion);
  assert.equal(JSON.parse(readFileSync(join(mcpRoot, "package.json"), "utf8")).version, expectedVersion);
  assert(!existsSync(join(apiRoot, "dist", "index.js")), "API-Paket enthaelt den MCP-Einstieg.");
  assert(!existsSync(join(mcpRoot, "powershell")), "MCP-Paket enthaelt PowerShell.");
  assert(!existsSync(join(mcpRoot, "profiles")), "MCP-Paket enthaelt Produktprofile.");
  assert.match(
    readFileSync(join(apiRoot, "README.md"), "utf8"),
    /MCP-Server ist bewusst \*\*nicht\*\* enthalten/u,
  );
  assert.match(readFileSync(join(mcpRoot, "README.md"), "utf8"), /PC-blinder MCP-Wrapper/u);
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
  assert.match(installedMcpContract.stdout, /98 Werkzeuge.*\d+ API-Roundtrips/u, "Installierter MCP-Vertrag ist unvollstaendig.");

  const sourceLabel = publishedMode ? "exakten npm-Registry-Paketen" : "zwei getrennten Tarballs";
  process.stdout.write(
    `npm-${publishedMode ? "Registry-Smoke" : "Clean-install"}: NPX-Kurzweg, ${commands.length} CLI-Einstiege und ` +
      `98-Tool-MCP-Vertrag aus ${sourceLabel} bestanden\n`,
  );
} finally {
  rmSync(resolve(temporary), { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
}
