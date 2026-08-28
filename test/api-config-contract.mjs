import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { defaultApiConfigPath, environmentForExplicitApiConfig, loadApiServerConfig, MAX_API_CONFIG_BYTES } from "../dist/api-config.js";
import { readJsonFileStrict } from "../dist/json-files.js";

const temporary = mkdtempSync(join(tmpdir(), "sse-api-config-"));
const configPath = join(temporary, "config", "config.json");
mkdirSync(join(temporary, "config"), { recursive: true });

const writeConfig = (value) => writeFileSync(configPath, `${JSON.stringify(value)}\n`, "utf8");
const load = (overrides = {}) => loadApiServerConfig({ SSE_API_CONFIG: configPath, ...overrides });

function assertTokenlessPublicContract() {
  const apiContract = readFileSync(join("docs", "API-MCP-VERTRAG.md"), "utf8");
  const architecture = readFileSync(join("docs", "ARCHITEKTUR.md"), "utf8");
  const mcpReadme = readFileSync(join("packages", "mcp", "README.md"), "utf8");

  for (const staleClaim of [
    /Loopback-URL und Token/u,
    /Das Token gewaehrt|Das Token gewährt/u,
    /Bearer-Token/u,
    /authentifizierter API-Aufruf/u,
    /Fehler vor der Ausfuehrung, etwa Authentifizierung|Fehler vor der Ausführung, etwa Authentifizierung/u,
  ]) {
    assert(!staleClaim.test(apiContract), `API-/MCP-Vertrag enthaelt veraltete Token-Aussage: ${staleClaim}`);
  }
  assert.match(apiContract, /keine Anmeldung/iu);
  assert.match(apiContract, /kein Token/iu);
  assert(!/Ihr authentifizierter Katalog|Auth, Queue/u.test(architecture),
    "Architektur beschreibt eine nicht vorhandene Authentifizierungsschicht.");
  assert.match(architecture, /Eine\s+Anmeldung gibt es nicht/iu);
  assert(!/authentifizierter Loopback-Verbindung/u.test(mcpReadme),
    "MCP-README beschreibt die lokale API-Verbindung faelschlich als authentifiziert.");
  assert.match(mcpReadme, /API kennt keine Anmeldung/iu);
}

try {
  writeConfig({});
  const minimal = load();
  assert.equal(minimal.host, "127.0.0.1");
  assert.equal(minimal.port, 43127);
  assert.equal(minimal.profileId, "2025");
  assert.equal(minimal.workspaceDir, join(temporary, "config", "workspace"));
  assert.equal(minimal.documentsDir, join(minimal.workspaceDir, "documents"));
  assert.equal(minimal.resultDir, join(minimal.workspaceDir, "results"));
  assert.equal(minimal.backupsDir, join(minimal.workspaceDir, "backups"));

  const environmentWorkspace = join(temporary, "env-workspace");
  const overridden = load({
    SSE_API_HOST: "::1",
    SSE_API_PORT: "43210",
    SSE_WORKSPACE_DIR: environmentWorkspace,
  });
  assert.equal(overridden.host, "::1");
  assert.equal(overridden.port, 43210);
  assert.equal(overridden.workspaceDir, environmentWorkspace);

  for (const host of ["0.0.0.0", "localhost", "192.0.2.1"]) {
    assert.throws(() => load({ SSE_API_HOST: host }), /nur an Loopback/);
  }
  for (const port of ["0", "65536", "1.5", "kein-port"]) {
    assert.throws(() => load({ SSE_API_PORT: port }), /zwischen 1 und 65535/);
  }
  // Ein altes Token in der Datei muss ausdruecklich benannt werden, sonst
  // wirkt der Wegfall wie ein Tippfehler in der Konfiguration.
  writeConfig({ token: "irgendein-altes-token" });
  assert.throws(() => load(), /entfallene Feld 'token'/);
  assertTokenlessPublicContract();

  for (const field of ["caseDir", "documentsDir", "workspaceDir", "resultDir", "backupsDir", "sseExecutable"]) {
    writeConfig({ [field]: "relativ" });
    assert.throws(() => load(), new RegExp(`${field} muss ein absoluter Windows-Pfad`));
  }

  writeConfig({ unbekanntesFeld: true });
  assert.throws(() => load(), /Unbekanntes Feld.*unbekanntesFeld/);
  writeConfig({ interactiveReceiptLeaseToken: "A".repeat(64) });
  assert.throws(() => load(), /Unbekanntes Feld.*interactiveReceiptLeaseToken/,
    "Die interaktive Test-Lease darf nicht persistierbar konfiguriert werden.");
  writeConfig({ workspaceDir: 123 });
  assert.throws(() => load(), /workspaceDir.*Zeichenkette/);
  writeConfig({ port: true });
  assert.throws(() => load(), /port.*Zahl/);
  writeConfig({ workspaceDir: `${temporary}\nsteuerzeichen` });
  assert.throws(() => load(), /workspaceDir.*Steuerzeichen/);
  const topologyRoot = join(temporary, "topology");
  for (const unsafe of [
    { workspaceDir: topologyRoot, resultDir: topologyRoot },
    { workspaceDir: join(topologyRoot, "unterordner"), resultDir: topologyRoot },
    { workspaceDir: topologyRoot, resultDir: join(topologyRoot, "shared"), backupsDir: join(topologyRoot, "shared", "backup") },
    { workspaceDir: topologyRoot, caseDir: join(topologyRoot, "cases") },
    { workspaceDir: topologyRoot, documentsDir: join(topologyRoot, "shared"), resultDir: join(topologyRoot, "shared", "results") },
  ]) {
    writeConfig({ ...unsafe });
    assert.throws(() => load(), /Ressourcenbereich|Ressourcenbereiche/);
  }
  const junctionWorkspace = join(temporary, "junction-workspace");
  const junctionCases = join(temporary, "junction-cases");
  mkdirSync(junctionWorkspace, { recursive: true });
  mkdirSync(junctionCases, { recursive: true });
  symlinkSync(junctionCases, join(junctionWorkspace, "results"), "junction");
  writeConfig({ workspaceDir: junctionWorkspace, caseDir: junctionCases });
  assert.throws(() => load(), /'cases'.*'results'|Ressourcenbereiche/);
  const fileInsteadOfDirectory = join(temporary, "kein-ordner.txt");
  writeFileSync(fileInsteadOfDirectory, "datei", "utf8");
  writeConfig({ resultDir: fileInsteadOfDirectory });
  assert.throws(() => load(), /'results'.*Ordner/);
  writeConfig([]);
  assert.throws(() => load(), /kein JSON-Objekt/);
  writeFileSync(configPath, "{kein-json", "utf8");
  assert.throws(() => load(), /kein gueltiges JSON/);
  writeFileSync(configPath, Buffer.from([0x7b, 0x22, 0x78, 0x22, 0x3a, 0x22, 0x80, 0x22, 0x7d]));
  assert.throws(() => load(), /kein gueltiges UTF-8/);
  writeConfig({});
  truncateSync(configPath, MAX_API_CONFIG_BYTES + 1);
  assert.throws(() => load(), /konnte nicht sicher gelesen werden.*groesser/);
  writeConfig({ ok: true });
  assert.deepEqual(readJsonFileStrict(configPath, "Test-JSON", 64), { ok: true });
  assert.throws(() => readJsonFileStrict(configPath, "Test-JSON", 4), /konnte nicht sicher gelesen werden.*groesser/);

  assert.equal(
    defaultApiConfigPath({ LOCALAPPDATA: resolve(temporary, "local") }),
    join(resolve(temporary, "local"), "SteuerSparErklaerungApi", "config.json"),
  );
  const explicitEnvironment = environmentForExplicitApiConfig(configPath, {
    PATH: "synthetic-path",
    SSE_API_PORT: "9",
    SSE_CASE_DIR: "C:\\stale",
    SSE_POWERSHELL_EXE: "C:\\managed\\powershell.exe",
    SSE_TEST_CONCURRENCY: "3",
  });
  assert.equal(explicitEnvironment.PATH, "synthetic-path");
  assert.equal(explicitEnvironment.SSE_API_CONFIG, resolve(configPath));
  assert.equal(explicitEnvironment.SSE_API_PORT, undefined);
  assert.equal(explicitEnvironment.SSE_CASE_DIR, undefined);
  assert.equal(explicitEnvironment.SSE_POWERSHELL_EXE, "C:\\managed\\powershell.exe");
  assert.equal(explicitEnvironment.SSE_TEST_CONCURRENCY, "3");
  process.stdout.write("API-Konfiguration: Defaults, tokenlose Dokumentation, Loopback, Typen, Pfade, UTF-8 und Dateilimits bestanden\n");
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
