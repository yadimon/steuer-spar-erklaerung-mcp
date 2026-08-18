/**
 * Echte Worker-Vertraege fuer alle Datei- und Katalogoperationen, die keine
 * laufende SSE-Oberflaeche brauchen.
 *
 * Genau diese Ecke war bisher nur schematisch abgedeckt: Der veroeffentlichte
 * Result_backup_cases-Vertrag verlangte eine Liste, waehrend der Worker eine
 * Anzahl lieferte - jeder echte Aufruf endete mit HTTP 502. Der Test faehrt
 * deshalb bewusst ueber die HTTP-API, damit die Ergebnisschemata mitpruefen.
 *
 * Es werden ausschliesslich synthetische AKAD-Dateien im isolierten
 * Test-Fallordner verwendet; echte Steuerdaten kommen nicht vor.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { callApiOperation } from "../dist/api-client.js";

const caseDir = process.env.SSE_TEST_CASE_DIR;
const resultDir = process.env.SSE_TEST_RESULT_DIR;
assert(caseDir && resultDir, "Der Test laeuft nur ueber test/with-api.mjs.");

const uint32 = (value) => {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value);
  return buffer;
};
const record = (name, type, value) => {
  const nameBytes = Buffer.from(`${name}\0`, "ascii");
  return Buffer.concat([uint32(nameBytes.length), nameBytes, Buffer.from([type]), uint32(value.length), value]);
};
const textRecord = (name, value) => record(name, 4, Buffer.from(`${value}\0`, "utf8"));
const syntheticCase = (steuernummer) => {
  const uuid = Buffer.from("12345678-1234-1234-1234-123456789abc\0", "ascii");
  return Buffer.concat([
    Buffer.from("AKAD", "ascii"),
    Buffer.alloc(8),
    uint32(uuid.length),
    uuid,
    Buffer.from("FIIF", "ascii"),
    Buffer.from([0xaa, 0xbb, 0xcc]),
    textRecord("FileType", "Gew"),
    textRecord("VJahr", "2025"),
    textRecord("Steuernummer", steuernummer),
    textRecord("ElsterTransferTime", ""),
    record("svCrypted", 12, Buffer.from([1, 2, 3, 4])),
  ]);
};
const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex").toUpperCase();
const call = (operation, args = {}, timeoutMs = 120_000) => callApiOperation(operation, args, timeoutMs);

mkdirSync(caseDir, { recursive: true });
const alphaPath = join(caseDir, "alpha.Gew2025");
const betaPath = join(caseDir, "beta.Gew2025");
writeFileSync(alphaPath, syntheticCase("synthetisch-alpha"));
writeFileSync(betaPath, syntheticCase("synthetisch-beta"));
const alphaHash = sha256(alphaPath);
const betaHash = sha256(betaPath);

let checks = 0;
const expect = (condition, message) => {
  checks += 1;
  assert(condition, message);
};

// -------------------------------------------------------------- Katalogpfade
const capabilities = await call("capabilities");
expect(capabilities.profile?.id === (process.env.SSE_PROFILE_ID ?? "2025"), "capabilities meldet ein fremdes Profil.");
expect(typeof capabilities.operationPolicy === "object", "capabilities ohne Operationsmatrix.");

const info = await call("product_info");
expect(typeof info.profileId === "string", "product_info ohne profileId.");
expect(Number.isInteger(info.taxYear), "product_info ohne Steuerjahr.");

const health = await call("health");
expect(typeof health.running === "boolean", "health ohne running-Status.");

const status = await call("workspace_status");
expect(status.workspaceReady === true, "workspace_status meldet den Arbeitsbereich nicht als bereit.");
expect(status.caseDirectoryReady === true, "workspace_status meldet den Fallordner nicht als bereit.");
expect(typeof status.configurationFingerprint === "string", "workspace_status ohne Konfigurationsfingerprint.");

// ------------------------------------------------------------ Falldateipfade
const listed = await call("list_cases", {});
expect(listed.count === 2, `list_cases fand ${listed.count} statt 2 Faelle.`);
const names = listed.cases.map((entry) => entry.name).sort();
expect(names.join(",") === "alpha.Gew2025,beta.Gew2025", `list_cases lieferte ${names.join(",")}.`);
expect(listed.cases.every((entry) => entry.transmitted === false),
  "Eine synthetische Datei ohne ElsterTransferTime darf nicht als uebermittelt gelten.");

const hashed = await call("case_hash", { ref: "cases:alpha.Gew2025" });
expect(hashed.sha256 === alphaHash, "case_hash weicht vom lokalen Hash ab.");
expect(hashed.exists === true && hashed.size > 0, "case_hash ohne Existenz-/Groessenangabe.");

const copied = await call("make_working_copy", {
  sourceRef: "cases:alpha.Gew2025",
  targetRef: "cases:alpha-arbeit.Gew2025",
  expectedSourceHash: alphaHash,
});
expect(copied.copied === true && copied.verified === true, "make_working_copy bestaetigte die Kopie nicht.");
expect(copied.targetHash === alphaHash && copied.sourceHash === alphaHash, "make_working_copy meldet abweichende Hashes.");
expect(copied.target === "cases:alpha-arbeit.Gew2025", "make_working_copy gab keinen redigierten Zielpfad zurueck.");

const staleCopy = await call("make_working_copy", {
  sourceRef: "cases:alpha.Gew2025",
  targetRef: "cases:alpha-veraltet.Gew2025",
  expectedSourceHash: "0".repeat(64),
});
expect(staleCopy.ok === false && staleCopy.kind === "precondition-failed",
  `Ein falscher Quellhash muss die Kopie verhindern: ${JSON.stringify(staleCopy)}`);
expect(!existsSync(join(caseDir, "alpha-veraltet.Gew2025")), "Die abgelehnte Kopie blieb liegen.");

// --------------------------------------------------------------- Sicherungen
const backup = await call("backup_cases", { destinationRef: "backups:lauf-1" });
expect(backup.anzahl === 3, `backup_cases sicherte ${backup.anzahl} statt 3 Dateien.`);
expect(Array.isArray(backup.files) && backup.files.length === 3,
  `backup_cases muss die gesicherten Dateien als Liste melden: ${JSON.stringify(backup.files)}`);
for (const entry of backup.files) {
  expect(typeof entry.name === "string" && /^[A-F0-9]{64}$/.test(entry.sha256),
    `backup_cases: unvollstaendiger Eintrag ${JSON.stringify(entry)}`);
}
expect(backup.dest === "backups:lauf-1", "backup_cases gab kein redigiertes Ziel zurueck.");
expect(backup.manifest === "backups:lauf-1/pruefsummen.csv",
  `backup_cases meldet das Pruefsummenmanifest nicht: ${backup.manifest}`);

const repeated = await call("backup_cases", { destinationRef: "backups:lauf-1" });
expect(repeated.ok === false && repeated.kind === "precondition-failed",
  "Ein bereits vorhandenes Sicherungsziel darf nicht ueberschrieben werden.");

// ------------------------------------------------------------------- Archiv
const staleArchive = await call("archive_cases", {
  destinationRef: "backups:archiv-1",
  cases: [{ name: "beta.Gew2025", expectedSha256: "0".repeat(64) }],
  expectedRemaining: [
    { name: "alpha.Gew2025", expectedSha256: alphaHash },
    { name: "alpha-arbeit.Gew2025", expectedSha256: alphaHash },
  ],
});
expect(staleArchive.ok === false, "Ein falscher Hash darf nichts archivieren.");
expect(existsSync(betaPath), "Der Fall wurde trotz Hashfehler verschoben.");

const archived = await call("archive_cases", {
  destinationRef: "backups:archiv-1",
  cases: [{ name: "beta.Gew2025", expectedSha256: betaHash }],
  expectedRemaining: [
    { name: "alpha.Gew2025", expectedSha256: alphaHash },
    { name: "alpha-arbeit.Gew2025", expectedSha256: alphaHash },
  ],
});
expect(archived.archived === 1, `archive_cases verschob ${archived.archived} statt 1 Datei.`);
expect(Array.isArray(archived.files) && archived.files[0].name === "beta.Gew2025",
  `archive_cases meldet die verschobene Datei nicht: ${JSON.stringify(archived.files)}`);
expect(Array.isArray(archived.remaining) && archived.remaining.length === 2,
  "archive_cases meldet den Restbestand nicht.");
expect(archived.recoverable === true, "archive_cases meldet den Vorgang nicht als umkehrbar.");
expect(!existsSync(betaPath), "Der archivierte Fall liegt noch im Fallordner.");
expect((await call("list_cases", {})).count === 2, "Der Fallordner enthaelt nach dem Archivieren die falsche Zahl Faelle.");

// -------------------------------------------------------------- Arbeitsdaten
const textRef = "workspace:notiz.txt";
const written = await call("workspace_file_write_text", { ref: textRef, text: "Belegnotiz\n" });
expect(written.ref === textRef && written.bytes === 11, `workspace_file_write_text: ${JSON.stringify(written)}`);
const read = await call("workspace_file_read_text", { ref: textRef });
expect(read.text === "Belegnotiz\n", "workspace_file_read_text lieferte einen anderen Inhalt.");
expect(read.sha256 === written.sha256, "Schreib- und Lesehash weichen ab.");

const files = await call("workspace_file_list", { ref: ".", area: "workspace" });
expect(files.files.some((entry) => entry.ref === textRef), "workspace_file_list zeigt die neue Datei nicht.");

const backupsListing = await call("workspace_file_list", { ref: ".", area: "backups" });
expect(backupsListing.files.some((entry) => entry.ref === "backups:archiv-1/beta.Gew2025"),
  "workspace_file_list zeigt die archivierte Datei im Sicherungsbereich nicht.");

// Ein Pfadausbruch scheitert schon am Argumentvertrag des Clients und
// erreicht damit weder Netz noch Dateisystem.
await assert.rejects(
  call("workspace_file_write_text", { ref: "workspace:../ausserhalb.txt", text: "nein" }),
  (error) => error.kind === "bad-args",
  "Ein Pfadausbruch muss bereits als bad-args abgewiesen werden.",
);
checks += 1;
// Textablagen werden exklusiv angelegt; ein zweiter Schreibvorgang darf eine
// vorhandene Notiz nicht stillschweigend ueberschreiben.
const overwritten = await call("workspace_file_write_text", { ref: textRef, text: "andere Notiz\n" });
expect(overwritten.ok === false,
  `Eine vorhandene Textdatei darf nicht ueberschrieben werden: ${JSON.stringify(overwritten)}`);
expect((await call("workspace_file_read_text", { ref: textRef })).text === "Belegnotiz\n",
  "Der abgelehnte Schreibvorgang hat den Inhalt trotzdem veraendert.");

process.stdout.write(
  `Datei- und Katalogoperationen am echten Worker: ${checks} Zusicherungen bestanden ` +
  `(Ergebnisvertraege inbegriffen, Ergebnisbereich ${resultDir ? "gebunden" : "fehlt"})\n`,
);
