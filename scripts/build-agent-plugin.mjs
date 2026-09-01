import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { build as bundle } from "esbuild";
import {
  generatedAgentPluginManifests,
  loadAgentPluginMetadata,
  safeAgentPluginOutputPath,
} from "./generate-agent-plugin-manifests.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function normalize(path) {
  return path.replaceAll(sep, "/");
}

function json(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function normalizedUtf8File(path) {
  return Buffer.from(`${readFileSync(path, "utf8").trimEnd()}\n`, "utf8");
}

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

const asciiCompare = (left, right) => left < right ? -1 : left > right ? 1 : 0;
const nodeRuntimeGuard = [
  "const __sseNodeMajor = Number.parseInt(process.versions.node.split(\".\", 1)[0] ?? \"0\", 10);",
  "if (!Number.isSafeInteger(__sseNodeMajor) || __sseNodeMajor < 22) {",
  "  process.stderr.write(\"SteuerSparErklaerung-Plugin benoetigt Node.js 22 oder neuer.\\n\");",
  "  process.exit(1);",
  "}",
].join("\n");

function assertRegularTree(directory) {
  if (!existsSync(directory)) throw new Error(`Gebundelte Quelle fehlt: ${normalize(relative(root, directory))}`);
  if (lstatSync(directory).isSymbolicLink()) {
    throw new Error(`Gebundelte Quelle darf kein Link sein: ${directory}`);
  }
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Gebundelte Quelle darf kein Link sein: ${path}`);
    if (entry.isDirectory()) assertRegularTree(path);
    else if (!entry.isFile()) throw new Error(`Gebundelte Quelle ist keine regulaere Datei: ${path}`);
  }
}

function addTree(files, sourceRoot, targetPrefix, filter = () => true) {
  assertRegularTree(sourceRoot);
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const source = join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(source);
      } else if (entry.isFile() && filter(source)) {
        const fromSourceRoot = normalize(relative(sourceRoot, source));
        files.set(normalize(join(targetPrefix, fromSourceRoot)), readFileSync(source));
      }
    }
  };
  visit(sourceRoot);
}

function addProductionProfiles(files, pluginPrefix) {
  const profilesRoot = join(root, "profiles");
  assertRegularTree(profilesRoot);
  const profileIds = readdirSync(profilesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^[0-9]{4}$/u.test(entry.name))
    .map((entry) => entry.name)
    .sort(asciiCompare);
  if (!profileIds.length) throw new Error("Der Plugin-Build fand keine Produktionsprofile.");

  for (const profileId of profileIds) {
    for (const name of ["profile.json", "page-objects.json"]) {
      const source = join(profilesRoot, profileId, name);
      if (!existsSync(source) || !lstatSync(source).isFile()) {
        throw new Error(`Produktionsprofil ${profileId} ist unvollstaendig: ${name}`);
      }
      files.set(
        `${pluginPrefix}/runtime/profiles/${profileId}/${name}`,
        readFileSync(source),
      );
    }
  }
}

function validateVersions() {
  const rootPackage = readJson(join(root, "package.json"));
  const apiPackage = readJson(join(root, "packages", "api", "package.json"));
  const mcpPackage = readJson(join(root, "packages", "mcp", "package.json"));
  const esbuildPackage = readJson(join(root, "node_modules", "esbuild", "package.json"));
  if (apiPackage.version !== rootPackage.version || mcpPackage.version !== rootPackage.version) {
    throw new Error("Root-, API- und MCP-Version muessen fuer den Plugin-Build identisch sein.");
  }
  if (mcpPackage.dependencies?.[apiPackage.name] !== rootPackage.version) {
    throw new Error("Das MCP-npm-Paket muss die exakte API-Version abhaengig machen.");
  }
  if (rootPackage.devDependencies?.esbuild !== "0.28.2" || esbuildPackage.version !== "0.28.2") {
    throw new Error("Der reproduzierbare Plugin-Build erfordert exakt esbuild 0.28.2.");
  }
  return { rootPackage, apiPackage, mcpPackage };
}

async function bundledEntry(source, logicalName) {
  const result = await bundle({
    absWorkingDir: root,
    entryPoints: [source],
    outfile: `${logicalName}.js`,
    bundle: true,
    platform: "node",
    format: "esm",
    // Das Bundle wird syntaktisch fuer den niedrigsten plugins@1-Host (Node 18)
    // ausgegeben, damit der unmittelbar folgende Guard eine saubere Meldung
    // liefern kann. Fachlich ausgefuehrt wird es ausschliesslich ab Node 22.
    target: "node18",
    packages: "bundle",
    preserveSymlinks: true,
    charset: "utf8",
    legalComments: "eof",
    sourcemap: false,
    minify: false,
    treeShaking: true,
    write: false,
    metafile: true,
    banner: { js: nodeRuntimeGuard },
    logLevel: "warning",
  });
  if (result.outputFiles.length !== 1) throw new Error(`Unerwartete esbuild-Ausgabe fuer ${source}.`);
  const outputs = Object.values(result.metafile.outputs);
  if (outputs.length !== 1) throw new Error(`Unerwartetes esbuild-Metafile fuer ${source}.`);
  for (const imported of outputs[0].imports) {
    if (imported.external && !imported.path.startsWith("node:")) {
      throw new Error(`Bundle ${logicalName} besitzt eine externe JavaScript-Abhaengigkeit: ${imported.path}`);
    }
  }
  const output = Buffer.from(result.outputFiles[0].contents);
  const text = output.toString("utf8");
  const rootBackslashes = root.toLowerCase();
  const rootSlashes = root.replaceAll("\\", "/").toLowerCase();
  if (text.toLowerCase().includes(rootBackslashes) || text.toLowerCase().includes(rootSlashes)) {
    throw new Error(`Bundle ${logicalName} enthaelt einen absoluten Buildpfad.`);
  }
  return { output, inputs: Object.keys(result.metafile.inputs) };
}

function dependencyNameFromInput(input) {
  const normalized = input.replaceAll("\\", "/");
  const marker = "node_modules/";
  const index = normalized.lastIndexOf(marker);
  if (index < 0) return undefined;
  const path = normalized.slice(index + marker.length).split("/");
  if (!path[0]) return undefined;
  return path[0].startsWith("@") && path[1] ? `${path[0]}/${path[1]}` : path[0];
}

function addThirdPartyNotices(files, pluginPrefix, bundleInputs) {
  const packages = new Map();
  for (const [bundleName, inputs] of bundleInputs) {
    for (const input of inputs) {
      const name = dependencyNameFromInput(input);
      if (!name) continue;
      const current = packages.get(name) ?? new Set();
      current.add(bundleName);
      packages.set(name, current);
    }
  }
  const notices = [];
  for (const name of [...packages.keys()].sort(asciiCompare)) {
    const packageRoot = resolve(root, "node_modules", ...name.split("/"));
    const manifest = readJson(join(packageRoot, "package.json"));
    if (manifest.name !== name || typeof manifest.version !== "string" || !manifest.version ||
        typeof manifest.license !== "string" || !manifest.license) {
      throw new Error(`Gebundelte Drittanbieter-Metadaten sind unvollstaendig: ${name}`);
    }
    const licenseNames = readdirSync(packageRoot, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /^(?:licen[cs]e|copying)(?:\..*)?$/iu.test(entry.name))
      .map((entry) => entry.name)
      .sort(asciiCompare);
    if (!licenseNames.length) throw new Error(`Lizenzdatei der gebuendelten Dependency fehlt: ${name}`);
    const directoryName = name.replace("/", "__");
    for (const licenseName of licenseNames) {
      files.set(
        `${pluginPrefix}/runtime/third-party/${directoryName}/${licenseName}`,
        normalizedUtf8File(join(packageRoot, licenseName)),
      );
    }
    notices.push({
      name,
      version: manifest.version,
      license: manifest.license,
      bundles: [...packages.get(name)].sort(asciiCompare),
      licenseFiles: licenseNames.map((licenseName) => `third-party/${directoryName}/${licenseName}`),
    });
  }
  files.set(`${pluginPrefix}/runtime/third-party/NOTICE.json`, json({
    generatedFrom: "esbuild-metafile-inputs",
    packages: notices,
  }));
}

function readCheckedNativeArtifacts(source, dllPath, sidecarPath, label) {
  if (!existsSync(dllPath) || !existsSync(sidecarPath)) {
    return { artifacts: null, reason: `${label} fehlt.` };
  }
  const dllInfo = lstatSync(dllPath);
  const sidecarInfo = lstatSync(sidecarPath);
  if (dllInfo.isSymbolicLink() || sidecarInfo.isSymbolicLink()) {
    throw new Error(`${label} darf kein Link sein.`);
  }
  if (!dllInfo.isFile() || !sidecarInfo.isFile()) {
    return { artifacts: null, reason: `${label} besteht nicht aus regulaeren Dateien.` };
  }
  const dll = readFileSync(dllPath);
  const sidecar = readFileSync(sidecarPath);
  let integrity;
  try {
    integrity = JSON.parse(sidecar.toString("utf8"));
  } catch {
    return { artifacts: null, reason: `${label} besitzt kein gueltiges Integritaetsmanifest.` };
  }
  if (integrity.schemaVersion !== 1 ||
      integrity.sourceSha256 !== sha256(source).toUpperCase() ||
      integrity.dllSha256 !== sha256(dll).toUpperCase()) {
    return { artifacts: null, reason: `${label} passt nicht zu Quelle, DLL und Sidecar.` };
  }
  const normalizedSidecar = Buffer.from(`${JSON.stringify({
    schemaVersion: integrity.schemaVersion,
    sourceSha256: integrity.sourceSha256,
    dllSha256: integrity.dllSha256,
  })}\n`, "utf8");
  return { artifacts: { dll, sidecar: normalizedSidecar }, reason: null };
}

function useCheckedNativeArtifacts(files, pluginPrefix, { allowLocalFallback = false } = {}) {
  const source = readFileSync(join(root, "powershell", "sse-native.cs"));
  const trackedDllPath = safeAgentPluginOutputPath(
    root,
    join(pluginPrefix, "runtime", "powershell", "sse-native.dll"),
  );
  const trackedSidecarPath = safeAgentPluginOutputPath(
    root,
    join(pluginPrefix, "runtime", "powershell", "sse-native.sha256"),
  );
  const tracked = readCheckedNativeArtifacts(
    source,
    trackedDllPath,
    trackedSidecarPath,
    "Der getrackte Plugin-Native-Build",
  );
  let selected = tracked.artifacts;
  let localReason = null;
  if (!selected && allowLocalFallback) {
    const local = readCheckedNativeArtifacts(
      source,
      join(root, "powershell", "sse-native.dll"),
      join(root, "powershell", "sse-native.sha256"),
      "Der lokale Native-Build",
    );
    selected = local.artifacts;
    localReason = local.reason;
  }
  if (!selected) {
    throw new Error([tracked.reason, localReason].filter(Boolean).join(" "));
  }
  files.set(`${pluginPrefix}/runtime/powershell/sse-native.dll`, selected.dll);
  files.set(`${pluginPrefix}/runtime/powershell/sse-native.sha256`, selected.sidecar);
}

async function expectedFiles(check) {
  const { rootPackage, apiPackage, mcpPackage } = validateVersions();
  const { metadata, version, paths } = loadAgentPluginMetadata(root);
  if (version !== rootPackage.version) throw new Error("Plugin-Metadaten verwenden eine andere Paketversion.");
  const pluginPrefix = normalize(join("plugin", metadata.name));
  const files = new Map(
    [...generatedAgentPluginManifests(root)]
      .filter(([path]) => path === "marketplace.json" || normalize(path).startsWith(`${pluginPrefix}/`))
      .map(([path, content]) => [normalize(path), Buffer.from(content, "utf8")]),
  );

  const mcpBundle = await bundledEntry("src/index.ts", "mcp");
  const apiBundle = await bundledEntry("src/api-main.ts", "api");
  files.set(`${pluginPrefix}/${metadata.mcpServer.entry}`, mcpBundle.output);
  files.set(`${pluginPrefix}/${metadata.runtime.apiEntry}`, apiBundle.output);

  addTree(
    files,
    paths.skillSource,
    `${pluginPrefix}/skills/${metadata.skill.name}`,
  );
  addTree(
    files,
    join(root, "powershell"),
    `${pluginPrefix}/runtime/powershell`,
    (path) => {
      const name = basename(path);
      return name !== "build-native.ps1" && !name.startsWith(".sse-native-") &&
        !["sse-native.dll", "sse-native.sha256"].includes(name);
    },
  );
  useCheckedNativeArtifacts(files, pluginPrefix, { allowLocalFallback: !check });
  addProductionProfiles(files, pluginPrefix);
  const license = readFileSync(join(root, "LICENSE"));
  files.set(`${pluginPrefix}/LICENSE`, license);
  files.set(`${pluginPrefix}/runtime/LICENSE`, license);
  addThirdPartyNotices(files, pluginPrefix, new Map([
    ["mcp", mcpBundle.inputs],
    ["api", apiBundle.inputs],
  ]));

  const runtimePrefix = `${pluginPrefix}/runtime/`;
  const runtimeFiles = [...files]
    .filter(([path]) => path.startsWith(runtimePrefix))
    .map(([path, content]) => ({
      path: path.slice(runtimePrefix.length),
      sha256: sha256(content),
      size: content.length,
    }))
    .sort((left, right) => asciiCompare(left.path, right.path));
  const mcpEntry = metadata.mcpServer.entry.replace(/^runtime\//u, "");
  const apiEntry = metadata.runtime.apiEntry.replace(/^runtime\//u, "");
  if (!runtimeFiles.some((file) => file.path === mcpEntry) || !runtimeFiles.some((file) => file.path === apiEntry)) {
    throw new Error("Runtime-Einstiege liegen nicht im gebuendelten Runtime-Baum.");
  }
  files.set(`${runtimePrefix}runtime-lock.json`, json({
    schemaVersion: 1,
    packageName: rootPackage.name,
    packageVersion: rootPackage.version,
    apiPackageName: apiPackage.name,
    mcpPackageName: mcpPackage.name,
    pluginName: metadata.name,
    pluginVersion: version,
    entries: { mcp: mcpEntry, api: apiEntry },
    files: runtimeFiles,
  }));
  return { files, pluginPrefix };
}

function assertGeneratedTarget(pluginPrefix) {
  const pluginRoot = safeAgentPluginOutputPath(root, pluginPrefix);
  const expected = resolve(root, "plugin", basename(pluginPrefix));
  if (pluginRoot !== expected || relative(root, pluginRoot).startsWith("..")) {
    throw new Error("Generiertes Plugin-Ziel konnte nicht sicher gebunden werden.");
  }
  return pluginRoot;
}

function actualPluginFiles(pluginRoot, pluginPrefix) {
  const result = new Map();
  if (!existsSync(pluginRoot)) return result;
  if (lstatSync(pluginRoot).isSymbolicLink()) throw new Error("Generiertes Plugin-Ziel darf kein Link sein.");
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Generiertes Plugin darf keinen Link enthalten: ${path}`);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) {
        result.set(`${pluginPrefix}/${normalize(relative(pluginRoot, path))}`, readFileSync(path));
      }
    }
  };
  visit(pluginRoot);
  return result;
}

function compareExpected(expected, pluginRoot, pluginPrefix) {
  const actual = actualPluginFiles(pluginRoot, pluginPrefix);
  const expectedPlugin = new Map([...expected].filter(([path]) => path.startsWith(`${pluginPrefix}/`)));
  const drift = [];
  for (const path of new Set([...expectedPlugin.keys(), ...actual.keys()])) {
    const left = expectedPlugin.get(path);
    const right = actual.get(path);
    if (!left || !right || !left.equals(right)) drift.push(path);
  }
  const expectedMarketplace = expected.get("marketplace.json");
  const marketplacePath = safeAgentPluginOutputPath(root, "marketplace.json");
  if (!expectedMarketplace || !existsSync(marketplacePath) ||
      !expectedMarketplace.equals(readFileSync(marketplacePath))) {
    drift.push("marketplace.json");
  }
  if (drift.length) throw new Error(`Agent-Plugin-Build weist Drift auf: ${drift.sort().join(", ")}`);
}

function writeExpected(expected, pluginRoot, pluginPrefix) {
  if (existsSync(pluginRoot)) {
    if (lstatSync(pluginRoot).isSymbolicLink()) throw new Error("Generiertes Plugin-Ziel darf kein Link sein.");
    rmSync(pluginRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
  for (const [path, content] of expected) {
    if (path !== "marketplace.json" && !path.startsWith(`${pluginPrefix}/`)) continue;
    const absolute = safeAgentPluginOutputPath(root, path);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, content);
  }
}

const unknown = process.argv.slice(2).filter((argument) => argument !== "--check");
if (unknown.length) throw new Error(`Unbekannte Argumente: ${unknown.join(" ")}`);
const check = process.argv.includes("--check");
const { files, pluginPrefix } = await expectedFiles(check);
const pluginRoot = assertGeneratedTarget(pluginPrefix);
if (check) compareExpected(files, pluginRoot, pluginPrefix);
else writeExpected(files, pluginRoot, pluginPrefix);
process.stdout.write(
  check
    ? `Agent-Plugin ohne Drift: ${files.size} Dateien\n`
    : `Agent-Plugin gebaut: ${files.size} Dateien\n`,
);
