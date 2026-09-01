import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const AGENT_PLUGIN_SCHEMA = "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json";
export const AGENT_MCP_SCHEMA = "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MAX_METADATA_PATH_LENGTH = 1024;
const PORTABLE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;
const WINDOWS_DEVICE_SEGMENT = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu;

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function json(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function containedPath(root, candidate, allowRoot = false) {
  const fromRoot = relative(root, candidate);
  return (allowRoot && fromRoot === "") ||
    (fromRoot !== "" && fromRoot !== ".." && !fromRoot.startsWith(`..${sep}`) && !isAbsolute(fromRoot));
}

function portableMetadataPath(value, label, { singleSegment = false } = {}) {
  if (typeof value !== "string" || !value || value.length > MAX_METADATA_PATH_LENGTH ||
      value.includes("\\") || value.includes("\0") || isAbsolute(value) || /^[A-Za-z]:/u.test(value)) {
    throw new Error(`${label} muss ein portabler relativer Pfad sein.`);
  }
  const segments = value.split("/");
  if ((singleSegment && segments.length !== 1) || segments.some((segment) =>
    !segment || segment === "." || segment === ".." || !PORTABLE_SEGMENT.test(segment) ||
    segment.endsWith(".") || WINDOWS_DEVICE_SEGMENT.test(segment))) {
    throw new Error(`${label} enthaelt kein gueltiges portables Pfadsegment.`);
  }
  return value;
}

function realDirectory(path, label) {
  try {
    const info = lstatSync(path);
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error();
    return realpathSync(path);
  } catch {
    throw new Error(`${label} ist kein sicher gebundenes Verzeichnis.`);
  }
}

function assertSafePath(root, candidate, label, { mustExist = false, directory = false } = {}) {
  const lexicalRoot = resolve(root);
  const lexicalCandidate = resolve(candidate);
  if (!containedPath(lexicalRoot, lexicalCandidate)) {
    throw new Error(`${label} verlaesst die erwartete Wurzel.`);
  }
  const realRoot = realDirectory(lexicalRoot, `${label}-Wurzel`);
  const segments = relative(lexicalRoot, lexicalCandidate).split(sep);
  let cursor = lexicalRoot;
  let missing = false;
  for (let index = 0; index < segments.length; index += 1) {
    cursor = join(cursor, segments[index]);
    let info;
    try {
      info = lstatSync(cursor);
    } catch (error) {
      if (error?.code === "ENOENT") {
        missing = true;
        break;
      }
      throw new Error(`${label} konnte nicht sicher geprueft werden.`);
    }
    if (info.isSymbolicLink()) throw new Error(`${label} darf keinen Link durchlaufen.`);
    const realCursor = realpathSync(cursor);
    if (!containedPath(realRoot, realCursor, true)) {
      throw new Error(`${label} verlaesst seine reale Wurzel.`);
    }
    if (index < segments.length - 1 && !info.isDirectory()) {
      throw new Error(`${label} durchlaeuft eine Nicht-Verzeichnis-Komponente.`);
    }
    if (index === segments.length - 1 && directory && !info.isDirectory()) {
      throw new Error(`${label} ist kein Verzeichnis.`);
    }
  }
  if (mustExist && missing) throw new Error(`${label} fehlt.`);
  return lexicalCandidate;
}

export function safeAgentPluginOutputPath(root, path) {
  return assertSafePath(resolve(root), resolve(root, path), `Generiertes Plugin-Ziel ${path}`);
}

function manifestMetadata(metadata, version) {
  return {
    name: metadata.name,
    version,
    description: metadata.description,
    author: metadata.author,
    homepage: metadata.homepage,
    repository: metadata.repository,
    license: metadata.license,
    keywords: metadata.keywords,
  };
}

export function loadAgentPluginMetadata(root = repositoryRoot) {
  const resolvedRoot = resolve(root);
  realDirectory(resolvedRoot, "Repository-Wurzel");
  const metadata = readJson(join(resolvedRoot, "plugin", "metadata.json"));
  const packageJson = readJson(join(resolvedRoot, "package.json"));
  if (!/^0\.1\.0-beta\.\d+$/u.test(packageJson.version)) {
    throw new Error("Agent-Plugin-Build erwartet eine gueltige Beta-Paketversion.");
  }
  if (!metadata.name || !metadata.skill?.name || !metadata.skill?.source ||
      !metadata.mcpServer?.name || !metadata.mcpServer?.entry || !metadata.runtime?.apiEntry) {
    throw new Error("plugin/metadata.json ist unvollstaendig.");
  }
  portableMetadataPath(metadata.name, "metadata.name", { singleSegment: true });
  portableMetadataPath(metadata.skill.name, "metadata.skill.name", { singleSegment: true });
  portableMetadataPath(metadata.mcpServer.name, "metadata.mcpServer.name", { singleSegment: true });
  portableMetadataPath(metadata.skill.source, "metadata.skill.source");
  portableMetadataPath(metadata.mcpServer.entry, "metadata.mcpServer.entry");
  portableMetadataPath(metadata.runtime.apiEntry, "metadata.runtime.apiEntry");

  const pluginBase = realDirectory(join(resolvedRoot, "plugin"), "Plugin-Wurzel");
  const skillsBase = realDirectory(join(resolvedRoot, "skills"), "Skill-Wurzel");
  const pluginRoot = assertSafePath(pluginBase, resolve(pluginBase, metadata.name), "Plugin-Ziel");
  const skillSource = resolve(resolvedRoot, metadata.skill.source);
  if (!containedPath(skillsBase, skillSource)) {
    throw new Error("metadata.skill.source muss innerhalb der Skill-Wurzel liegen.");
  }
  assertSafePath(skillsBase, skillSource, "Skill-Quelle", { mustExist: true, directory: true });

  const runtimeRoot = resolve(pluginRoot, "runtime");
  const mcpEntry = resolve(pluginRoot, metadata.mcpServer.entry);
  const apiEntry = resolve(pluginRoot, metadata.runtime.apiEntry);
  if (!containedPath(runtimeRoot, mcpEntry) || !containedPath(runtimeRoot, apiEntry)) {
    throw new Error("Plugin-Runtime-Einstiege muessen innerhalb der Runtime-Wurzel liegen.");
  }
  assertSafePath(pluginBase, mcpEntry, "MCP-Runtime-Einstieg");
  assertSafePath(pluginBase, apiEntry, "API-Runtime-Einstieg");

  return {
    metadata,
    version: packageJson.version,
    paths: { root: resolvedRoot, pluginRoot, runtimeRoot, skillSource, mcpEntry, apiEntry },
  };
}

export function generatedAgentPluginManifests(root = repositoryRoot) {
  const { metadata, version } = loadAgentPluginMetadata(root);
  const pluginDirectory = `plugin/${metadata.name}`;
  const portableManifest = {
    $schema: AGENT_PLUGIN_SCHEMA,
    ...manifestMetadata(metadata, version),
  };
  const portableMcp = {
    $schema: AGENT_MCP_SCHEMA,
    mcpServers: {
      [metadata.mcpServer.name]: {
        type: "stdio",
        command: "node",
        args: [`\${PLUGIN_ROOT}/${metadata.mcpServer.entry}`],
        cwd: "${PLUGIN_ROOT}",
      },
    },
  };
  const compatibilityMcp = {
    mcpServers: {
      [metadata.mcpServer.name]: {
        command: "node",
        args: [`\${PLUGIN_ROOT}/${metadata.mcpServer.entry}`],
        cwd: "${PLUGIN_ROOT}",
      },
    },
  };
  const compatibilityManifest = manifestMetadata(metadata, version);
  const codexManifest = {
    ...compatibilityManifest,
    skills: "./skills/",
    mcpServers: "./.mcp.json",
    interface: {
      displayName: metadata.displayName,
      shortDescription: metadata.description,
      longDescription: metadata.longDescription,
      developerName: metadata.author.name,
      category: metadata.interface.category,
      capabilities: metadata.interface.capabilities,
      websiteURL: metadata.homepage,
      defaultPrompt: metadata.interface.defaultPrompt,
    },
  };
  const claudeManifest = { ...compatibilityManifest };
  const marketplace = {
    name: metadata.marketplace.name,
    interface: { displayName: metadata.marketplace.displayName },
    owner: metadata.author,
    metadata: { pluginRoot: "." },
    plugins: [{
      name: metadata.name,
      source: `./${pluginDirectory}`,
      description: metadata.description,
      version,
      author: metadata.author,
      license: metadata.license,
      keywords: metadata.keywords,
      skills: [`./${pluginDirectory}/skills/${metadata.skill.name}`],
      policy: {
        installation: "AVAILABLE",
        authentication: "ON_INSTALL",
      },
      category: metadata.marketplace.category,
    }],
  };
  return new Map([
    [join(pluginDirectory, "plugin.json"), json(portableManifest)],
    [join(pluginDirectory, "mcp.json"), json(portableMcp)],
    [join(pluginDirectory, ".mcp.json"), json(compatibilityMcp)],
    [join(pluginDirectory, ".plugin", "plugin.json"), json(compatibilityManifest)],
    [join(pluginDirectory, ".codex-plugin", "plugin.json"), json(codexManifest)],
    [join(pluginDirectory, ".claude-plugin", "plugin.json"), json(claudeManifest)],
    ["marketplace.json", json(marketplace)],
  ]);
}

export function writeOrCheckAgentPluginManifests({ root = repositoryRoot, check = false } = {}) {
  const generated = generatedAgentPluginManifests(root);
  const drift = [];
  for (const [path, content] of generated) {
    const absolute = safeAgentPluginOutputPath(root, path);
    if (check) {
      if (!existsSync(absolute) || readFileSync(absolute, "utf8") !== content) drift.push(path.replaceAll("\\", "/"));
      continue;
    }
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, content, "utf8");
  }
  if (drift.length) {
    throw new Error(`Agent-Plugin-Manifeste weisen Drift auf: ${drift.join(", ")}`);
  }
  return generated;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const unknown = process.argv.slice(2).filter((argument) => argument !== "--check");
  if (unknown.length) throw new Error(`Unbekannte Argumente: ${unknown.join(" ")}`);
  const check = process.argv.includes("--check");
  const generated = writeOrCheckAgentPluginManifests({ check });
  process.stdout.write(
    check
      ? `Agent-Plugin-Manifeste ohne Drift: ${generated.size} Dateien\n`
      : `Agent-Plugin-Manifeste erzeugt: ${generated.size} Dateien\n`,
  );
}
