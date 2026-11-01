import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beginBelegManagerConfigIsolation } from "./performance/belegmanager-config-isolation.mjs";

const temporary = mkdtempSync(join(tmpdir(), "sse-belegmanager-config-isolation-"));
try {
  const evidenceRoot = join(temporary, "evidence");
  const localAppData = join(temporary, "local-app-data");
  const configDirectory = join(localAppData, "Steuertipps", "SSE", "31");
  const iniPath = join(configDirectory, ["SSEKonf", "user.ini"].join("."));
  const isolatedDataDir = join(temporary, "isolated-belegmanager");
  mkdirSync(configDirectory, { recursive: true });
  const original = Buffer.from(
    "[Allgemein]\r\nWert=1\r\n[BelegManager]\r\nDataDir=C:\\private\\original\r\nBreite=42\r\n" +
    "[MainWindowPos]\r\nH=1260\r\nMinMax=0\r\nW=1800\r\nX=50\r\nY=30\r\n" +
    "[ShortHelpWindow]\r\nH=330\r\nW=440\r\n" +
    "[Files]\r\nLastWorkDir=C:\\private\\work\r\n" +
    "[License]\r\nLastCheck=2026-08-28\r\n" +
    "[WerteInfoPos]\r\nCount=4\r\nH=400\r\nMinMax=-2\r\nSize1=288\r\nSize2=100\r\n" +
    "Size3=100\r\nSize4=200\r\nW=600\r\nX=10\r\nY=20\r\n",
    "utf8",
  );
  writeFileSync(iniPath, original);
  const options = { evidenceRoot, localAppData, engineMajor: 31, isolatedDataDir };
  const first = beginBelegManagerConfigIsolation(options);
  assert.match(readFileSync(iniPath, "utf8"), /DataDir=.*isolated-belegmanager/u);
  assert.equal(existsSync(join(evidenceRoot, ".api-mega-belegmanager-config-original.bin")), true);
  assert.equal(existsSync(join(evidenceRoot, ".api-mega-belegmanager-config-swapped.bin")), true);
  assert.equal(existsSync(join(evidenceRoot, ".api-mega-belegmanager-config-recovery.json")), true);
  writeFileSync(iniPath, readFileSync(iniPath, "utf8").replace(
    "LastWorkDir=C:\\private\\work",
    "LastWorkDir=C:\\synthetic\\runtime",
  ).replace("[MainWindowPos]\r\nH=1260\r\nMinMax=0\r\nW=1800\r\nX=50\r\nY=30",
    "[MainWindowPos]\r\nH=1036\r\nMinMax=-1\r\nW=1600\r\nX=0\r\nY=10")
    .replace("[ShortHelpWindow]\r\nH=330\r\nW=440", "[ShortHelpWindow]\r\nH=550\r\nW=660")
    .replace("Count=4", "Count=5")
    .replace("H=400", "H=768")
    .replace("MinMax=-2", "MinMax=0")
    .replace("Size1=288", "Size1=320")
    .replace("Size2=100", "Size2=144")
    .replace("Size3=100", "Size3=348")
    .replace("Size4=200", "Size4=93")
    .replace("W=600", "W=1024")
    .replace("X=10", "X=120")
    .replace("Y=20", "Y=80"));
  writeFileSync(iniPath, readFileSync(iniPath, "utf8").replace(
    "LastCheck=2026-08-28",
    "LastCheck=2026-08-29",
  ).replace(
    "[BelegManager]\r\nDataDir=",
    "[BelegManager]\r\nColumnNameWidth=300\r\nDataDir=",
  ));
  first.restore();
  assert.deepEqual(readFileSync(iniPath), original);
  assert.equal(existsSync(join(evidenceRoot, ".api-mega-belegmanager-config-original.bin")), false);
  assert.equal(existsSync(join(evidenceRoot, ".api-mega-belegmanager-config-swapped.bin")), false);
  assert.equal(existsSync(join(evidenceRoot, ".api-mega-belegmanager-config-recovery.json")), false);

  rmSync(isolatedDataDir, { recursive: true, force: true });
  const stale = beginBelegManagerConfigIsolation(options);
  void stale;
  rmSync(isolatedDataDir, { recursive: true, force: true });
  mkdirSync(isolatedDataDir, { recursive: true });
  const recovered = beginBelegManagerConfigIsolation(options);
  assert.equal(recovered.recoveredStaleIsolation, true);
  recovered.restore();
  assert.deepEqual(readFileSync(iniPath), original);

  // Frische Installation: [Files] existiert noch gar nicht. Legt SSE den
  // Abschnitt samt LastWorkDir waehrend des Laufs NEU an, ist das erlaubte
  // Laufzeitdrift und die Restauration muss byteidentisch gelingen.
  const freshOriginal = Buffer.from(
    "[Allgemein]\r\nWert=1\r\n[BelegManager]\r\nDataDir=C:\\private\\original\r\nBreite=42\r\n" +
    "[WerteInfoPos]\r\nSize3=100\r\nSize4=200\r\n",
    "utf8",
  );
  writeFileSync(iniPath, freshOriginal);
  rmSync(isolatedDataDir, { recursive: true, force: true });
  const freshRun = beginBelegManagerConfigIsolation(options);
  writeFileSync(iniPath, readFileSync(iniPath, "utf8") +
    "[Files]\r\nLastWorkDir=C:\\synthetic\\sandbox\r\n");
  freshRun.restore();
  assert.deepEqual(readFileSync(iniPath), freshOriginal);

  const freshHelp = beginBelegManagerConfigIsolation(options);
  writeFileSync(iniPath, readFileSync(iniPath, "utf8") +
    "[ShortHelpWindow]\r\nH=550\r\nW=660\r\n");
  freshHelp.restore();
  assert.deepEqual(readFileSync(iniPath), freshOriginal);

  const insertedHelp = beginBelegManagerConfigIsolation(options);
  writeFileSync(iniPath, readFileSync(iniPath, "utf8").replace(
    "[WerteInfoPos]", "[ShortHelpWindow]\r\nH=550\r\nW=660\r\n[WerteInfoPos]",
  ));
  insertedHelp.restore();
  assert.deepEqual(readFileSync(iniPath), freshOriginal);

  // Unrelated legacy INI bytes must survive isolation and allowed runtime drift.
  // Only the ASCII section/key and the UTF-8 directory value belong to this edit.
  const legacyOriginal = Buffer.from(
    "[Darstellung]\r\nNotiz=Pr\xfcfung \x80\r\n" +
    "[BelegManager]\r\nDataDir=C:\\synthetic\\original\r\nBreite=42\r\n" +
    "[MainWindowPos]\r\nH=600\r\n",
    "latin1",
  );
  assert.throws(() => new TextDecoder("utf-8", { fatal: true }).decode(legacyOriginal));
  writeFileSync(iniPath, legacyOriginal);
  rmSync(isolatedDataDir, { recursive: true, force: true });
  const legacyRun = beginBelegManagerConfigIsolation(options);
  const legacySwapped = readFileSync(iniPath);
  const expectedLegacySwapped = Buffer.from(legacyOriginal.toString("latin1").replace(
    "DataDir=C:\\synthetic\\original",
    "DataDir=" + Buffer.from(isolatedDataDir, "utf8").toString("latin1"),
  ), "latin1");
  assert.deepEqual(legacySwapped, expectedLegacySwapped);
  writeFileSync(iniPath, Buffer.from(legacySwapped.toString("latin1").replace("H=600", "H=800"), "latin1"));
  legacyRun.restore();
  assert.deepEqual(readFileSync(iniPath), legacyOriginal);
  assert.equal(existsSync(join(evidenceRoot, ".api-mega-belegmanager-config-recovery.json")), false);

  // UTF-8 paths and unrelated UTF-8 values retain their existing byte contract.
  const unicodeDataDir = join(temporary, "isolated-\u00e4-\u03a9");
  const unicodeOriginal = Buffer.from(
    "[Darstellung]\r\nNotiz=Gr\u00fc\u00dfe \u03a9\r\n" +
    "[BelegManager]\r\nDataDir=C:\\synthetic\\original\r\n",
    "utf8",
  );
  writeFileSync(iniPath, unicodeOriginal);
  const unicodeRun = beginBelegManagerConfigIsolation({ ...options, isolatedDataDir: unicodeDataDir });
  assert.equal(readFileSync(iniPath, "utf8"), unicodeOriginal.toString("utf8").replace(
    "DataDir=C:\\synthetic\\original", "DataDir=" + unicodeDataDir,
  ));
  unicodeRun.restore();
  assert.deepEqual(readFileSync(iniPath), unicodeOriginal);

  // An opaque byte change outside the permitted runtime keys is still rejected.
  writeFileSync(iniPath, legacyOriginal);
  rmSync(isolatedDataDir, { recursive: true, force: true });
  const legacyGuarded = beginBelegManagerConfigIsolation(options);
  const legacyUnrelatedChange = Buffer.from(readFileSync(iniPath).toString("latin1").replace(
    "Notiz=Pr\xfcfung \x80", "Notiz=Pr\xfcfung \x81",
  ), "latin1");
  writeFileSync(iniPath, legacyUnrelatedChange);
  assert.throws(() => legacyGuarded.restore(), /driftete ausserhalb der bekannten Laufzeitwerte/u);
  assert.deepEqual(readFileSync(iniPath), legacyUnrelatedChange);
  assert.equal(existsSync(join(evidenceRoot, ".api-mega-belegmanager-config-original.bin")), true);
  writeFileSync(iniPath, legacySwapped);
  legacyGuarded.restore();
  assert.deepEqual(readFileSync(iniPath), legacyOriginal);

  // Non-ASCII bytes are opaque foreign changes even when Unicode trim calls them blank.
  writeFileSync(iniPath, freshOriginal);
  const opaqueGuarded = beginBelegManagerConfigIsolation(options);
  const opaqueSwapped = readFileSync(iniPath);
  const opaqueChange = Buffer.concat([opaqueSwapped,
    Buffer.from("[ShortHelpWindow]\r\nH=550\r\nW=660\r\n\xa0\r\n", "latin1")]);
  writeFileSync(iniPath, opaqueChange);
  assert.throws(() => opaqueGuarded.restore(), /driftete ausserhalb der bekannten Laufzeitwerte/u);
  assert.deepEqual(readFileSync(iniPath), opaqueChange);
  writeFileSync(iniPath, opaqueSwapped);
  opaqueGuarded.restore();
  assert.deepEqual(readFileSync(iniPath), freshOriginal);

  const duplicateOriginal = Buffer.from(
    "[BelegManager]\r\nDataDir=C:\\synthetic\\one\r\n" +
    "[BelegManager]\r\nDataDir=C:\\synthetic\\two\r\n", "utf8");
  writeFileSync(iniPath, duplicateOriginal);
  assert.throws(() => beginBelegManagerConfigIsolation(options), /Abschnitt.*mehrfach/u);
  assert.deepEqual(readFileSync(iniPath), duplicateOriginal);
  assert.equal(existsSync(join(evidenceRoot, ".api-mega-belegmanager-config-recovery.json")), false);

  const duplicateRuntimeOriginal = Buffer.concat([freshOriginal, Buffer.from(
    "[MainWindowPos]\r\nH=600\r\n[MainWindowPos]\r\nH=800\r\n", "utf8")]);
  writeFileSync(iniPath, duplicateRuntimeOriginal);
  assert.throws(() => beginBelegManagerConfigIsolation(options), /Abschnitt.*mehrfach/u);
  assert.deepEqual(readFileSync(iniPath), duplicateRuntimeOriginal);
  assert.equal(existsSync(join(evidenceRoot, ".api-mega-belegmanager-config-recovery.json")), false);

  const indentedOriginal = Buffer.from(
    "  [BelegManager]\r\nDataDir=C:\\synthetic\\original\r\n" +
    "\t[MainWindowPos] \t\r\nH=600\r\n[Other]\r\nValue=unchanged\r\n", "utf8");
  writeFileSync(iniPath, indentedOriginal);
  const indentedRun = beginBelegManagerConfigIsolation(options);
  writeFileSync(iniPath, readFileSync(iniPath, "utf8").replace("H=600", "H=800"));
  indentedRun.restore();
  assert.deepEqual(readFileSync(iniPath), indentedOriginal);

  // A later section's same-named keys must never become authority for this one.
  const boundaryOriginal = Buffer.from(
    "  [BelegManager]\r\nDataDir=C:\\synthetic\\original\r\n" +
    "  [Archiv]\r\nDataDir=C:\\synthetic\\foreign\r\n" +
    "\t[MainWindowPos] \t\r\nH=600\r\n  [Other]\r\nX=1\r\n", "utf8");
  writeFileSync(iniPath, boundaryOriginal);
  const boundaryRun = beginBelegManagerConfigIsolation(options);
  const boundarySwapped = readFileSync(iniPath);
  assert.deepEqual(boundarySwapped, Buffer.from(boundaryOriginal.toString("utf8").replace(
    "DataDir=C:\\synthetic\\original", "DataDir=" + isolatedDataDir,
  ), "utf8"));
  const boundaryChange = Buffer.from(boundarySwapped.toString("utf8").replace("X=1", "X=2").replace("H=600", "H=800"));
  writeFileSync(iniPath, boundaryChange);
  assert.throws(() => boundaryRun.restore(), /driftete ausserhalb der bekannten Laufzeitwerte/u);
  assert.deepEqual(readFileSync(iniPath), boundaryChange);
  assert.equal(existsSync(join(evidenceRoot, ".api-mega-belegmanager-config-original.bin")), true);
  writeFileSync(iniPath, boundarySwapped);
  boundaryRun.restore();
  assert.deepEqual(readFileSync(iniPath), boundaryOriginal);

  // Darstellungsoptionen ausserhalb der Erlaubnisliste bleiben fail-closed:
  // nichts wird ueberschrieben, die Artefakte bleiben liegen.
  writeFileSync(iniPath, freshOriginal);
  rmSync(isolatedDataDir, { recursive: true, force: true });
  const guarded = beginBelegManagerConfigIsolation(options);
  writeFileSync(iniPath, readFileSync(iniPath, "utf8") +
    "[ShortHelpWindow]\r\nH=330\r\nW=440\r\nUnrelatedSetting=synthetic-sensitive-value\r\n");
  assert.throws(() => guarded.restore(), (error) => {
    assert.match(error.message, /driftete ausserhalb der bekannten Laufzeitwerte/u);
    assert.equal(Buffer.isBuffer(error.actual), false, "Recovery errors must not expose configuration bytes.");
    assert.equal(Buffer.isBuffer(error.expected), false, "Recovery errors must not expose the original configuration.");
    assert.equal(error.message.includes("synthetic-sensitive-value"), false);
    return true;
  });
  assert.equal(existsSync(join(evidenceRoot, ".api-mega-belegmanager-config-original.bin")), true);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}

process.stdout.write("BelegManager-Konfigurationsisolation: create-only Recovery, stale Restore und Byte-Paritaet bestanden\n");
