import assert from "node:assert/strict";
import { directWorker } from "./direct-worker-helpers.mjs";

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

process.stdout.write("Direkter Worker: Experimental-Gate mit und ohne bewusste Ueberschreibung bestanden\n");
