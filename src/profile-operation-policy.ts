import { SSE_API_OPERATIONS, type SseApiOperation } from "./api-contract.js";
import {
  SSE_BUILD_DRIFT_BLOCKED_OPERATIONS,
  SSE_CLEANUP_OPERATIONS,
  SSE_DESTRUCTIVE_OPERATIONS,
  SSE_READ_ONLY_OPERATIONS,
} from "./operation-traits.js";
import type { ProductProfile } from "./product-profiles.js";

export const EXPERIMENTAL_PROFILE_BASE_OPERATIONS = [
  "capabilities", "health", "help", "product_info", "workspace_status",
  "list_cases", "case_hash", "workspace_file_list", "workspace_file_read_text",
] as const satisfies readonly SseApiOperation[];

export const EXPERIMENTAL_PROFILE_VERIFICATION_OPERATIONS = [
  "accessibility_probe",
  "check",
  "checker_close",
  "checker_detail",
  "checker_open",
  "checker_reset",
  "checker_results",
  "checker_run",
  "click_point",
  "close",
  "combo_options",
  "dialog_list",
  "find",
  "get_value",
  "goto",
  "known_page_state",
  "launch",
  "make_working_copy",
  "page",
  "page_objects",
  "positions",
  "read_full",
  "read_page",
  "read_table",
  "result_details",
  "scroll",
  "scroll_page",
  "snapshot",
  "snapshot_compare",
  "subpages",
  "table_read",
  "tree_scroll",
  "tree_top",
  "ui_state",
  "ustva_read",
  "warning_popup_read",
  "window_close",
  "window_restore",
  "windows",
] as const satisfies readonly SseApiOperation[];

const BASE = new Set<SseApiOperation>(EXPERIMENTAL_PROFILE_BASE_OPERATIONS);
const VERIFICATION = new Set<SseApiOperation>(EXPERIMENTAL_PROFILE_VERIFICATION_OPERATIONS);
const READ_ONLY = new Set<SseApiOperation>(SSE_READ_ONLY_OPERATIONS);
const CLEANUP = new Set<SseApiOperation>(SSE_CLEANUP_OPERATIONS);
const DESTRUCTIVE = new Set<SseApiOperation>(SSE_DESTRUCTIVE_OPERATIONS);
const BUILD_DRIFT_BLOCKED = new Set<SseApiOperation>(SSE_BUILD_DRIFT_BLOCKED_OPERATIONS);
const NAVIGATION = new Set<SseApiOperation>([
  "click", "click_point", "find", "goto", "scroll", "scroll_page", "set_value",
  "subpages", "tree_scroll", "tree_top", "ustva_open_section", "window_restore",
]);

export type ProfileOperationClass =
  | "read"
  | "navigation"
  | "focusless-write-conditional"
  | "mutation"
  | "destructive"
  | "cleanup";

export type ProfileOperationAvailability = "allowed" | "blocked" | "conditional";

export interface ProfileOperationCapability {
  operation: SseApiOperation;
  class: ProfileOperationClass;
  availability: ProfileOperationAvailability;
  requiresExperimentalOptIn: boolean;
  blockedOnBuildDrift: boolean;
  reason: string;
}

export function profileOperationClass(operation: SseApiOperation): ProfileOperationClass {
  if (READ_ONLY.has(operation)) return "read";
  if (CLEANUP.has(operation)) return "cleanup";
  if (operation === "tracked_set_value") return "focusless-write-conditional";
  if (NAVIGATION.has(operation)) return "navigation";
  if (DESTRUCTIVE.has(operation)) return "destructive";
  return "mutation";
}

export function createProfileOperationCapability(
  profileStatus: ProductProfile["status"],
  operationAccess: ProductProfile["operationAccess"],
  operateExperimental: boolean,
  operation: SseApiOperation,
): ProfileOperationCapability {
  const common = {
    operation,
    class: profileOperationClass(operation),
    blockedOnBuildDrift: BUILD_DRIFT_BLOCKED.has(operation),
  };
  if (BASE.has(operation)) {
    return {
      ...common,
      availability: "allowed",
      requiresExperimentalOptIn: false,
      reason: "Profilunabhängige Katalog-, Diagnose- oder sichere Dateiauskunft.",
    };
  }
  if (profileStatus === "disabled") {
    return {
      ...common,
      availability: "blocked",
      requiresExperimentalOptIn: false,
      reason: "Das Produktprofil ist deaktiviert; Betriebsoperationen sind gesperrt.",
    };
  }
  if (profileStatus === "supported" && operationAccess === "full") {
    return {
      ...common,
      availability: "allowed",
      requiresExperimentalOptIn: false,
      reason: "Vom vollständigen Profilvertrag freigegeben; operationsspezifische Guards gelten zusätzlich.",
    };
  }
  if (operation === "dialog_answer") {
    return {
      ...common,
      availability: operateExperimental ? "conditional" : "blocked",
      requiresExperimentalOptIn: true,
      reason: operateExperimental
        ? "Nur der exakt gebundene passive OK-Startdialog ist erlaubt."
        : "Dialogantworten erfordern den Experimental-Opt-in und bleiben danach eng bedingt.",
    };
  }
  if (VERIFICATION.has(operation)) {
    return {
      ...common,
      availability: operateExperimental ? "allowed" : "blocked",
      requiresExperimentalOptIn: true,
      reason: operateExperimental
        ? "Expliziter Lese-/Navigations-/Wegwerfkopie-Verifikationskatalog."
        : "Nur mit bewusstem Experimental-Opt-in zur Jahresverifikation verfügbar.",
    };
  }
  return {
    ...common,
    availability: "blocked",
    requiresExperimentalOptIn: true,
    reason: "Für das experimentelle Profil nicht live verifiziert.",
  };
}

export function createProfileOperationMatrix(
  profileStatus: ProductProfile["status"],
  operationAccess: ProductProfile["operationAccess"],
  operateExperimental: boolean,
): Readonly<Record<SseApiOperation, ProfileOperationCapability>> {
  return Object.freeze(Object.fromEntries(
    SSE_API_OPERATIONS.map((operation) => [
      operation,
      Object.freeze(createProfileOperationCapability(profileStatus, operationAccess, operateExperimental, operation)),
    ]),
  ) as Record<SseApiOperation, ProfileOperationCapability>);
}
