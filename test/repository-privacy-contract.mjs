import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { extname, relative, resolve } from "node:path";

const root = resolve(process.cwd());
const listed = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
  cwd: root,
  encoding: "utf8",
  windowsHide: true,
});
const textExtensions = new Set([
  ".cmd", ".config", ".cpp", ".cs", ".csv", ".h", ".hpp", ".html", ".ini", ".js", ".json", ".map", ".md", ".mjs",
  ".ps1", ".svg", ".toml", ".ts", ".txt", ".vbs", ".xml", ".yaml", ".yml",
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
  { label: "privater Arbeitsbereich", pattern: /^(?:\.private|\.tmp|localdev|documents|backups|cases|results|workspace|tmp)(?:\/|$)/iu },
  { label: "lokale Agenten-Arbeitsdatei", pattern: /^(?:\.agents|\.claude|\.codex|\.superpowers)(?:\/|$)/iu },
  { label: "agentenspezifischer Arbeitsplan", pattern: /^docs\/(?:superpowers|CODEX-|CLAUDE-)/iu },
  { label: "lokale Umgebungsdatei", pattern: /(?:^|\/)\.env(?:\..+)?$/iu },
  { label: "lokale npm-Konfiguration", pattern: /(?:^|\/)\.npmrc$/iu },
  { label: "lokale Zugangsdaten", pattern: /(?:^|\/)(?:auth|credentials)\.json$/iu },
  { label: "lokales Gastpasswort", pattern: /(?:^|\/)guest-password\.txt$/iu },
  { label: "lokaler SSH-Schluessel", pattern: /(?:^|\/)id_(?:rsa|ed25519)$/iu },
  { label: "lokales Git-Historienbundle", pattern: /\.bundle$/iu },
  { label: "lokale virtuelle Maschine", pattern: /\.(?:vbox(?:-prev)?|vdi|vhdx?|avhdx?|vmdk|ova|ovf|sav|nvram|vmem|vmrs|vmcx)$/iu },
  { label: "mögliche Schlüsseldatei", pattern: /\.(?:key|pem|p12|pfx|jks|kdbx|ovpn)$/iu },
  {
    label: "Steuerfall- oder Wiederherstellungsdatei",
    pattern: /\.\$?(?:ESt|Gew|GewErfass|Fest|Erm|Vorweg|KonsUst|Zulage|NVBescheinigung)20\d{2}\$?(?:_Backup)?$/iu,
  },
];
// Lokale Wartungsprofile wurden früher versioniert. Der aktuelle Bestand
// darf sie nicht erneut aufnehmen; die bestehenden Releases bleiben erhalten.
const currentOnlyPaths = [
  { label: "lokales Wartungsprofil", pattern: /^skills-data(?:\/|$)/iu },
  { label: "lokale Lernnotiz", pattern: /^docs\/ai-learning(?:\/|$)/iu },
  { label: "lokale Erfahrungsnotiz", pattern: /^docs\/entwicklung\/erfahrungen(?:\/|$)/iu },
];
const currentPathRules = [...forbiddenPaths, ...currentOnlyPaths];
const privatePathProbes = [
  ".private/example.txt", ".tmp/example.json", "localdev/example.md", "documents/example.txt",
  "backups/example.zip", "cases/example.json", "results/example.json", "workspace/example.txt",
  "tmp/example.txt", "skills-data/example.md", "docs/ai-learning/example.md",
  "docs/entwicklung/erfahrungen/example.md",
  "sample.vbox", "sample.vbox-prev", "sample.vdi", "sample.vhd", "sample.vhdx",
  "sample.avhd", "sample.avhdx", "sample.vmdk", "sample.ova", "sample.ovf", "sample.sav",
  "sample.nvram", "sample.vmem", "sample.vmrs", "sample.vmcx",
];
for (const file of privatePathProbes) {
  assert(currentPathRules.some(({ pattern }) => pattern.test(file)),
    `${file}: ein erzwungen hinzugefügter privater Pfad muss am Vertrag scheitern.`);
}
for (const file of [
  "src/worker.ts", "test/fixtures/example.json", "docs/ARCHITEKTUR.md",
  "plugin/steuer-spar-erklaerung/runtime/dist/api.js",
  "plugin/steuer-spar-erklaerung/runtime/powershell/sse-native.dll",
]) {
  assert(!currentPathRules.some(({ pattern }) => pattern.test(file)),
    `${file}: öffentlicher Produktbestand darf nicht als privater Pfad gelten.`);
}
const ignoredProbes = spawnSync("git", ["check-ignore", "--no-index", "--stdin", "-z"], {
  cwd: root,
  input: `${privatePathProbes.join("\0")}\0`,
  encoding: "utf8",
  windowsHide: true,
});
assert.equal(ignoredProbes.status, 0, ignoredProbes.stderr);
assert.deepEqual(ignoredProbes.stdout.split("\0").filter(Boolean), privatePathProbes,
  "Private Pfade müssen auch ohne den Vertrag bereits durch Git ignoriert werden.");
const violations = [];
// The exact unmodified upstream header contains public copyright contacts and
// numeric conversion constants. No path-wide or contact-pattern exception is allowed.
const upstreamSources = new Map([
  ["native/qt/third_party/nlohmann/json.hpp", "665fa14b8af3837966949e8eb0052d583e2ac105d3438baba9951785512cf921"],
]);
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
let checked = 0;
for (const file of listed.split("\0").filter(Boolean)) {
  const absolute = resolve(root, file);
  if (!existsSync(absolute)) continue;
  const normalizedFile = file.replaceAll("\\", "/");
  for (const rule of currentPathRules) {
    if (rule.pattern.test(normalizedFile)) violations.push(`${file}: ${rule.label}`);
  }
  if (!textExtensions.has(extname(file).toLowerCase())) continue;
  if (upstreamSources.has(normalizedFile)) {
    assert.equal(sha256(readFileSync(absolute)), upstreamSources.get(normalizedFile), "Vendored source differs from the reviewed upstream bytes.");
    checked += 1; continue;
  }
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
const upstreamHistory = new Map();
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
  for (const line of historyScan.stdout.trimEnd().split(/\r?\n/u).filter(Boolean)) {
    const match = /^([a-f0-9]{40,64}):([^:]+):[0-9]+:/u.exec(line);
    if (match && upstreamSources.has(match[2])) {
      const object = `${match[1]}:${match[2]}`;
      if (!upstreamHistory.has(object)) {
        const bytes = execFileSync("git", ["show", object], { cwd: root, windowsHide: true, maxBuffer: 2 * 1024 * 1024 });
        upstreamHistory.set(object, sha256(bytes) === upstreamSources.get(match[2]));
      }
      if (upstreamHistory.get(object)) continue;
    }
    historyViolations.push(line);
  }
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
const agenten = readFileSync(resolve(root, "AGENTS.md"), "utf8");
const claude = readFileSync(resolve(root, "CLAUDE.md"), "utf8");
const regelStart = agenten.indexOf("<!-- REGEL:PRIVATES -->");
const regelEnde = agenten.indexOf("<!-- /REGEL:PRIVATES -->");
assert(regelStart >= 0 && regelEnde > regelStart,
  "AGENTS.md fuehrt den Regelblock REGEL:PRIVATES nicht.");
const regel = agenten.slice(regelStart, regelEnde);
for (const pflicht of ["außerhalb dieses Repositorys", "perf:api-mega"]) {
  assert(regel.includes(pflicht),
    `Die Regel nennt ${pflicht} nicht und bleibt damit ohne brauchbare Anweisung.`);
}
assert(!regel.includes("gehört nach `localdev/`") && !regel.includes("gehört nach `.private/`"),
  "Die Regel darf private Arbeitsdaten nicht mehr in Unterverzeichnisse des öffentlichen Repositorys lenken.");
assert.match(claude, /\[AGENTS\.md\]\(\.\/AGENTS\.md\)/u,
  "CLAUDE.md muss per relativem Link auf AGENTS.md verweisen; ein Symlink ist unter Windows nicht verlaesslich.");
assert(!claude.includes("<!-- REGEL:PRIVATES -->"),
  "CLAUDE.md darf keine eigene Fassung der Regel tragen, sondern nur auf AGENTS.md verweisen.");

process.stdout.write(
  `Repository-Privacy: ${checked} Textdateien und ${revisions.length} Commits ohne private Pfade, IDs, Konten oder Zugangsdaten; Agentenregeln allein in AGENTS.md, CLAUDE.md verweist darauf\n`,
);
