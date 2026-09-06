import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
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
const sha256TokenPattern = /(?<![0-9A-Fa-f])[0-9A-Fa-f]{64}(?![0-9A-Fa-f])/gu;
const taxIdPattern = /(?<!\d)\d{11}(?!\d)/u;
const rules = [
  { label: "privater Windows-Benutzerpfad", pattern: /[A-Za-z]:[\\/]Users[\\/](?!Public(?:[\\/]|$))/iu },
  { label: "privater Ablagepfad", pattern: /Meine\s+Ablage|Google\s+Drive|OneDrive[\\/](?:Personal|Privat)/iu },
  { label: "E-Mail-Adresse", pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu },
  { label: "deutsche IBAN", pattern: /\bDE\d{20}\b/u },
  {
    label: "elfstellige Steuer-ID",
    pattern: taxIdPattern,
    sanitize: (source) => source.replace(sha256TokenPattern, ""),
    historyPattern: String.raw`(?:[0-9A-Fa-f]{64})(*SKIP)(*F)|(?<!\d)\d{11}(?!\d)`,
  },
  { label: "privater Schlüssel", pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/u },
  { label: "GitHub-Zugriffstoken", pattern: /\b(?:github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{20,})\b/u },
  { label: "Cloud-Zugriffsschlüssel", pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/u },
  { label: "OpenAI-Zugriffstoken", pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/u },
];
assert.match(["SteuerID", "12345", "678901"].join(""), taxIdPattern,
  "Eine Steuer-ID muss auch direkt neben einem Hex-Buchstaben erkannt werden.");
const syntheticSha256 = "a4a6daee01c00a0cd0a59fde3a16f997f35981003677cfb135bed2c97db51779";
assert.equal(syntheticSha256.replace(sha256TokenPattern, ""), "",
  "Ein vollstaendiges SHA-256-Token muss vor dem Steuer-ID-Scan entfernt werden.");
const forbiddenPaths = [
  { label: "lokale Agenten-Arbeitsdatei", pattern: /^(?:\.agents|\.claude|\.codex|\.superpowers)(?:\/|$)/iu },
  { label: "agentenspezifischer Arbeitsplan", pattern: /^docs\/(?:superpowers|CODEX-|CLAUDE-)/iu },
  { label: "lokale Umgebungsdatei", pattern: /(?:^|\/)\.env(?:\..+)?$/iu },
  { label: "lokale npm-Konfiguration", pattern: /(?:^|\/)\.npmrc$/iu },
  { label: "lokale Zugangsdaten", pattern: /(?:^|\/)(?:auth|credentials)\.json$/iu },
  { label: "lokales Gastpasswort", pattern: /(?:^|\/)guest-password\.txt$/iu },
  { label: "lokaler SSH-Schluessel", pattern: /(?:^|\/)id_(?:rsa|ed25519)$/iu },
  { label: "lokales Git-Historienbundle", pattern: /\.bundle$/iu },
  { label: "mögliche Schlüsseldatei", pattern: /\.(?:key|pem|p12|pfx|jks|kdbx|ovpn)$/iu },
  {
    label: "Steuerfall- oder Wiederherstellungsdatei",
    pattern: /\.\$?(?:ESt|Gew|GewErfass|Fest|Erm|Vorweg|KonsUst|Zulage|NVBescheinigung)20\d{2}\$?(?:_Backup)?$/iu,
  },
];
const violations = [];
let checked = 0;
for (const file of listed.split("\0").filter(Boolean)) {
  const absolute = resolve(root, file);
  if (!existsSync(absolute)) continue;
  const normalizedFile = file.replaceAll("\\", "/");
  for (const rule of forbiddenPaths) {
    if (rule.pattern.test(normalizedFile)) violations.push(`${file}: ${rule.label}`);
  }
  if (!textExtensions.has(extname(file).toLowerCase())) continue;
  const source = readFileSync(absolute, "utf8");
  checked += 1;
  for (const rule of rules) {
    const inspected = rule.sanitize ? rule.sanitize(source) : source;
    if (rule.pattern.test(inspected)) violations.push(`${relative(root, absolute)}: ${rule.label}`);
  }
  if (
    file.replaceAll("\\", "/").startsWith("docs/entwicklung/erfahrungen/") &&
    /\b\d{1,3}(?:\.\d{3})+,\d{2}\s*(?:€|EUR)\b/iu.test(source)
  ) {
    violations.push(`${file}: konkreter Tausenderbetrag in Erfahrungsnotiz`);
  }
}
assert.deepEqual(violations, [], `Repository enthaelt moegliche private Daten:\n${violations.join("\n")}`);

const revisions = execFileSync("git", ["rev-list", "--all"], {
  cwd: root,
  encoding: "utf8",
  windowsHide: true,
}).trim().split(/\r?\n/u).filter(Boolean);
assert(revisions.length > 0, "Git-Historie ist für den Privacy-Scan nicht verfügbar.");

const historyPattern = rules
  .map(({ pattern, historyPattern: override }) => `(?:${override ?? pattern.source})`)
  .join("|");
const historyViolations = [];
for (let offset = 0; offset < revisions.length; offset += 100) {
  const historyScan = spawnSync(
    "git",
    ["grep", "-n", "-I", "-i", "-P", historyPattern, ...revisions.slice(offset, offset + 100)],
    { cwd: root, encoding: "utf8", windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
  );
  assert(
    historyScan.status === 0 || historyScan.status === 1,
    `Git-Historie konnte nicht geprüft werden:\n${historyScan.stderr}`,
  );
  if (historyScan.stdout) historyViolations.push(historyScan.stdout.trimEnd());
}
assert.deepEqual(
  historyViolations,
  [],
  `Git-Historie enthaelt moegliche private Daten:\n${historyViolations.join("\n")}`,
);

const historyNames = execFileSync("git", ["log", "--all", "--name-only", "--format="], {
  cwd: root,
  encoding: "utf8",
  windowsHide: true,
});
const sensitiveHistoryPaths = [...new Set(historyNames.split(/\r?\n/u).filter(Boolean))]
  .flatMap((file) => forbiddenPaths
    .filter((rule) => rule.label !== "agentenspezifischer Arbeitsplan" && rule.pattern.test(file.replaceAll("\\", "/")))
    .map((rule) => `${file}: ${rule.label}`));
assert.deepEqual(
  sensitiveHistoryPaths,
  [],
  `Git-Historie enthaelt sensible Dateinamen:\n${sensitiveHistoryPaths.join("\n")}`,
);

// AGENTS.md ist die einzige Quelle der Agentenregeln; CLAUDE.md verweist nur
// darauf. Zwei Fassungen derselben Regel laufen auseinander, und die
// veraltete gilt dann fuer irgendein Werkzeug weiter.
//
// Diese Pruefung ist die Lehre aus einem Release, in dem Namen von
// Pruefumgebungen und die Pruefsumme eines Transferarchivs oeffentlich wurden.
const agenten = readFileSync(resolve(root, "AGENTS.md"), "utf8");
const claude = readFileSync(resolve(root, "CLAUDE.md"), "utf8");
const regelStart = agenten.indexOf("<!-- REGEL:PRIVATES -->");
const regelEnde = agenten.indexOf("<!-- /REGEL:PRIVATES -->");
assert(regelStart >= 0 && regelEnde > regelStart,
  "AGENTS.md fuehrt den Regelblock REGEL:PRIVATES nicht.");
const regel = agenten.slice(regelStart, regelEnde);
for (const pflicht of ["localdev/", ".private/", "perf:api-mega"]) {
  assert(regel.includes(pflicht),
    `Die Regel nennt ${pflicht} nicht und bleibt damit ohne brauchbare Anweisung.`);
}
assert.match(claude, /\[AGENTS\.md\]\(\.\/AGENTS\.md\)/u,
  "CLAUDE.md muss per relativem Link auf AGENTS.md verweisen; ein Symlink ist unter Windows nicht verlaesslich.");
assert(!claude.includes("<!-- REGEL:PRIVATES -->"),
  "CLAUDE.md darf keine eigene Fassung der Regel tragen, sondern nur auf AGENTS.md verweisen.");

process.stdout.write(
  `Repository-Privacy: ${checked} Textdateien und ${revisions.length} Commits ohne private Pfade, IDs, Konten oder Zugangsdaten; Agentenregeln allein in AGENTS.md, CLAUDE.md verweist darauf\n`,
);
