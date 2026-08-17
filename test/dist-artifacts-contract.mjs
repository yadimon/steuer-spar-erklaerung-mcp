import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertDistArtifacts,
  inspectDistArtifacts,
  pruneStaleDistArtifacts,
} from "../scripts/dist-artifacts.mjs";

const fixture = mkdtempSync(join(tmpdir(), "sse-dist-artifacts-"));
try {
  const src = join(fixture, "src");
  const dist = join(fixture, "dist");
  mkdirSync(join(src, "nested"), { recursive: true });
  mkdirSync(join(dist, "nested"), { recursive: true });
  writeFileSync(join(fixture, "package.json"), '{"name":"steuer-spar-erklaerung-mcp"}\n', "utf8");
  writeFileSync(join(src, "kept.ts"), "export const kept = true;\n", "utf8");
  writeFileSync(join(dist, "kept.js"), "export const kept = true;\n", "utf8");
  writeFileSync(join(dist, "kept.js.map"), "{}\n", "utf8");
  writeFileSync(join(dist, "nested", "orphan.js"), "export const orphan = true;\n", "utf8");
  writeFileSync(join(dist, "nested", "orphan.js.map"), "{}\n", "utf8");
  writeFileSync(join(dist, "foreign.txt"), "nicht loeschen\n", "utf8");

  assert.throws(
    () => pruneStaleDistArtifacts(fixture),
    /unbekannte Dateien; nichts wird geloescht.*foreign\.txt/u,
  );
  assert(existsSync(join(dist, "nested", "orphan.js")), "Fail-Closed-Pruning loeschte vor der Validierung.");
  rmSync(join(dist, "foreign.txt"));

  const before = inspectDistArtifacts(fixture);
  assert.deepEqual(before.unknown, []);
  assert.deepEqual(before.stale.map((entry) => entry.local).sort(), [
    "nested/orphan.js",
    "nested/orphan.js.map",
  ]);
  assert.deepEqual(pruneStaleDistArtifacts(fixture), ["nested/orphan.js", "nested/orphan.js.map"]);
  assert(existsSync(join(dist, "kept.js")) && existsSync(join(dist, "kept.js.map")));
  assert.equal(existsSync(join(dist, "nested")), false, "Leerer veralteter Unterordner blieb zurueck.");
  assert.doesNotThrow(() => assertDistArtifacts(fixture));
  assert.doesNotThrow(() => assertDistArtifacts(process.cwd()));
} finally {
  rmSync(fixture, { recursive: true, force: true });
}

process.stdout.write("dist-Artefakte: quellbasiertes Pruning, Fremddatei-Stopp und Release-Ratsche bestanden\n");
