import assert from "node:assert/strict";
import { closeSync, fsyncSync, openSync, unlinkSync, writeFileSync } from "node:fs";
import { callApiOperation } from "../dist/api-client.js";
import { DESKTOP_MARKER_PATH } from "../dist/desktop-marker.js";

const markerText = JSON.stringify({
  schemaVersion: 1,
  owner: "center-test",
  name: "SSECenterApiContract",
  pid: process.pid,
});
const descriptor = openSync(DESKTOP_MARKER_PATH, "wx", 0o600);
try {
  writeFileSync(descriptor, markerText, "utf8");
  fsyncSync(descriptor);
} finally { closeSync(descriptor); }

try {
  const result = await callApiOperation("page", {}, 10_000);
  assert.equal(result.ok, false);
  assert.equal(result.kind, "desktop-marker-owner",
    "Die HTTP-API muss die Marker-Owner-Grenze strukturiert erhalten.");
} finally {
  unlinkSync(DESKTOP_MARKER_PATH);
}
