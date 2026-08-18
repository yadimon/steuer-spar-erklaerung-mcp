import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

if (process.platform !== "win32") throw new Error("Der Center-Live-Runner benoetigt Windows.");

const env = {
  ...process.env,
  SSE_PROFILE_ID: "2025",
  SSE_CENTER_LIVE_TEST: "1",
  SSE_PRESERVE_TEST_SANDBOX_ON_FAILURE: "1",
};
for (const key of ["SSE_OPERATE_EXPERIMENTAL", "SSE_CASE_DIR", "SSE_TEST_CASE_DIR"]) delete env[key];

const run = spawnSync(
  process.execPath,
  ["test/with-api.mjs", process.execPath, "test/live-center-cases.mjs"],
  { cwd: resolve(process.cwd()), env, stdio: "inherit", windowsHide: true },
);
if (run.error) throw new Error(`Center-Livevertrag konnte nicht laufen: ${run.error.message}`, { cause: run.error });
assert.equal(run.signal, null, `Center-Livevertrag endete mit Signal ${run.signal}.`);
assert.equal(run.status, 0, `Center-Livevertrag scheiterte mit Exit ${run.status}.`);
process.stdout.write("Center-Live-Gate: Profil 2025 ohne sichtbares Fenster und ohne verbleibenden Center-Prozess bestanden\n");
