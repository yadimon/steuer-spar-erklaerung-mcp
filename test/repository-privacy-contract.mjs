import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { extname, relative, resolve } from "node:path";

const root = resolve(process.cwd());
const listed = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
  cwd: root,
  encoding: "utf8",
  windowsHide: true,
});
const textExtensions = new Set([
  ".cmd", ".cs", ".js", ".json", ".md", ".mjs", ".ps1", ".ts", ".txt", ".vbs", ".yaml", ".yml",
]);
const rules = [
  { label: "privater Windows-Benutzerpfad", pattern: /[A-Za-z]:[\\/]Users[\\/](?!Public(?:[\\/]|$))/iu },
  { label: "privater Ablagepfad", pattern: /Meine\s+Ablage|Google\s+Drive|OneDrive[\\/](?:Personal|Privat)/iu },
  { label: "E-Mail-Adresse", pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu },
  { label: "deutsche IBAN", pattern: /\bDE\d{20}\b/u },
  { label: "elfstellige Steuer-ID", pattern: /(?<!\d)\d{11}(?!\d)/u },
];
const violations = [];
let checked = 0;
for (const file of listed.split("\0").filter(Boolean)) {
  if (!textExtensions.has(extname(file).toLowerCase())) continue;
  const absolute = resolve(root, file);
  const source = readFileSync(absolute, "utf8");
  checked += 1;
  for (const rule of rules) {
    if (rule.pattern.test(source)) violations.push(`${relative(root, absolute)}: ${rule.label}`);
  }
  if (
    file.replaceAll("\\", "/").startsWith("docs/entwicklung/erfahrungen/") &&
    /\b\d{1,3}(?:\.\d{3})+,\d{2}\s*(?:€|EUR)\b/iu.test(source)
  ) {
    violations.push(`${file}: konkreter Tausenderbetrag in Erfahrungsnotiz`);
  }
}
assert.deepEqual(violations, [], `Repository enthaelt moegliche private Daten:\n${violations.join("\n")}`);
process.stdout.write(`Repository-Privacy: ${checked} Textdateien ohne private Pfade, IDs, Konten oder Erfahrungsbetraege\n`);
