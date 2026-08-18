import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  EXPERIMENTAL_PROFILE_BASE_OPERATIONS,
  EXPERIMENTAL_PROFILE_VERIFICATION_OPERATIONS,
} from "../dist/api-executor.js";
import { SSE_BUILD_DRIFT_BLOCKED_OPERATIONS } from "../dist/operation-traits.js";
import { directWorker, worker } from "./direct-worker-helpers.mjs";

const workerSource = readFileSync(worker, "utf8");
function parsePowerShellCatalog(variable) {
  const escaped = variable.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = workerSource.match(new RegExp(`\\$${escaped}\\s*=\\s*@\\(([\\s\\S]*?)\\r?\\n\\)`, "u"));
  assert(match, `PowerShell-Katalog $${variable} fehlt`);
  return [...match[1].matchAll(/'([^']+)'/gu)].map((entry) => entry[1]);
}

const sorted = (values) => [...values].sort();
assert.deepEqual(
  sorted(parsePowerShellCatalog("experimentalProfileBaseOps")),
  sorted(EXPERIMENTAL_PROFILE_BASE_OPERATIONS),
  "TS- und PowerShell-Basiskatalog muessen identisch sein",
);
assert.deepEqual(
  sorted(parsePowerShellCatalog("experimentalProfileVerificationOps")),
  sorted(EXPERIMENTAL_PROFILE_VERIFICATION_OPERATIONS),
  "TS- und PowerShell-Verifikationskatalog muessen identisch sein",
);
assert.deepEqual(
  sorted(parsePowerShellCatalog("buildDriftBlockedOps")),
  sorted(SSE_BUILD_DRIFT_BLOCKED_OPERATIONS),
  "TS- und PowerShell-Build-Drift-Katalog muessen identisch sein",
);
const buildGateCall = workerSource.lastIndexOf("Assert-SSEVerifiedBuildForOperation $Op");
const operationSwitch = workerSource.indexOf("switch ($Op) {");
assert(buildGateCall > 0 && buildGateCall < operationSwitch,
  "Build-Drift-Gate muss vor jeder Operationsausfuehrung liegen");
const disabledGateCall = workerSource.indexOf("status -eq 'disabled'");
const verificationGateCall = workerSource.indexOf("if ($verificationOnlyProfile");
assert(disabledGateCall > 0 && disabledGateCall < verificationGateCall,
  "Deaktivierte Profile muessen vor dem Experimental-Opt-in fail-closed stoppen");

const blockedWindows = directWorker(
  "windows", {}, { SSE_PROFILE_ID: "2024", SSE_OPERATE_EXPERIMENTAL: "" },
);
assert.equal(blockedWindows.ok, false, "Betriebsoperation muss ohne operateExperimental scheitern");
assert.equal(blockedWindows.kind, "profile-unverified");

const allowedProductInfo = directWorker(
  "product_info", {}, { SSE_PROFILE_ID: "2024", SSE_OPERATE_EXPERIMENTAL: "" },
);
assert.equal(allowedProductInfo.ok, true, "Erlaubte Katalogoperation muss auch ohne operateExperimental erreichbar sein");

// health hat in src/api-executor.ts keinen eigenen TS-Zweig und faellt wie
// help/product_info/list_cases/case_hash auf den echten Worker durch; muss
// deshalb ebenfalls in der worker-seitigen Erlaubnisliste stehen.
const allowedHealth = directWorker(
  "health", {}, { SSE_PROFILE_ID: "2024", SSE_OPERATE_EXPERIMENTAL: "" },
);
assert.equal(allowedHealth.ok, true, "Erlaubte Statusabfrage muss auch ohne operateExperimental erreichbar sein");

const overriddenWindows = directWorker(
  "windows", {}, { SSE_PROFILE_ID: "2024", SSE_OPERATE_EXPERIMENTAL: "1" },
);
assert.notEqual(overriddenWindows.kind, "profile-unverified",
  "Mit SSE_OPERATE_EXPERIMENTAL muss die Experimental-Gate passiert werden");
assert.notEqual(overriddenWindows.kind, "profile-operation-unverified",
  "windows steht im expliziten Verifikationskatalog");

const overriddenRead = directWorker(
  "read_page", {}, { SSE_PROFILE_ID: "2024", SSE_OPERATE_EXPERIMENTAL: "1" },
);
assert.notEqual(overriddenRead.kind, "profile-unverified",
  "Lesewege muessen die Experimental-Gate mit Opt-in passieren");
assert.notEqual(overriddenRead.kind, "profile-operation-unverified",
  "read_page steht im expliziten Verifikationskatalog");

const internalCheckerNavigation = directWorker(
  "click",
  {
    name: "Weiter",
    type: "Button",
    expectedPageBefore: "Prüfen und Abgeben",
    expectedPageAfter: "Steuererklärung prüfen",
    experimentalCheckerNavigation: true,
  },
  { SSE_PROFILE_ID: "2024", SSE_OPERATE_EXPERIMENTAL: "1" },
);
assert.notEqual(internalCheckerNavigation.kind, "profile-operation-unverified",
  "Der eng gebundene interne checker_open-Navigationsschritt muss die Worker-Gate passieren");

const checkerNavigationWithoutSourcePage = directWorker(
  "click",
  {
    name: "Weiter",
    type: "Button",
    expectedPageAfter: "Steuererklärung prüfen",
    experimentalCheckerNavigation: true,
  },
  { SSE_PROFILE_ID: "2024", SSE_OPERATE_EXPERIMENTAL: "1" },
);
assert.equal(checkerNavigationWithoutSourcePage.kind, "profile-operation-unverified",
  "Interne Checker-Navigation ohne gebundene Ausgangsseite muss vor dem Klick scheitern");

const checkerNavigationWithWrongSourcePage = directWorker(
  "click",
  {
    name: "Weiter",
    type: "Button",
    expectedPageBefore: "Andere Seite",
    expectedPageAfter: "Steuererklärung prüfen",
    experimentalCheckerNavigation: true,
  },
  { SSE_PROFILE_ID: "2024", SSE_OPERATE_EXPERIMENTAL: "1" },
);
assert.equal(checkerNavigationWithWrongSourcePage.kind, "profile-operation-unverified",
  "Interne Checker-Navigation mit falscher Ausgangsseite muss vor dem Klick scheitern");

for (const button of ["Speichern", "Ja", "Nein", "Klicken Sie hier, um Ihre Daten zu exportieren"]) {
  const answer = directWorker(
    "dialog_answer", { hwnd: 1, fingerprint: "A".repeat(64), button },
    { SSE_PROFILE_ID: "2024", SSE_OPERATE_EXPERIMENTAL: "1" },
  );
  assert.equal(answer.kind, "profile-operation-unverified",
    `Experimentelle Dialogantwort '${button}' muss bereits an der Worker-Gate scheitern`);
}
const passiveDialogCandidate = directWorker(
  "dialog_answer", { hwnd: 1, fingerprint: "A".repeat(64), button: "OK" },
  { SSE_PROFILE_ID: "2024", SSE_OPERATE_EXPERIMENTAL: "1" },
);
assert.notEqual(passiveDialogCandidate.kind, "profile-operation-unverified",
  "Ein passiver Dialogkandidat muss bis zur titel-/textgebundenen Worker-Pruefung gelangen");

for (const operation of ["click", "table_update", "tracked_set_value", "vast_apply"]) {
  const result = directWorker(
    operation, {}, { SSE_PROFILE_ID: "2024", SSE_OPERATE_EXPERIMENTAL: "1" },
  );
  assert.equal(result.ok, false, `${operation} muss trotz Opt-in scheitern`);
  assert.equal(result.kind, "profile-operation-unverified", `${operation}: falsche Fehlerart`);
  assert.match(result.error, /nicht im expliziten Verifikationskatalog/u);
}

process.stdout.write("Direkter Worker: Experimental-Opt-in bleibt auf den paritaetischen Verifikationskatalog begrenzt\n");
