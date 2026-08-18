import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, truncateSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CaseFileParserFallbackError,
  listCaseFiles,
  parseAkadCaseSummary,
  readCaseFileInfo,
} from "../dist/case-file.js";
import { loadProductProfile } from "../dist/product-profiles.js";
import { callWorker } from "../dist/worker.js";

const caseFileSource = readFileSync(join(process.cwd(), "src", "case-file.ts"), "utf8");
const caseHashSource = caseFileSource.slice(caseFileSource.indexOf("export async function readCaseFileInfo"));
assert.match(
  caseHashSource,
  /openCaseFile\(path, controller\.signal\)/u,
  "case_hash muss auch einen noch laufenden open-Aufruf an Abbruch und Timeout binden.",
);

const uint32 = (value) => {
  const result = Buffer.alloc(4);
  result.writeUInt32LE(value);
  return result;
};

const recordName = (name, type) => {
  const encoded = Buffer.concat([Buffer.from(name, "ascii"), Buffer.from([0])]);
  return Buffer.concat([uint32(encoded.length), encoded, Buffer.from([type])]);
};

const prefixedRecord = (name, type, value) => Buffer.concat([
  recordName(name, type),
  uint32(value.length),
  value,
]);

const textValue = (value, encoding = "utf8") => Buffer.concat([
  Buffer.from(value, encoding),
  Buffer.from([0]),
]);

const dateRecord = (name, day, month, year) => {
  const value = Buffer.alloc(4);
  value.writeUInt8(day, 0);
  value.writeUInt8(month, 1);
  value.writeUInt16LE(year, 2);
  return Buffer.concat([recordName(name, 5), value]);
};

const numberRecord = (name, value) => Buffer.concat([recordName(name, 6), Buffer.from([value])]);

function akadFixture(transferState, encryptedBytes = 8, includeEncrypted = true) {
  const uuid = textValue("12345678-1234-1234-1234-123456789abc", "ascii");
  const records = [
    prefixedRecord("FileType", 4, textValue("Gew")),
    prefixedRecord("VJahr", 4, textValue("2025")),
    prefixedRecord("Steuernummer", 4, Buffer.from([0x53, 0x74, 0xe4, 0])),
    prefixedRecord("FileSavedBy", 4, textValue("31.0.1.0")),
    dateRecord("FileSavedDate", 3, 8, 2026),
    numberRecord("MitElsterVersendetText", 1),
  ];
  const transferRecords = {
    sent: () => prefixedRecord("ElsterTransferTime", 4, textValue("02.08.2026 11:22:33")),
    "not-sent": () => prefixedRecord("ElsterTransferTime", 4, Buffer.from([0])),
    placeholder: () => prefixedRecord("ElsterTransferTime", 4, textValue("-")),
    whitespace: () => prefixedRecord("ElsterTransferTime", 4, textValue(" 02.08.2026 11:22:33 ")),
    unreadable: () => prefixedRecord("ElsterTransferTime", 4, textValue("spaeter")),
    "typed-date": () => dateRecord("ElsterTransferTime", 0, 0, 0),
    blob: () => prefixedRecord("ElsterTransferTime", 12, textValue("blob")),
    "mixed-case": () => prefixedRecord("elstertransfertime", 4, textValue("-")),
    missing: () => null,
  };
  const createTransferRecord = transferRecords[transferState];
  if (!createTransferRecord) throw new Error(`Unbekannter Fixture-Uebermittlungsstatus: ${transferState}`);
  const transferRecord = createTransferRecord();
  if (transferRecord) records.push(transferRecord);
  if (includeEncrypted) {
    const encryptedName = transferState === "mixed-case" ? "SVCRYPTED" : "svCrypted";
    records.push(prefixedRecord(encryptedName, 12, Buffer.alloc(encryptedBytes, 1)));
  }
  return Buffer.concat([
    Buffer.from("AKAD", "ascii"),
    Buffer.alloc(8),
    uint32(uuid.length),
    uuid,
    Buffer.from("FIIF", "ascii"),
    Buffer.from([0xaa, 0xbb, 0xcc]),
    ...records,
  ]);
}

const sent = parseAkadCaseSummary(akadFixture("sent"));
assert.deepEqual(sent.header, {
  FileType: "Gew",
  VJahr: "2025",
  Steuernummer: "Stä",
  FileSavedBy: "31.0.1.0",
  ElsterTransferTime: "02.08.2026 11:22:33",
  MitElsterVersendetText: 1,
});
assert.equal(sent.transmitted, true);
assert.equal(sent.transmittedReason, "übermittelt am 02.08.2026 11:22:33");

const notSent = parseAkadCaseSummary(akadFixture("not-sent"));
assert.equal(notSent.transmitted, false);
assert.equal(notSent.header.ElsterTransferTime, "");

const placeholder = parseAkadCaseSummary(akadFixture("placeholder"));
assert.equal(placeholder.transmitted, false);
assert.equal(placeholder.transmittedReason, "ElsterTransferTime ist der Platzhalter '-' - kein Versand");

const unreadable = parseAkadCaseSummary(akadFixture("unreadable"));
assert.equal(unreadable.transmitted, "unknown");
assert.match(unreadable.transmittedReason, /weder Platzhalter noch Zeitstempel/);

const missing = parseAkadCaseSummary(akadFixture("missing"));
assert.equal(missing.transmitted, "unknown");
assert.equal(missing.header.ElsterTransferTime, null);
assert.match(missing.transmittedReason, /nicht im Kopf gefunden/);

const typedDate = parseAkadCaseSummary(akadFixture("typed-date"));
assert.equal(typedDate.transmitted, "unknown");
assert.match(typedDate.transmittedReason, /unerwarteten Typ/);

const blob = parseAkadCaseSummary(akadFixture("blob"));
assert.equal(blob.transmitted, "unknown");
assert.match(blob.transmittedReason, /Typ 'blob'/);

const mixedCase = parseAkadCaseSummary(akadFixture("mixed-case"));
assert.equal(mixedCase.transmitted, false);
assert.equal(mixedCase.header.ElsterTransferTime, "-");

for (const malformed of [Buffer.from([1, 2, 3]), Buffer.alloc(64)]) {
  const summary = parseAkadCaseSummary(malformed);
  assert.equal(summary.transmitted, "unknown");
  assert.deepEqual(Object.values(summary.header), [null, null, null, null, null, null]);
}

const temporary = mkdtempSync(join(tmpdir(), "sse-case-file-contract-"));
try {
  const fixture = akadFixture("placeholder");
  const path = join(temporary, "muster.Gew2025");
  writeFileSync(path, fixture);
  const result = await readCaseFileInfo(path, loadProductProfile("2025"));
  assert.equal(result.ok, true);
  assert.equal(result.path, path);
  assert.equal(result.exists, true);
  assert.equal(result.size, fixture.length);
  assert.equal(result.sha256, createHash("sha256").update(fixture).digest("hex").toUpperCase());
  assert.match(result.mtimeUtc, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{7}Z$/);
  assert.equal(result.transmitted, false);

  const invalidCasePath = join(temporary, "ungueltig.ESt2025");
  writeFileSync(invalidCasePath, "kein AKAD", "utf8");
  const localInvalid = await readCaseFileInfo(invalidCasePath, loadProductProfile("2025"));
  const workerInvalid = await callWorker("case_hash", { path: invalidCasePath }, 30_000);
  for (const field of ["header", "transmitted", "transmittedReason"]) {
    assert.deepEqual(localInvalid[field], workerInvalid[field], `Ungueltiger AKAD-Kopf driftet bei '${field}'.`);
  }

  const parityStates = [
    "sent", "not-sent", "placeholder", "whitespace", "unreadable", "missing", "typed-date", "blob", "mixed-case",
  ];
  const parityPaths = parityStates.map((state) => {
    const parityPath = join(temporary, `parity-${state}.Gew2025`);
    writeFileSync(parityPath, akadFixture(state));
    return parityPath;
  });
  const parityArgs = join(temporary, "parity-args.json");
  writeFileSync(parityArgs, JSON.stringify({ paths: parityPaths }), "utf8");
  const powershell = process.env.SSE_POWERSHELL_EXE ??
    join(process.env.SystemRoot ?? process.env.WINDIR ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const parity = spawnSync(powershell, [
    "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
    "-File", join(process.cwd(), "test", "case-file-parser-parity.ps1"),
    "-ArgsFile", parityArgs,
  ], { encoding: "utf8", windowsHide: true });
  if (parity.error) throw parity.error;
  assert.equal(parity.signal, null, `PowerShell-Parserparitaet endete mit Signal ${parity.signal}.`);
  assert.equal(parity.status, 0, parity.stderr);
  const powershellSummaries = JSON.parse(parity.stdout.trim());
  assert.equal(powershellSummaries.length, parityPaths.length);
  parityPaths.forEach((parityPath, index) => {
    assert.deepEqual(
      parseAkadCaseSummary(akadFixture(parityStates[index])),
      powershellSummaries[index],
      `Node-/PowerShell-Parserdrift fuer ${parityStates[index]}`,
    );
  });

  for (const allowedName of ["gemischt.gEw2025", "folge.GewErfass2026_Backup"]) {
    const allowedPath = join(temporary, allowedName);
    writeFileSync(allowedPath, fixture);
    assert.equal((await readCaseFileInfo(allowedPath, loadProductProfile("2025"))).ok, true, allowedName);
  }

  const unsupported = join(temporary, "muster.Gew2024");
  writeFileSync(unsupported, fixture);
  await assert.rejects(
    readCaseFileInfo(unsupported, loadProductProfile("2025")),
    (error) => error?.kind === "unsupported-case",
  );
  const undeclaredNextYear = join(temporary, "muster.ESt2026");
  writeFileSync(undeclaredNextYear, fixture);
  await assert.rejects(
    readCaseFileInfo(undeclaredNextYear, loadProductProfile("2025")),
    (error) => error?.kind === "unsupported-case",
  );
  assert.throws(() => akadFixture("sentt"), /Unbekannter Fixture-Uebermittlungsstatus/);
  await assert.rejects(
    readCaseFileInfo(join(temporary, "fehlt.Gew2025"), loadProductProfile("2025")),
    (error) => error?.kind === "not-found",
  );

  const aborted = new AbortController();
  aborted.abort();
  await assert.rejects(
    readCaseFileInfo(path, loadProductProfile("2025"), { signal: aborted.signal }),
    (error) => error?.kind === "aborted",
  );
  const large = join(temporary, "gross.Gew2025");
  writeFileSync(large, fixture);
  truncateSync(large, 128 * 1024 * 1024);
  const midStreamAbort = new AbortController();
  const abortingRead = readCaseFileInfo(large, loadProductProfile("2025"), { signal: midStreamAbort.signal });
  setTimeout(() => midStreamAbort.abort(), 10);
  await assert.rejects(abortingRead, (error) => error?.kind === "aborted");

  const changing = join(temporary, "wechselnd.Gew2025");
  writeFileSync(changing, fixture);
  truncateSync(changing, 128 * 1024 * 1024);
  let changingTimestampMs = Date.now() + 1_000;
  const changingTimer = setInterval(() => {
    changingTimestampMs += 1_000;
    const changingTimestamp = new Date(changingTimestampMs);
    utimesSync(changing, changingTimestamp, changingTimestamp);
  }, 0);
  try {
    await assert.rejects(
      readCaseFileInfo(changing, loadProductProfile("2025")),
      (error) => error?.kind === "resource-changed",
    );
  } finally {
    clearInterval(changingTimer);
  }

  await assert.rejects(
    readCaseFileInfo(large, loadProductProfile("2025"), { timeoutMs: 1 }),
    (error) => error?.kind === "timeout",
  );

  const listDirectory = join(temporary, "list");
  mkdirSync(listDirectory);
  const largeEncryptedFixture = akadFixture("sent", 600 * 1024);
  writeFileSync(join(listDirectory, "primaer.Gew2025"), largeEncryptedFixture);
  writeFileSync(join(listDirectory, "sicherung.Gew2025_Backup"), akadFixture("placeholder"));
  writeFileSync(join(listDirectory, "folge.GewErfass2026"), akadFixture("whitespace"));
  writeFileSync(join(listDirectory, "fremd.ESt2026"), akadFixture("missing"));
  writeFileSync(join(listDirectory, "notiz.txt"), "kein Fall");

  const listed = await listCaseFiles(listDirectory, loadProductProfile("2025"));
  assert.equal(listed.count, 2);
  assert.deepEqual(listed.cases.map((entry) => entry.name).sort(), ["folge.GewErfass2026", "primaer.Gew2025"]);
  const primary = listed.cases.find((entry) => entry.name === "primaer.Gew2025");
  assert.equal(primary.transmitted, true);
  const encryptedOffset = largeEncryptedFixture.length - (600 * 1024);
  assert.equal(primary.encryptedBytes, (512 * 1024) - encryptedOffset);
  assert.equal(primary.fileType, "Gew");
  assert.equal(primary.year, "2025");
  assert.equal(primary.meta, null);
  const following = listed.cases.find((entry) => entry.name === "folge.GewErfass2026");
  assert.equal(following.elsterTransferTime, "02.08.2026 11:22:33");
  const directoryWithSeparator = `${listDirectory}\\`;
  assert.equal(
    (await listCaseFiles(directoryWithSeparator, loadProductProfile("2025"))).dir,
    directoryWithSeparator,
    "Die lokale Fallliste muss denselben Verzeichnistext wie der Worker zurueckgeben.",
  );

  const hiddenPath = join(listDirectory, "verborgen.ESt2025");
  writeFileSync(hiddenPath, akadFixture("placeholder"));
  const attrib = join(process.env.SystemRoot ?? process.env.WINDIR ?? "C:\\Windows", "System32", "attrib.exe");
  const hiddenResult = spawnSync(attrib, ["+H", hiddenPath], { encoding: "utf8", windowsHide: true });
  assert.equal(hiddenResult.status, 0, hiddenResult.stderr);
  const localWithHidden = await listCaseFiles(listDirectory, loadProductProfile("2025"));
  const workerWithHidden = await callWorker("list_cases", { dir: listDirectory }, 30_000);
  assert(localWithHidden.cases.some((entry) => entry.name === "verborgen.ESt2025"));
  assert(workerWithHidden.cases.some((entry) => entry.name === "verborgen.ESt2025"));

  const withBackups = await listCaseFiles(listDirectory, loadProductProfile("2025"), { includeBackups: true });
  assert.equal(withBackups.count, 4);
  assert(withBackups.cases.some((entry) => entry.name === "sicherung.Gew2025_Backup"));

  const listAbort = new AbortController();
  listAbort.abort();
  await assert.rejects(
    listCaseFiles(listDirectory, loadProductProfile("2025"), { signal: listAbort.signal }),
    (error) => error?.kind === "aborted",
  );
  await assert.rejects(
    listCaseFiles(listDirectory, loadProductProfile("2025"), { timeoutMs: 0 }),
    (error) => error?.kind === "timeout",
  );

  const midListAbortDirectory = join(temporary, "list-abort");
  mkdirSync(midListAbortDirectory);
  for (let index = 0; index < 16; index += 1) {
    writeFileSync(join(midListAbortDirectory, `fall-${String(index).padStart(2, "0")}.ESt2025`), largeEncryptedFixture);
  }
  const midListAbort = new AbortController();
  const abortingList = listCaseFiles(midListAbortDirectory, loadProductProfile("2025"), { signal: midListAbort.signal });
  setTimeout(() => midListAbort.abort(), 1);
  await assert.rejects(abortingList, (error) => error?.kind === "aborted");

  const changingListDirectory = join(temporary, "list-changing");
  mkdirSync(changingListDirectory);
  const changingListPath = join(changingListDirectory, "wechselnd.ESt2025");
  writeFileSync(changingListPath, largeEncryptedFixture);
  let changingSize = largeEncryptedFixture.length;
  const changeTimer = setInterval(() => {
    changingSize += 1;
    truncateSync(changingListPath, changingSize);
  }, 0);
  try {
    await assert.rejects(
      listCaseFiles(changingListDirectory, loadProductProfile("2025")),
      (error) => error?.kind === "resource-changed",
    );
  } finally {
    clearInterval(changeTimer);
  }

  const noEncryptedDirectory = join(temporary, "list-without-encrypted-record");
  mkdirSync(noEncryptedDirectory);
  writeFileSync(join(noEncryptedDirectory, "ohne-blob.ESt2025"), akadFixture("placeholder", 0, false));
  const withoutEncryptedRecord = await listCaseFiles(noEncryptedDirectory, loadProductProfile("2025"));
  assert.equal(withoutEncryptedRecord.cases[0].encryptedBytes, 0);

  await assert.rejects(
    listCaseFiles(join(temporary, "fehlender-ordner"), loadProductProfile("2025")),
    (error) => error?.kind === "not-found",
  );
  writeFileSync(join(listDirectory, "defekt.ESt2025"), "kein AKAD");
  await assert.rejects(
    listCaseFiles(listDirectory, loadProductProfile("2025")),
    (error) => error instanceof CaseFileParserFallbackError,
  );
} finally {
  rmSync(temporary, { recursive: true, force: true });
}

process.stdout.write("Lokale Falldateien: AKAD-Kopf, Fallliste, ELSTER-Tri-State, Profilbindung und Hash bestanden.\n");
