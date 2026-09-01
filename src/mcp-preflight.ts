import { z } from "zod";

const PREFLIGHT_BLOCKER_CODES = [
  "WORKSPACE_NOT_READY",
  "CASE_DIRECTORY_NOT_READY",
  "PRODUCT_PROFILE_UNSUPPORTED",
  "PRODUCT_NOT_INSTALLED",
  "PRODUCT_INSTALLATION_INCOMPATIBLE",
  "PRODUCT_CATALOG_INCOMPATIBLE",
  "PRODUCT_BUILD_DRIFT",
  "PROFILE_IDENTITY_MISMATCH",
  "SSE_NOT_RUNNING",
  "SSE_BUILD_DRIFT",
  "SSE_DIALOG_OPEN",
  "SSE_UNHEALTHY",
] as const;

const PREFLIGHT_NOTICE_CODES = ["CASE_DIRECTORY_NOT_CONFIGURED"] as const;

const PREFLIGHT_NEXT_TOOLS = [
  "sse_workspace_status",
  "sse_product_info",
  "sse_health",
  "sse_dialog_list",
  "sse_list_cases",
  "sse_launch",
  "sse_instances",
] as const;

const PREFLIGHT_ISSUE_SCHEMA = z.object({
  code: z.enum(PREFLIGHT_BLOCKER_CODES),
  scope: z.enum(["setup", "runtime"]),
  message: z.string().min(1),
  nextTool: z.enum(PREFLIGHT_NEXT_TOOLS),
}).strict();

const PREFLIGHT_NOTICE_SCHEMA = z.object({
  code: z.enum(PREFLIGHT_NOTICE_CODES),
  message: z.string().min(1),
  nextTool: z.enum(PREFLIGHT_NEXT_TOOLS),
}).strict();

export const MCP_PREFLIGHT_OUTPUT_SCHEMA = z.object({
  ok: z.literal(true).describe("Alle drei read-only Preflight-Abfragen wurden erfolgreich ausgefuehrt"),
  ready: z.boolean().describe("Setup und laufende Anwendung sind fuer die weitere Orientierung bereit"),
  setupReady: z.boolean().describe("Arbeitsbereich, Produktprofil und installierte Anwendung sind kompatibel"),
  runtimeReady: z.boolean().describe("SteuerSparErklaerung laeuft gesund und ohne offenen Dialog"),
  workspace: z.object({
    ready: z.boolean(),
    profileId: z.string().nullable(),
    caseDirectoryConfigured: z.boolean(),
    caseDirectoryReady: z.boolean(),
    documentAreaReady: z.boolean(),
    resultAreaReady: z.boolean(),
    backupAreaReady: z.boolean(),
  }).strict(),
  product: z.object({
    profileId: z.string().nullable(),
    profileStatus: z.string().nullable(),
    operationAccess: z.string().nullable(),
    product: z.string().nullable(),
    taxYear: z.number().int().nonnegative().nullable(),
    supported: z.boolean(),
    installed: z.boolean(),
    installationCompatible: z.boolean(),
    catalogCompatible: z.boolean(),
    buildCompatible: z.boolean(),
    identityCompatible: z.boolean(),
  }).strict(),
  application: z.object({
    profileId: z.string().nullable(),
    taxYear: z.number().int().nonnegative().nullable(),
    running: z.boolean(),
    buildCompatible: z.boolean(),
    healthy: z.boolean(),
    dialogOpen: z.boolean(),
  }).strict(),
  blockers: z.array(PREFLIGHT_ISSUE_SCHEMA),
  notices: z.array(PREFLIGHT_NOTICE_SCHEMA),
  nextTool: z.enum(PREFLIGHT_NEXT_TOOLS),
}).strict();

export type McpPreflightResult = z.infer<typeof MCP_PREFLIGHT_OUTPUT_SCHEMA>;

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function nonNegativeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

/**
 * Verdichtet ausschliesslich bereits redigierbare API-Fakten. Keine Ausgabe
 * uebernimmt Pfade, Fenstertitel, PIDs oder sonstige PC-lokale Identitaeten.
 */
export function evaluateMcpPreflight(
  workspaceStatus: Record<string, unknown>,
  productInfo: Record<string, unknown>,
  health: Record<string, unknown>,
): McpPreflightResult {
  const defaultExecutable = objectValue(productInfo.defaultExecutable);
  const catalogCompatibility = objectValue(productInfo.catalogCompatibility);
  const productBuildDrift = objectValue(productInfo.buildDrift);
  const runtimeBuildDrift = objectValue(health.buildDrift);
  const workspaceReady = workspaceStatus.workspaceReady === true &&
    workspaceStatus.resultAreaReady === true &&
    workspaceStatus.documentAreaReady === true &&
    workspaceStatus.backupAreaReady === true;
  const caseDirectoryConfigured = workspaceStatus.caseDirectoryConfigured === true;
  const caseDirectoryReady = workspaceStatus.caseDirectoryReady === true;
  const profileSupported = productInfo.profileStatus === "supported" &&
    productInfo.operationAccess === "full";
  const productInstalled = defaultExecutable?.exists === true;
  const installationCompatible = productInstalled && defaultExecutable?.supported === true;
  const catalogCompatible = catalogCompatibility?.compatible === true;
  const buildCompatible = installationCompatible && productBuildDrift?.drifted === false;
  const workspaceProfileId = stringValue(workspaceStatus.profileId);
  const productProfileId = stringValue(productInfo.profileId);
  const applicationProfileId = stringValue(health.profileId);
  const productTaxYear = nonNegativeInteger(productInfo.taxYear);
  const applicationTaxYear = nonNegativeInteger(health.taxYear);
  const identityCompatible = workspaceProfileId !== null &&
    productProfileId !== null &&
    applicationProfileId !== null &&
    workspaceProfileId === productProfileId &&
    productProfileId === applicationProfileId &&
    productTaxYear !== null &&
    applicationTaxYear !== null &&
    productTaxYear === applicationTaxYear;
  const running = health.running === true;
  const runtimeBuildCompatible = running && runtimeBuildDrift?.drifted === false;
  const healthDialogs = Array.isArray(health.dialogs) ? health.dialogs : null;
  const dialogInventoryKnown = healthDialogs !== null;
  const dialogOpen = healthDialogs !== null && healthDialogs.length > 0;
  const runtimeSignalsHealthy = running &&
    dialogInventoryKnown &&
    health.canaryOk === true &&
    health.advice === "gesund" &&
    !dialogOpen;
  const healthy = runtimeSignalsHealthy && runtimeBuildCompatible;

  const blockers: McpPreflightResult["blockers"] = [];
  if (!workspaceReady) {
    blockers.push({
      code: "WORKSPACE_NOT_READY",
      scope: "setup",
      message: "Mindestens ein sicherer Arbeits-, Ergebnis-, Dokument- oder Backupbereich ist nicht bereit.",
      nextTool: "sse_workspace_status",
    });
  }
  if (caseDirectoryConfigured && !caseDirectoryReady) {
    blockers.push({
      code: "CASE_DIRECTORY_NOT_READY",
      scope: "setup",
      message: "Der konfigurierte Fallbereich ist nicht erreichbar.",
      nextTool: "sse_workspace_status",
    });
  }
  if (!profileSupported) {
    blockers.push({
      code: "PRODUCT_PROFILE_UNSUPPORTED",
      scope: "setup",
      message: "Das aktive Produktprofil ist nicht fuer den vollen Betrieb freigegeben.",
      nextTool: "sse_product_info",
    });
  }
  if (!productInstalled) {
    blockers.push({
      code: "PRODUCT_NOT_INSTALLED",
      scope: "setup",
      message: "Die zum Profil passende SteuerSparErklaerung-Installation wurde nicht verifiziert.",
      nextTool: "sse_product_info",
    });
  } else if (!installationCompatible) {
    blockers.push({
      code: "PRODUCT_INSTALLATION_INCOMPATIBLE",
      scope: "setup",
      message: "Die gefundene SteuerSparErklaerung-Installation passt nicht eindeutig zum aktiven Produktprofil.",
      nextTool: "sse_product_info",
    });
  }
  if (!catalogCompatible) {
    blockers.push({
      code: "PRODUCT_CATALOG_INCOMPATIBLE",
      scope: "setup",
      message: "Der lokale UI-Katalog passt nicht eindeutig zum aktiven Produktprofil.",
      nextTool: "sse_product_info",
    });
  }
  if (installationCompatible && !buildCompatible) {
    blockers.push({
      code: "PRODUCT_BUILD_DRIFT",
      scope: "setup",
      message: "Der installierte Produktbuild weicht von der verifizierten Releasegrenze ab.",
      nextTool: "sse_product_info",
    });
  }
  if (!identityCompatible) {
    blockers.push({
      code: "PROFILE_IDENTITY_MISMATCH",
      scope: "setup",
      message: "Arbeitsbereich, Produktpruefung und Laufzeit belegen nicht eindeutig dasselbe Profil und Steuerjahr.",
      nextTool: "sse_product_info",
    });
  }
  if (!running) {
    blockers.push({
      code: "SSE_NOT_RUNNING",
      scope: "runtime",
      message: "SteuerSparErklaerung laeuft noch nicht in einer kompatiblen Instanz.",
      nextTool: caseDirectoryConfigured && caseDirectoryReady ? "sse_list_cases" : "sse_launch",
    });
  } else {
    if (dialogOpen) {
      blockers.push({
        code: "SSE_DIALOG_OPEN",
        scope: "runtime",
        message: "Ein offener Dialog muss vor weiterer Facharbeit eindeutig gelesen werden.",
        nextTool: "sse_dialog_list",
      });
    }
    if (!runtimeBuildCompatible) {
      blockers.push({
        code: "SSE_BUILD_DRIFT",
        scope: "runtime",
        message: "Der tatsaechlich laufende Produktbuild ist nicht als releasekompatibel belegt.",
        nextTool: "sse_health",
      });
    }
    if (!dialogOpen && !runtimeSignalsHealthy) {
      blockers.push({
        code: "SSE_UNHEALTHY",
        scope: "runtime",
        message: "Die laufende Anwendung hat den billigen Gesundheitscheck nicht bestanden.",
        nextTool: "sse_health",
      });
    }
  }

  const notices: McpPreflightResult["notices"] = [];
  if (!caseDirectoryConfigured) {
    notices.push({
      code: "CASE_DIRECTORY_NOT_CONFIGURED",
      message: "Kein Fallbereich ist vorkonfiguriert; ein bereits eindeutig geoeffneter Fall bleibt trotzdem nutzbar.",
      nextTool: "sse_instances",
    });
  }

  const setupReady = !blockers.some((entry) => entry.scope === "setup");
  const runtimeReady = !blockers.some((entry) => entry.scope === "runtime");
  return MCP_PREFLIGHT_OUTPUT_SCHEMA.parse({
    ok: true,
    ready: setupReady && runtimeReady,
    setupReady,
    runtimeReady,
    workspace: {
      ready: workspaceReady,
      profileId: workspaceProfileId,
      caseDirectoryConfigured,
      caseDirectoryReady,
      documentAreaReady: workspaceStatus.documentAreaReady === true,
      resultAreaReady: workspaceStatus.resultAreaReady === true,
      backupAreaReady: workspaceStatus.backupAreaReady === true,
    },
    product: {
      profileId: productProfileId,
      profileStatus: stringValue(productInfo.profileStatus),
      operationAccess: stringValue(productInfo.operationAccess),
      product: stringValue(productInfo.product),
      taxYear: productTaxYear,
      supported: profileSupported,
      installed: productInstalled,
      installationCompatible,
      catalogCompatible,
      buildCompatible,
      identityCompatible,
    },
    application: {
      profileId: applicationProfileId,
      taxYear: applicationTaxYear,
      running,
      buildCompatible: runtimeBuildCompatible,
      healthy,
      dialogOpen,
    },
    blockers,
    notices,
    nextTool: blockers[0]?.nextTool ?? "sse_instances",
  });
}
