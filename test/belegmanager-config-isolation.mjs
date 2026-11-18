import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beginBelegManagerConfigIsolation } from "./performance/belegmanager-config-isolation.mjs";
import { commitIniBytes } from "./performance/ini-byte-transaction.mjs";
import { resolveWindowsPowerShell } from "../dist/windows-runtime.js";

const sha256 = bytes => createHash("sha256").update(bytes).digest("hex").toUpperCase();
function assertOwnedRestore(result, full) {
  assert.equal(result.ownChangeRestored, true);
  assert.equal(result.fullConfigRestored, full);
  assert.equal(result.driftPreserved, !full);
  assert.equal(result.restoreMode, full ? "full" : "owned-field-only");
}

const temporary = mkdtempSync(join(tmpdir(), "sse-belegmanager-config-isolation-"));
try {
  const evidenceRoot = join(temporary, "evidence");
  const localAppData = join(temporary, "local-app-data");
  const configDirectory = join(localAppData, "Steuertipps", "SSE", "31");
  const iniPath = join(configDirectory, ["SSEKonf", "user.ini"].join("."));
  const lockPath = join(configDirectory, ".api-mega-belegmanager-config.lock");
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
  assertOwnedRestore(first.restore(), true);
  assert.deepEqual(readFileSync(iniPath), original);
  assert.equal(existsSync(join(evidenceRoot, ".api-mega-belegmanager-config-original.bin")), false);
  assert.equal(existsSync(join(evidenceRoot, ".api-mega-belegmanager-config-swapped.bin")), false);
  assert.equal(existsSync(join(evidenceRoot, ".api-mega-belegmanager-config-recovery.json")), false);

  rmSync(isolatedDataDir, { recursive: true, force: true });
  const stale = beginBelegManagerConfigIsolation(options);
  void stale;
  const activeBytes = readFileSync(iniPath);
  assert.throws(() => beginBelegManagerConfigIsolation({ ...options, evidenceRoot: join(temporary, "competing") }), /reserviert/u);
  assert.deepEqual(readFileSync(iniPath), activeBytes);
  // A legacy journal had no reservation/preimages. Emulate only that format.
  unlinkSync(lockPath);
  for (const name of readdirSync(evidenceRoot).filter(name => name.startsWith(".api-mega-belegmanager-config-preimage-"))) {
    unlinkSync(join(evidenceRoot, name));
  }
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

  // Marker replacement cannot redirect the captured handle to another run.
  const boundMarkerRun = beginBelegManagerConfigIsolation(options);
  const markerPath = join(evidenceRoot, ".api-mega-belegmanager-config-recovery.json");
  const markerBytes = readFileSync(markerPath);
  const changedMarker = JSON.parse(markerBytes);
  changedMarker.swappedHash = "F".repeat(64);
  writeFileSync(markerPath, JSON.stringify(changedMarker));
  const markerBoundConfig = readFileSync(iniPath);
  assert.throws(() => boundMarkerRun.restore(), /gehoert nicht/u);
  assert.deepEqual(readFileSync(iniPath), markerBoundConfig);
  writeFileSync(markerPath, markerBytes);
  assertOwnedRestore(boundMarkerRun.restore(), true);

  // Lost acknowledgement after a real commit triggers real immediate rollback.
  let setupCommitCalls = 0;
  assert.throws(() => beginBelegManagerConfigIsolation({ ...options, commitBytes(request) {
    setupCommitCalls++;
    const committed = commitIniBytes(request);
    assert.equal(committed.writePerformed, true);
    assert.notEqual(setupCommitCalls, 1, "Synthetic lost setup acknowledgement.");
    return committed;
  } }), /Synthetic lost setup acknowledgement/u);
  assert.equal(setupCommitCalls, 2);
  assert.deepEqual(readFileSync(iniPath), freshOriginal);
  assert.equal(existsSync(lockPath), false);

  let failedSetupCalls = 0;
  assert.throws(() => beginBelegManagerConfigIsolation({ ...options,
    commitBytes(request) {
      failedSetupCalls++;
      const committed = commitIniBytes(request);
      assert.notEqual(failedSetupCalls, 1, "Synthetic setup acknowledgement failure.");
      return committed;
    },
    removeReservation() { throw new Error("Synthetic release failure."); },
  }), /zurueckgenommen, Reservierungs-Bereinigung fehlgeschlagen/u);
  assert.equal(failedSetupCalls, 2);
  assert.deepEqual(readFileSync(iniPath), freshOriginal);
  assert.equal(existsSync(lockPath), true);
  assert.equal(existsSync(markerPath), false);
  unlinkSync(lockPath);

  // A failed restore acknowledgement keeps its private preimage, then retries
  // through a different create-only name rather than being permanently blocked.
  let restoreCommitCalls = 0;
  const retryRun = beginBelegManagerConfigIsolation({ ...options, commitBytes(request) {
    restoreCommitCalls++;
    const committed = commitIniBytes(request);
    assert.notEqual(restoreCommitCalls, 2, "Synthetic lost restore acknowledgement.");
    return committed;
  } });
  assert.throws(() => retryRun.restore(), /Synthetic lost restore acknowledgement/u);
  assert.deepEqual(readFileSync(iniPath), freshOriginal);
  assertOwnedRestore(retryRun.restore(), true);
  assert.equal(restoreCommitCalls, 3);
  assert.equal(existsSync(lockPath), false);
  assert.equal(readdirSync(evidenceRoot).length, 0);

  // A reservation cleanup failure never misreports a verified config rollback.
  const cleanupRun = beginBelegManagerConfigIsolation({ ...options, removeReservation() {
    assert.deepEqual(readFileSync(iniPath), freshOriginal);
    throw new Error("Synthetic reservation cleanup failure.");
  } });
  const cleanupResult = cleanupRun.restore();
  assertOwnedRestore(cleanupResult, true);
  assert.equal(cleanupResult.cleanupComplete, false);
  assert.deepEqual(cleanupResult.cleanupErrors, ["reservation-cleanup-failed"]);
  assert.equal(existsSync(lockPath), true);
  assert.equal(existsSync(markerPath), false);
  unlinkSync(lockPath);

  // Corrupt recovery hashes are rejected without leaking either fingerprint.
  const hashGuardRun = beginBelegManagerConfigIsolation(options);
  const originalPath = join(evidenceRoot, ".api-mega-belegmanager-config-original.bin");
  const originalCopy = readFileSync(originalPath);
  writeFileSync(originalPath, Buffer.concat([originalCopy, Buffer.from("corrupt")]));
  const corruptHash = sha256(readFileSync(originalPath));
  const correctHash = sha256(originalCopy);
  assert.throws(() => hashGuardRun.restore(), error => {
    assert.equal(error.message.includes(corruptHash), false);
    assert.equal(error.message.includes(correctHash), false);
    assert.match(error.message, /unerwarteten Hash/u);
    return true;
  });
  writeFileSync(originalPath, originalCopy);
  assertOwnedRestore(hashGuardRun.restore(), true);

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

  // Unknown bytes survive; only our DataDir value is rolled back.
  writeFileSync(iniPath, legacyOriginal);
  rmSync(isolatedDataDir, { recursive: true, force: true });
  const legacyGuarded = beginBelegManagerConfigIsolation(options);
  const legacyUnrelatedChange = Buffer.from(readFileSync(iniPath).toString("latin1").replace(
    "Notiz=Pr\xfcfung \x80", "Notiz=Pr\xfcfung \x81",
  ), "latin1");
  writeFileSync(iniPath, legacyUnrelatedChange);
  assertOwnedRestore(legacyGuarded.restore(), false);
  assert.deepEqual(readFileSync(iniPath), Buffer.from(legacyOriginal.toString("latin1").replace(
    "Notiz=Pr\xfcfung \x80", "Notiz=Pr\xfcfung \x81"), "latin1"));
  assert.equal(existsSync(join(evidenceRoot, ".api-mega-belegmanager-config-original.bin")), false);

  // Non-ASCII bytes remain opaque, including whitespace-like values.
  writeFileSync(iniPath, freshOriginal);
  const opaqueGuarded = beginBelegManagerConfigIsolation(options);
  const opaqueSwapped = readFileSync(iniPath);
  const opaqueChange = Buffer.concat([opaqueSwapped,
    Buffer.from("[ShortHelpWindow]\r\nH=550\r\nW=660\r\n\xa0\r\n", "latin1")]);
  writeFileSync(iniPath, opaqueChange);
  assertOwnedRestore(opaqueGuarded.restore(), false);
  assert.deepEqual(readFileSync(iniPath), Buffer.concat([freshOriginal,
    Buffer.from("[ShortHelpWindow]\r\nH=550\r\nW=660\r\n\xa0\r\n", "latin1")]));

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
  assertOwnedRestore(boundaryRun.restore(), false);
  assert.deepEqual(readFileSync(iniPath), Buffer.from(boundaryOriginal.toString("utf8")
    .replace("X=1", "X=2").replace("H=600", "H=800")));
  assert.equal(existsSync(join(evidenceRoot, ".api-mega-belegmanager-config-original.bin")), false);

  // Unknown preferences are retained, never exposed through the result.
  writeFileSync(iniPath, freshOriginal);
  rmSync(isolatedDataDir, { recursive: true, force: true });
  const guarded = beginBelegManagerConfigIsolation(options);
  writeFileSync(iniPath, readFileSync(iniPath, "utf8") +
    "[ShortHelpWindow]\r\nH=330\r\nW=440\r\nUnrelatedSetting=synthetic-sensitive-value\r\n");
  const guardedResult = guarded.restore();
  assertOwnedRestore(guardedResult, false);
  assert.equal(JSON.stringify(guardedResult).includes("synthetic-sensitive-value"), false);
  assert.deepEqual(readFileSync(iniPath), Buffer.concat([freshOriginal, Buffer.from(
    "[ShortHelpWindow]\r\nH=330\r\nW=440\r\nUnrelatedSetting=synthetic-sensitive-value\r\n")]));

  // A different owner, missing key, or duplicate key must prevent any write.
  for (const change of [
    text => text.replace(/DataDir=[^\r\n]*/u, "DataDir=C:\\synthetic\\foreign"),
    text => text.replace(/DataDir=[^\r\n]*\r\n/u, ""),
    text => text.replace("[BelegManager]\r\n", "[BelegManager]\r\nDataDir=C:\\synthetic\\duplicate\r\n"),
    text => text + "[BelegManager]\r\nDataDir=C:\\synthetic\\duplicate\r\n",
  ]) {
    writeFileSync(iniPath, freshOriginal);
    const run = beginBelegManagerConfigIsolation(options);
    const swapped = readFileSync(iniPath);
    const foreign = Buffer.from(change(swapped.toString("utf8")));
    writeFileSync(iniPath, foreign);
    assert.throws(() => run.restore());
    assert.deepEqual(readFileSync(iniPath), foreign);
    assert.equal(existsSync(join(evidenceRoot, ".api-mega-belegmanager-config-original.bin")), true);
    writeFileSync(iniPath, swapped);
    assertOwnedRestore(run.restore(), true);
  }

  // A completed external rollback is recognized without erasing foreign drift.
  writeFileSync(iniPath, freshOriginal);
  const alreadyRestored = beginBelegManagerConfigIsolation(options);
  const foreignRestored = Buffer.concat([freshOriginal, Buffer.from("[Other]\nValue=preserve\n")]);
  writeFileSync(iniPath, foreignRestored);
  const noopRestore = alreadyRestored.restore();
  assertOwnedRestore(noopRestore, false);
  assert.equal(noopRestore.writePerformed, false);
  assert.deepEqual(readFileSync(iniPath), foreignRestored);

  // BOM, legacy bytes, LF, trailing spaces, and no final newline stay byte exact.
  const opaqueOriginal = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(
    "[Other]\nValue=\xfc\n[BelegManager]\n  DataDir \t= C:\\synthetic\\original  \nOther=unchanged", "latin1")]);
  writeFileSync(iniPath, opaqueOriginal);
  const opaqueFormat = beginBelegManagerConfigIsolation(options);
  writeFileSync(iniPath, Buffer.concat([readFileSync(iniPath), Buffer.from("\nForeign=\x80", "latin1")]));
  assertOwnedRestore(opaqueFormat.restore(), false);
  assert.deepEqual(readFileSync(iniPath), Buffer.concat([opaqueOriginal, Buffer.from("\nForeign=\x80", "latin1")]));

  // CAS checks and create-only private preimages precede any target write.
  writeFileSync(iniPath, freshOriginal);
  const replacement = Buffer.from("[Synthetic]\r\nValue=replacement\r\n");
  const transactionPreimage = join(temporary, "preimage-\u00e4-\u03a9.bin");
  assert.throws(() => commitIniBytes({ path: iniPath, expectedHash: "0".repeat(64),
    bytes: replacement, recoveryPath: transactionPreimage }), /cas-mismatch/u);
  assert.deepEqual(readFileSync(iniPath), freshOriginal);
  assert.equal(existsSync(transactionPreimage), false);
  const committed = commitIniBytes({ path: iniPath, expectedHash: sha256(freshOriginal),
    bytes: replacement, recoveryPath: transactionPreimage });
  assert.equal(committed.writePerformed, true);
  assert.deepEqual(readFileSync(transactionPreimage), freshOriginal);
  assert.deepEqual(readFileSync(iniPath), replacement);
  const aclCheck = spawnSync(resolveWindowsPowerShell(), ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command",
    "$ErrorActionPreference='Stop'; $acl=[IO.File]::GetAccessControl($env:SSE_SYNTHETIC_PREIMAGE); $rules=$acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]); $allowed=@([Security.Principal.WindowsIdentity]::GetCurrent().User.Value,'S-1-5-18')|Select-Object -Unique; [Console]::Write(([pscustomobject]@{protected=$acl.AreAccessRulesProtected;inherited=@($rules | Where-Object IsInherited).Count;unexpected=@($rules|Where-Object {$_.IdentityReference.Value -notin $allowed -or $_.AccessControlType -ne 'Allow' -or $_.FileSystemRights -ne 'FullControl'}).Count;rules=@($rules).Count;expected=@($allowed).Count}|ConvertTo-Json -Compress))"],
  { encoding: "utf8", windowsHide: true, env: { ...process.env, SSE_SYNTHETIC_PREIMAGE: transactionPreimage } });
  assert.equal(aclCheck.status, 0);
  const privateAcl = JSON.parse(aclCheck.stdout);
  assert.equal(privateAcl.protected, true);
  assert.equal(privateAcl.inherited, 0);
  assert.equal(privateAcl.unexpected, 0);
  assert.equal(privateAcl.rules, privateAcl.expected);
  assert.throws(() => commitIniBytes({ path: iniPath, expectedHash: sha256(replacement),
    bytes: freshOriginal, recoveryPath: transactionPreimage }), /invalid-or-unavailable/u);
  assert.deepEqual(readFileSync(iniPath), replacement);
  assert.deepEqual(readFileSync(transactionPreimage), freshOriginal);

  // Real competing handle, signalled after acquisition; no timing-based skip.
  writeFileSync(iniPath, freshOriginal);
  const lockedRun = beginBelegManagerConfigIsolation(options);
  const lockedBytes = readFileSync(iniPath);
  const holder = spawn(resolveWindowsPowerShell(), ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command",
    "$file=[IO.File]::Open($env:SSE_SYNTHETIC_INI,[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None); try { [Console]::WriteLine('locked'); [Console]::In.ReadLine() | Out-Null } finally { $file.Dispose() }"],
  { windowsHide: true, env: { ...process.env, SSE_SYNTHETIC_INI: iniPath } });
  const holderExit = once(holder, "exit");
  try {
    const ready = await Promise.race([once(holder.stdout, "data").then(([bytes]) => bytes.toString("utf8")),
      holderExit.then(() => { throw new Error("Synthetic lock holder exited before handshake."); }),
      new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error("Synthetic lock handshake timed out.")), 10_000); timer.unref(); }),
    ]);
    assert.equal(ready.trim(), "locked");
    assert.throws(() => lockedRun.restore(), error => {
      assert.match(error.message, /gesperrt|locked-or-unavailable/u);
      assert.equal(error.message.includes(iniPath), false);
      return true;
    });
    assert.equal(existsSync(join(evidenceRoot, ".api-mega-belegmanager-config-original.bin")), true);
  } finally {
    holder.stdin.end("release\n");
    const [code] = await holderExit;
    assert.equal(code, 0);
  }
  assert.deepEqual(readFileSync(iniPath), lockedBytes);
  assertOwnedRestore(lockedRun.restore(), true);
  assert.deepEqual(readFileSync(iniPath), freshOriginal);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}

process.stdout.write("BelegManager-Konfigurationsisolation: exklusiver CAS, eigene Ruecknahme, Drift-Erhalt und Byte-Paritaet bestanden\n");
