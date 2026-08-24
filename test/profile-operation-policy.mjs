import assert from "node:assert/strict";
import { SSE_API_OPERATIONS } from "../dist/api-contract.js";
import {
  createProfileOperationCapability,
  createProfileOperationMatrix,
  EXPERIMENTAL_PROFILE_BASE_OPERATIONS,
  EXPERIMENTAL_PROFILE_VERIFICATION_OPERATIONS,
  profileOperationClass,
} from "../dist/profile-operation-policy.js";
import { SSE_BUILD_DRIFT_BLOCKED_OPERATIONS } from "../dist/operation-traits.js";

const supported = createProfileOperationMatrix("supported", "full", false);
assert.deepEqual(Object.keys(supported), SSE_API_OPERATIONS);
assert.equal(Object.keys(supported).length, 93);
for (const operation of SSE_API_OPERATIONS) {
  assert.equal(supported[operation].operation, operation);
  assert.equal(supported[operation].availability, "allowed");
  assert.equal(supported[operation].requiresExperimentalOptIn, false);
  assert.equal(
    supported[operation].blockedOnBuildDrift,
    SSE_BUILD_DRIFT_BLOCKED_OPERATIONS.includes(operation),
    `${operation}: Build-Drift-Kennzeichnung weicht vom Vollzugskatalog ab`,
  );
}

const experimentalClosed = createProfileOperationMatrix("experimental", "verification-only", false);
const experimentalOpen = createProfileOperationMatrix("experimental", "verification-only", true);
for (const operation of EXPERIMENTAL_PROFILE_BASE_OPERATIONS) {
  assert.equal(experimentalClosed[operation].availability, "allowed", `${operation}: Basiskatalog`);
  assert.equal(experimentalClosed[operation].requiresExperimentalOptIn, false);
}
for (const operation of EXPERIMENTAL_PROFILE_VERIFICATION_OPERATIONS) {
  assert.equal(experimentalClosed[operation].availability, "blocked", `${operation}: ohne Opt-in`);
  assert.equal(experimentalOpen[operation].availability, "allowed", `${operation}: mit Opt-in`);
  assert.equal(experimentalOpen[operation].requiresExperimentalOptIn, true);
}
for (const operation of [
  "toggle", "tracked_set_value", "table_add", "table_update", "table_delete", "save", "save_as",
  "vast_apply", "export_csv",
]) {
  assert.equal(experimentalOpen[operation].availability, "blocked", `${operation}: kein Generalschluessel`);
}
assert.equal(experimentalClosed.dialog_answer.availability, "blocked");
assert.equal(experimentalOpen.dialog_answer.availability, "conditional");
assert.match(experimentalOpen.dialog_answer.reason, /passive.*OK/u);

const promotedWithoutCapabilities = createProfileOperationMatrix("supported", "verification-only", false);
assert.equal(promotedWithoutCapabilities.health.availability, "allowed");
assert.equal(promotedWithoutCapabilities.windows.availability, "blocked");
assert.equal(promotedWithoutCapabilities.table_update.availability, "blocked");

const disabled = createProfileOperationMatrix("disabled", "verification-only", true);
assert.equal(disabled.health.availability, "allowed");
assert.equal(disabled.workspace_file_read_text.availability, "allowed");
assert.equal(disabled.windows.availability, "blocked");
assert.equal(disabled.launch.availability, "blocked");

assert.equal(profileOperationClass("health"), "read");
assert.equal(profileOperationClass("close"), "cleanup");
assert.equal(profileOperationClass("goto"), "navigation");
assert.equal(profileOperationClass("tracked_set_value"), "focusless-write-conditional");
assert.equal(profileOperationClass("table_update"), "destructive");
assert.equal(
  createProfileOperationCapability("supported", "full", false, "tracked_set_value").blockedOnBuildDrift,
  true,
);
assert.equal(createProfileOperationCapability("supported", "full", false, "close").blockedOnBuildDrift, false);
for (const operation of ["checker_run", "goto", "set_value", "ustva_open_section", "vast_row_set_expanded"]) {
  assert.equal(
    createProfileOperationCapability("supported", "full", false, operation).blockedOnBuildDrift,
    true,
    `${operation}: UI-Aktivierung muss bei Build-Drift gesperrt sein`,
  );
}

process.stdout.write("Profil-Operationen: 93 Eintraege, Experimental-Opt-in und Build-Drift-Matrix bestanden\n");
