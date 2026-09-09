import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { lstatSync, readFileSync, mkdirSync, writeFileSync, copyFileSync, renameSync, existsSync } from "node:fs";
import { resolve, join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { compatibility, root, sourceIdentity } from "./generate-config.mjs";

const hash = bytes => createHash("sha256").update(bytes).digest("hex");
function binary(path, name) {
  const stat = lstatSync(path);
  assert(stat.isFile() && !stat.isSymbolicLink() && stat.size >= 256 && stat.size <= 128 * 1024 * 1024, "Invalid native binary file.");
  assert.equal(basename(path), name);
  const bytes = readFileSync(path), pe = bytes.readUInt32LE(0x3c);
  assert.equal(bytes.toString("ascii", 0, 2), "MZ");
  assert(pe >= 64 && pe + 26 <= bytes.length, "Invalid PE header offset.");
  assert.equal(bytes.readUInt32LE(pe), 0x00004550); assert.equal(bytes.readUInt16LE(pe + 4), 0x8664);
  assert.equal(bytes.readUInt16LE(pe + 24), 0x20b, "Expected a 64-bit native PE image.");
  assert.equal(Boolean(bytes.readUInt16LE(pe + 22) & 0x2000), name.endsWith(".dll"), "Unexpected PE executable/library kind.");
  return bytes;
}

export function packageNative(loader, bridge, identityHeader, buildDirectory) {
  const identity = readFileSync(identityHeader, "utf8").match(/^#define SSE_BRIDGE_SOURCE_DIGEST "([a-f0-9]{64})"$/mu)?.[1];
  assert.equal(identity, sourceIdentity(), "Build identity is stale; reconfigure and rebuild before packaging.");
  const loaderBytes = binary(loader, "bridge-load.exe"), bridgeBytes = binary(bridge, "sse-qt-read.dll");
  const buildIdentity = "SSE_NATIVE_BRIDGE_V2:" + identity;
  assert(bridgeBytes.includes(Buffer.from(buildIdentity + "\0")), "Built bridge does not contain the expected source identity.");
  assert(loaderBytes.includes(Buffer.from(buildIdentity + "\0")), "Built loader does not contain the expected source identity.");
  const manifest = { schemaVersion: 1, startupAbi: 2, bridgeProtocol: 1, discoveryProtocol: 1, buildIdentity, profile: compatibility().profile,
    loader: { file: "bridge-load.exe", sha256: hash(loaderBytes) }, bridge: { file: "sse-qt-read.dll", sha256: hash(bridgeBytes) } };
  const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2) + "\n"), manifestSha256 = hash(manifestBytes);
  const directory = join(resolve(buildDirectory), "packages", manifestSha256);
  const notices = [[join(root, "../../LICENSE"), "LICENSE"],
    [join(root, "third_party/nlohmann/LICENSE.MIT"), "LICENSE.nlohmann-json"], [join(root, "THIRD_PARTY.md"), "THIRD_PARTY.md"]];
  if (existsSync(directory)) {
    assert(lstatSync(directory).isDirectory() && !lstatSync(directory).isSymbolicLink());
    assert.equal(hash(readFileSync(join(directory, "manifest.json"))), manifestSha256);
    assert.equal(hash(binary(join(directory, manifest.loader.file), manifest.loader.file)), manifest.loader.sha256);
    assert.equal(hash(binary(join(directory, manifest.bridge.file), manifest.bridge.file)), manifest.bridge.sha256);
    for (const [source, name] of notices) assert.equal(hash(readFileSync(join(directory, name))), hash(readFileSync(source)), "Package notice differs from its source.");
  } else {
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, manifest.loader.file), loaderBytes); writeFileSync(join(directory, manifest.bridge.file), bridgeBytes);
    for (const [source, name] of notices) copyFileSync(source, join(directory, name));
    writeFileSync(join(directory, "manifest.json"), manifestBytes);
  }
  const config = { qtNativeRuntime: { directory, manifestSha256 } };
  const configPath = join(resolve(buildDirectory), "native-package.json"), temporary = configPath + "." + randomBytes(8).toString("hex") + ".tmp";
  writeFileSync(temporary, JSON.stringify(config, null, 2) + "\n"); renameSync(temporary, configPath);
  return config;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.equal(process.argv.length, 6, "Expected loader, bridge, generated identity header and build directory.");
  console.log(JSON.stringify(packageNative(...process.argv.slice(2).map(path => resolve(path))), null, 2));
}
