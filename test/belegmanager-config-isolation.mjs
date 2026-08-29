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
    "[Files]\r\nLastWorkDir=C:\\private\\work\r\n" +
    "[License]\r\nLastCheck=2026-08-28\r\n" +
    "[WerteInfoPos]\r\nSize3=100\r\nSize4=200\r\n",
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
  ).replace("Size3=100", "Size3=348").replace("Size4=200", "Size4=93"));
  writeFileSync(iniPath, readFileSync(iniPath, "utf8").replace(
    "LastCheck=2026-08-28",
    "LastCheck=2026-08-29",
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

  // Ein NEUER Abschnitt ausserhalb der Erlaubnisliste bleibt dagegen
  // fail-closed: nichts wird ueberschrieben, die Artefakte bleiben liegen.
  rmSync(isolatedDataDir, { recursive: true, force: true });
  const guarded = beginBelegManagerConfigIsolation(options);
  writeFileSync(iniPath, readFileSync(iniPath, "utf8") +
    "[Fremd]\r\nWert=1\r\n");
  assert.throws(() => guarded.restore(), /driftete ausserhalb der bekannten Laufzeitwerte/u);
  assert.equal(existsSync(join(evidenceRoot, ".api-mega-belegmanager-config-original.bin")), true);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}

process.stdout.write("BelegManager-Konfigurationsisolation: create-only Recovery, stale Restore und Byte-Paritaet bestanden\n");
