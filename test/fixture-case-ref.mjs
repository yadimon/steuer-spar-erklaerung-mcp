import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { basename, dirname, extname, resolve } from "node:path";

/**
 * Rechnet eine Wegwerfkopie in die maschinenneutrale `cases:`-Referenz um.
 *
 * Die MCP-Schicht nimmt seit der Pfadredaktion bewusst keine PC-Pfade mehr
 * entgegen: `sse_desktop_start` und `sse_launch` kennen nur noch `caseRef`
 * innerhalb des lokal konfigurierten Fallbereichs. Die Live-Skripte bekamen
 * ihre Fixture aber weiterhin als absoluten Pfad und reichten ihn als `file`
 * durch - das wies das strikte Werkzeugschema ab, und zwar in allen acht
 * Skripten gleichzeitig. Deshalb steht die Umrechnung hier an einer Stelle.
 *
 * Das Live-Gate legt die Kopie genau in den Fallbereich der Test-API; liegt
 * sie woanders, bricht das hier laut ab statt still einen falschen Bereich zu
 * adressieren.
 */
export function fixtureCaseRef(fixture, { extension } = {}) {
  assert(fixture, "Ohne Fixture-Pfad gibt es keine Fallreferenz.");
  assert(existsSync(fixture), `Fixture existiert nicht: ${fixture}`);
  if (extension) {
    assert.equal(
      extname(fixture).toLowerCase(),
      extension.toLowerCase(),
      `Fixture hat nicht die erwartete Endung ${extension}: ${fixture}`,
    );
  }
  const caseDir = process.env.SSE_TEST_CASE_DIR;
  assert(caseDir, "SSE_TEST_CASE_DIR aus dem isolierten Test-API-Wrapper fehlt.");
  assert.equal(
    resolve(dirname(fixture)).toLowerCase(),
    resolve(caseDir).toLowerCase(),
    `Die Fixture liegt nicht im Fallbereich der Test-API (${caseDir}): ${fixture}`,
  );
  return `cases:${basename(fixture)}`;
}
