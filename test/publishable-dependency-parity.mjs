/**
 * Jede Fremdabhaengigkeit der beiden veroeffentlichbaren Pakete muss auch an der
 * Wurzel haengen.
 *
 * Wurzel-Lockfile, Wurzel-Audit und die Offline-Suite sehen nur, was an der
 * Wurzel deklariert ist. Traegt jemand eine Abhaengigkeit ausschliesslich in
 * `packages/mcp` oder `packages/api` ein, liefern wir Fremdcode aus, den keines
 * dieser Werkzeuge je geprueft hat - und im Repository faellt es nicht auf, weil
 * die Pakete erst beim Publizieren zusammengebaut werden.
 *
 * Die Selbstreferenz der Pakete aufeinander ist ausgenommen; sie existiert
 * absichtlich nur dort.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (...parts) => JSON.parse(readFileSync(join(root, ...parts), "utf8"));

const rootPackage = read("package.json");
assert.deepEqual(
  rootPackage.workspaces,
  ["packages/*"],
  "Der Audit-Vertrag setzt genau diese Workspace-Deklaration voraus.",
);

const rootDependencies = new Set(Object.keys(rootPackage.dependencies ?? {}));
const publishable = ["api", "mcp"];
const uncovered = [];
let checked = 0;

for (const name of publishable) {
  const packageJson = read("packages", name, "package.json");
  for (const dependency of Object.keys(packageJson.dependencies ?? {})) {
    // Die Selbstreferenz auf das jeweils andere eigene Paket ist der Grund fuer
    // den eingeschraenkten Audit und darf an der Wurzel fehlen.
    if (dependency.startsWith("@yadimon/")) continue;
    checked += 1;
    if (!rootDependencies.has(dependency)) uncovered.push(`${packageJson.name} -> ${dependency}`);
  }
}

assert.deepEqual(
  uncovered,
  [],
  "Diese Abhaengigkeiten haengen nur an einem veroeffentlichbaren Paket und werden vom " +
    `Wurzel-Audit deshalb nicht erfasst:\n  ${uncovered.join("\n  ")}\n` +
    "Entweder an der Wurzel ergaenzen oder den Audit im Release-Gate anders fuehren.",
);
assert(checked >= 3, `Nur ${checked} Fremdabhaengigkeiten geprueft - die Pruefung greift ins Leere.`);

process.stdout.write(
  `Publish-Abhaengigkeiten: ${checked} Fremdabhaengigkeiten der ${publishable.length} ` +
    "veroeffentlichbaren Pakete sind vom Wurzel-Audit gedeckt\n",
);
