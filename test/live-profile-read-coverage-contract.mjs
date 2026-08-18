import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  EXPERIMENTAL_2024_LIVE_READ_OPERATIONS,
  PROFILE_LIVE_READ_OPERATIONS,
  verifyExperimentalProfileReadCoverage,
  verifyProfileReadCoverage,
} from "./live-profile-read-coverage-lib.mjs";

const directory = mkdtempSync(join(tmpdir(), "sse-2024-read-coverage-"));
try {
  const records = Object.entries(PROFILE_LIVE_READ_OPERATIONS).flatMap(([profileId, operations]) =>
    operations.map((operation) => JSON.stringify({ label: "worker", profileId, operation, ok: true, ms: 1 })));
  records.push(JSON.stringify({ label: "worker", profileId: "2025", operation: "table_add", ok: true, ms: 1 }));
  writeFileSync(join(directory, "trace.jsonl"), `${records.join("\n")}\n`, "utf8");
  const result = verifyExperimentalProfileReadCoverage(directory, "2024");
  assert.equal(result.operations, EXPERIMENTAL_2024_LIVE_READ_OPERATIONS.length);
  const supported = verifyProfileReadCoverage(directory, "2025");
  assert.equal(supported.operations, PROFILE_LIVE_READ_OPERATIONS["2025"].length);

  writeFileSync(join(directory, "trace.jsonl"), JSON.stringify({
    label: "worker", profileId: "2024", operation: "page", ok: true, ms: 1,
  }) + "\n", "utf8");
  assert.throws(
    () => verifyExperimentalProfileReadCoverage(directory, "2024"),
    /2024-Profil hat nicht jede zugesicherte Leseoperation/u,
  );
} finally {
  rmSync(directory, { recursive: true, force: true });
}

process.stdout.write("OK: 2024-Live-Leseabdeckung verlangt profilgenaue erfolgreiche Worker-Traces.\n");
