import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApiExecutor } from "../dist/api-executor.js";
import { listProductProfileIds, loadProductProfile } from "../dist/product-profiles.js";
import { directWorker } from "./direct-worker-helpers.mjs";
import { traceOperations } from "./operation-trace.mjs";

const withoutTiming = ({ ms: _ms, ...result }) => result;
const temporary = mkdtempSync(join(tmpdir(), "sse-page-objects-parity-"));

try {
  for (const profileId of listProductProfileIds()) {
    const profile = loadProductProfile(profileId);
    const pageId = Object.keys(profile.pageObjectsCatalog.pages)[0];
    assert(pageId, `Profil ${profileId} braucht mindestens ein Page-Object.`);

    const workerEnvironment = {
      SSE_PROFILE_ID: profileId,
      ...(profile.status === "supported" ? {} : { SSE_OPERATE_EXPERIMENTAL: "1" }),
    };
    let fallbackCalls = 0;
    const execute = traceOperations("profile-catalog", createApiExecutor(
      {
        host: "127.0.0.1",
        port: 43127,
        token: "page-objects-parity-token-24-characters",
        configPath: join(temporary, profileId, "config.json"),
        profileId,
        operateExperimental: profile.status !== "supported",
        caseDir: join(temporary, profileId, "cases"),
        workspaceDir: join(temporary, profileId, "workspace"),
        resultDir: join(temporary, profileId, "results"),
      },
      async (operation, args) => {
        fallbackCalls += 1;
        return directWorker(operation, args, workerEnvironment);
      },
    ));

    for (const args of [{}, { pageId }, { pageId: pageId.toUpperCase() }, { pageId: "nicht.vorhanden" }]) {
      const expected = directWorker("page_objects", args, workerEnvironment);
      const callsBefore = fallbackCalls;
      const actual = await execute("page_objects", args, 30_000);
      assert.equal(
        fallbackCalls,
        callsBefore,
        `${profileId}: page_objects ${JSON.stringify(args)} darf fuer einen gueltigen Profilkatalog keinen Worker starten.`,
      );
      assert.deepEqual(
        actual,
        withoutTiming(expected),
        `${profileId}: lokaler Page-Object-Vertrag driftet fuer ${JSON.stringify(args)}.`,
      );
    }

    const aborted = new AbortController();
    aborted.abort();
    const callsBeforeAbort = fallbackCalls;
    const abortedResult = await execute("page_objects", {}, 30_000, aborted.signal);
    assert.equal(abortedResult.ok, false);
    assert.equal(abortedResult.kind, "aborted");
    assert.equal(fallbackCalls, callsBeforeAbort, `${profileId}: Vorab-Abbruch darf keinen Worker starten.`);

    const callsBeforeTimeout = fallbackCalls;
    const timedOutResult = await execute("page_objects", {}, 0);
    assert.equal(timedOutResult.ok, false);
    assert.equal(timedOutResult.kind, "timeout");
    assert.equal(fallbackCalls, callsBeforeTimeout, `${profileId}: lokaler Timeout darf keinen Worker starten.`);
  }

  const mutableProfilesRoot = join(temporary, "mutable-profiles");
  cpSync(join(process.cwd(), "profiles"), mutableProfilesRoot, { recursive: true });
  const mutableCatalogPath = join(mutableProfilesRoot, "2025", "page-objects.json");
  const mutableConfigRoot = join(temporary, "mutable-runtime");
  let fallbackCalls = 0;
  let fallbackTimeoutMs;
  const mutableExecute = createApiExecutor(
    {
      host: "127.0.0.1",
      port: 43127,
      token: "mutable-profile-token-24-characters",
      configPath: join(mutableConfigRoot, "config.json"),
      profileId: "2025",
      caseDir: join(mutableConfigRoot, "cases"),
      workspaceDir: join(mutableConfigRoot, "workspace"),
      resultDir: join(mutableConfigRoot, "results"),
    },
    async (_operation, _args, workerTimeoutMs) => {
      fallbackCalls += 1;
      fallbackTimeoutMs = workerTimeoutMs;
      return { ok: true, fallback: "worker" };
    },
    { profilesRoot: mutableProfilesRoot },
  );

  const mutableCatalog = JSON.parse(readFileSync(mutableCatalogPath, "utf8"));
  const firstPage = Object.values(mutableCatalog.pages)[0];
  mutableCatalog.pages["test.neu_geladen"] = { ...firstPage, heading: "Neu geladen" };
  writeFileSync(mutableCatalogPath, `${JSON.stringify(mutableCatalog, null, 2)}\n`, "utf8");
  const reloaded = await mutableExecute("page_objects", { pageId: "test.neu_geladen" }, 30_000);
  assert.equal(reloaded.ok, true);
  assert.equal(reloaded.page.heading, "Neu geladen", "page_objects muss Profilkataloge pro Aufruf neu laden.");
  assert.equal(fallbackCalls, 0, "Ein gueltig nachgeladener Katalog darf keinen Worker starten.");

  mutableCatalog.pages = {};
  writeFileSync(mutableCatalogPath, `${JSON.stringify(mutableCatalog, null, 2)}\n`, "utf8");
  const fallback = await mutableExecute("page_objects", {}, 30_000);
  assert.deepEqual(fallback, { ok: true, fallback: "worker" });
  assert.equal(fallbackCalls, 1, "Lokaler Profildrift muss den kompatiblen Workerpfad erreichen.");
  assert(fallbackTimeoutMs > 0 && fallbackTimeoutMs <= 30_000, "Der Fallback braucht nur das Restbudget.");

  const callsBeforeShortFallback = fallbackCalls;
  const shortFallback = await mutableExecute("page_objects", {}, 0);
  assert.equal(shortFallback.ok, false);
  assert.equal(shortFallback.kind, "timeout");
  assert.equal(fallbackCalls, callsBeforeShortFallback, "Aufgebrauchtes Budget darf keinen Fallback-Worker starten.");

  process.stdout.write("Page-Objects: lokale API und echter Worker sind fuer alle Profile feldgleich.\n");
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
