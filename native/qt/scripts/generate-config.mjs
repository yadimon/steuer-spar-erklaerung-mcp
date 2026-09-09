import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

export const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const sourceFiles = [
  "CMakeLists.txt", "bridge.cpp", "bridge-load.cpp", "bridge-protocol.h", "bridge-session-server.h",
  "bridge-window-context.h", "bridge-windows.h", "bridge-table-snapshot.h", "bridge-discovery.h", "bridge-image.h",
  "bridge-interactive-session.h", "bridge-accessibility.h", "bridge-accessible-types.h", "bridge-desktop-marker.h", "bridge-desktop-launch.h", "bridge-desktop-start.h",
  "bridge-desktop-stop.h", "bridge-stop-policy.h", "bridge-stop-uia.h",
  "bridge-broker.h", "bridge-pipe-peer.h", "bridge-desktop-status.h", "compatibility.json", "scripts/generate-config.mjs", "scripts/package.mjs",
  "third_party/nlohmann/json.hpp", "third_party/nlohmann/LICENSE.MIT", "third_party/nlohmann/UPSTREAM.json", "THIRD_PARTY.md",
  "../../profiles/2025/profile.json",
  "../../profiles/2025/page-objects.json",
].sort();

export function compatibility() {
  const binding = JSON.parse(readFileSync(join(root, "compatibility.json"), "utf8"));
  assert.deepEqual(Object.keys(binding).sort(), ["profile", "sha256"]);
  const profile = JSON.parse(readFileSync(join(root, "../../profiles/2025/profile.json"), "utf8"));
  assert.equal(profile.status, "supported"); assert.equal(profile.operationAccess, "full");
  assert.deepEqual(binding.profile, { id: profile.id, taxYear: profile.taxYear, engineFileMajor: profile.engineFileMajor,
    verifiedBuild: profile.verifiedBuild, qtVersion: profile.nativeQtVersion });
  assert.deepEqual(Object.keys(binding.sha256).sort(), ["Dm.dll", "Qt6Core.dll", "Qt6Gui.dll", "Qt6Widgets.dll", "SSE.exe"]);
  for (const digest of Object.values(binding.sha256)) assert.match(digest, /^[A-F0-9]{64}$/u);
  return binding;
}

export function sourceIdentity() {
  const hash = createHash("sha256");
  for (const name of sourceFiles) {
    hash.update(name + "\0"); hash.update(readFileSync(join(root, name), "utf8").replaceAll("\r\n", "\n")); hash.update("\0");
  }
  return hash.digest("hex");
}

export function generate(directory) {
  const binding = compatibility(), identity = sourceIdentity();
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "bridge-identity.h"), `#pragma once\n#define SSE_BRIDGE_SOURCE_DIGEST "${identity}"\n`);
  const lines = ["#pragma once", `#define SSE_NATIVE_PROFILE_JSON ${JSON.stringify(JSON.stringify(binding.profile))}`];
  const profile = JSON.parse(readFileSync(join(root, "../../profiles/2025/profile.json"), "utf8"));
  const startProfile = Object.fromEntries(["product", "taxYear", "engineFileMajor", "executable", "startModes", "additionalCaseYears"]
    .map(key => [key, profile[key]]));
  lines.push(`#define SSE_NATIVE_START_PROFILE_JSON ${JSON.stringify(JSON.stringify(startProfile))}`);
  const pages = JSON.parse(readFileSync(join(root, "../../profiles/2025/page-objects.json"), "utf8"));
  const tools = Object.values(pages.windows).filter(item => item.role === "nonmodal-tool-window"
    && item.closePolicy === "allow-exact-nonmodal-close").map(item => item.title);
  lines.push(`#define SSE_NATIVE_STOP_TOOLS_JSON ${JSON.stringify(JSON.stringify(tools))}`);
  for (const [name, macro] of [["SSE.exe", "EXE"], ["Dm.dll", "DM"], ["Qt6Core.dll", "QT_CORE"],
    ["Qt6Gui.dll", "QT_GUI"], ["Qt6Widgets.dll", "QT_WIDGETS"]]) {
    lines.push(`#define SSE_NATIVE_${macro}_SHA256 "${binding.sha256[name]}"`);
  }
  writeFileSync(join(directory, "bridge-compatibility.h"), lines.join("\n") + "\n");
  return identity;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.equal(process.argv.length, 3, "Expected one generated-output directory.");
  console.log("Native Qt source identity: " + generate(resolve(process.argv[2])));
}
