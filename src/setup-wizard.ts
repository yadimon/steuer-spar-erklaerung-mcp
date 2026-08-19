import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { fileURLToPath } from "node:url";
import { DEFAULT_API_PORT } from "./api-contract.js";
import {
  defaultApiConfigPath,
  environmentForExplicitApiConfig,
  loadApiServerConfig,
} from "./api-config.js";
import {
  isProductProfileReleased,
  listProductProfileIds,
  loadProductProfile,
} from "./product-profiles.js";
import {
  assertWindowsPowerShell,
  detectSseExecutables,
  setupArtifactTargetPaths,
  validateSseExecutable,
  writeSetupArtifacts,
  type SetupValues,
} from "./setup.js";
import {
  loadStoredSetupPreferences,
  type SetupConnectorPreference,
  type SetupMode,
  type SetupTransport,
} from "./setup-preferences.js";
import { parseSetupArguments, SETUP_USAGE } from "./setup-main-arguments.js";
import { loadConfirmedSetupPlan } from "./setup-plan.js";
import { startAndVerifySetupApi, type SetupApiVerification } from "./setup-runtime.js";
import { configurationFingerprint } from "./workspace-status.js";

export async function runSetupMain(args: readonly string[]): Promise<void> {
  const options = parseSetupArguments(args);
  if (options.help) {
    stdout.write(`${SETUP_USAGE}\n`);
    return;
  }
  const here = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(here, "..");
  const defaultsPath = defaultApiConfigPath();
  const confirmedPlan = options.planFile ? loadConfirmedSetupPlan(options.planFile) : undefined;
  const prompt = createInterface({ input: stdin, output: stdout });
  const ask = async (label: string, defaultValue = ""): Promise<string> => {
    const suffix = defaultValue ? ` [${defaultValue}]` : "";
    const answer = (await prompt.question(`${label}${suffix}: `)).trim();
    return answer || defaultValue;
  };
  const askYes = async (label: string, defaultYes: boolean): Promise<boolean> => {
    const fallback = defaultYes ? "ja" : "nein";
    return /^(j|ja|y|yes)$/iu.test(await ask(`${label} (ja/nein)`, fallback));
  };
  const splitList = (value: string): string[] => value.split(";").map((entry) => entry.trim()).filter(Boolean);

  try {
    stdout.write(`${SETUP_USAGE.split("\n")[0]}\n\n`);
    assertWindowsPowerShell();
    const supportedProfiles = listProductProfileIds().filter((id) => {
      try { return isProductProfileReleased(loadProductProfile(id)); } catch { return false; }
    });
    if (!supportedProfiles.length) throw new Error("Kein produktiv freigegebenes SSE-Profil ist enthalten.");
    const useSafeDefaults = Boolean(confirmedPlan) || options.defaults || await askYes(
      "Alles mit sicheren Standardwerten einrichten? Wenn Sie unsicher sind, antworten Sie Ja",
      true,
    );
    let existingCandidate;
    if (existsSync(defaultsPath)) {
      try {
        existingCandidate = loadApiServerConfig(environmentForExplicitApiConfig(defaultsPath));
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(`Vorhandene API-Konfiguration ist ungueltig und wurde nicht veraendert: ${detail}`);
      }
    }
    const reuseExisting = existingCandidate
      ? (useSafeDefaults || await askYes("Vorhandene Konfiguration und vorhandenes Token wiederverwenden?", true))
      : false;
    const existingConfiguration = reuseExisting ? existingCandidate : undefined;
    const defaultProfile = supportedProfiles.includes("2025") ? "2025" : supportedProfiles[0]!;
    const profileId = existingConfiguration?.profileId ?? confirmedPlan?.profileId ?? (useSafeDefaults ? defaultProfile : await ask(
      `Steuerjahr/Produktprofil (${supportedProfiles.join(", ")})`,
      defaultProfile,
    ));
    if (!supportedProfiles.includes(profileId)) throw new Error(`Produktprofil '${profileId}' ist nicht freigegeben.`);
    const profile = loadProductProfile(profileId);
    const detected = detectSseExecutables(profileId);
    if (useSafeDefaults && !existingConfiguration?.sseExecutable && detected.length !== 1) {
      throw new Error(
        detected.length
          ? "Mehrere SSE-Installationen gefunden. Interaktives Setup ohne --defaults starten und eine auswaehlen."
          : "SSE.exe wurde nicht eindeutig erkannt. Interaktives Setup ohne --defaults starten und den Pfad angeben.",
      );
    }
    const sseExecutable = validateSseExecutable(
      existingConfiguration?.sseExecutable ?? confirmedPlan?.sseExecutable ?? (useSafeDefaults
        ? detected[0]!
        : await ask(
          `Pfad zu ${profile.executable.name} (${profile.executable.installationFolderName})`,
          detected.length === 1 ? detected[0] : "",
        )),
      profileId,
    );
    const caseDirInput = existingConfiguration?.caseDir ?? confirmedPlan?.caseDir ?? (useSafeDefaults
      ? ""
      : await ask("Optionaler Fallordner (leer lassen erlaubt)"));
    const configPath = existingConfiguration?.configPath ?? resolve(
      useSafeDefaults ? defaultsPath : await ask("Lokale API-Konfiguration", defaultsPath),
    );
    const workspaceDir = existingConfiguration?.workspaceDir ?? resolve(
      useSafeDefaults
        ? join(dirname(configPath), "workspace")
        : await ask("Privater Arbeitsbereich", join(dirname(configPath), "workspace")),
    );
    const documentsDir = existingConfiguration?.documentsDir ?? resolve(useSafeDefaults
      ? join(workspaceDir, "documents")
      : await ask("Private Sammelablage fuer Dokumentkopien", join(workspaceDir, "documents")));
    const resultDir = existingConfiguration?.resultDir ?? resolve(useSafeDefaults
      ? join(workspaceDir, "results")
      : await ask("Ergebnisordner", join(workspaceDir, "results")));
    const backupsDir = existingConfiguration?.backupsDir ?? resolve(useSafeDefaults
      ? join(workspaceDir, "backups")
      : await ask("Sicherungsordner", join(workspaceDir, "backups")));
    const storedPreferences = existingConfiguration
      ? loadStoredSetupPreferences(workspaceDir)
      : undefined;
    const mode = confirmedPlan ? "read-only-check" : storedPreferences?.mode ?? (useSafeDefaults
      ? "read-only-check"
      : await ask("Ziel: setup-only, read-only-check oder controlled-edit", "read-only-check") as SetupMode);
    const sourceFolders = confirmedPlan?.sourceFolders ?? storedPreferences?.sourceFolders ?? (useSafeDefaults
      ? []
      : splitList(await ask("Optionale lokale Quellordner, durch Semikolon getrennt (leer erlaubt)"))
        .map((path) => resolve(path)));
    const connectorNames = storedPreferences || useSafeDefaults
      ? []
      : splitList(await ask("Optionale bereits verbundene Connectoren, durch Semikolon getrennt (leer erlaubt)"));
    const connectors: SetupConnectorPreference[] = storedPreferences?.connectors
      ? [...storedPreferences.connectors]
      : [];
    for (const name of connectorNames) {
      const approved = await askYes(
        `Darf der Connector '${name}' fuer die Belegsuche gelesen werden? Wenn Sie unsicher sind, antworten Sie Nein`,
        false,
      );
      connectors.push({ name, access: approved ? "approved" : "not-approved" });
    }
    const documentCollection = confirmedPlan ? "reference-only" : storedPreferences?.documentCollection ?? ((useSafeDefaults || await askYes(
      "Duerfen bestaetigte Dateien spaeter als Kopien unter documents gesammelt werden? Wenn Sie unsicher sind, antworten Sie Ja",
      true,
    )) ? "copy-after-confirmation" : "reference-only");
    const transport = options.withMcp ? "api-and-mcp" : confirmedPlan ? "api" : storedPreferences?.transport ?? (useSafeDefaults
      ? "api"
      : await ask("Direkte API oder API plus MCP?", "api") as SetupTransport);
    const trackingFormat = confirmedPlan ? "markdown" : storedPreferences?.tracking?.format ?? (
      useSafeDefaults ? "markdown" : await ask("Tracking als markdown oder vorhandenes xlsx? Die lokale API bearbeitet xlsx nicht.", "markdown")
    );
    const trackingPath = storedPreferences?.tracking?.path ?? (trackingFormat === "xlsx"
      ? resolve(await ask("Pfad zur vorhandenen privaten Excel-Trackingdatei"))
      : join(workspaceDir, "tracking.md"));
    const additionalPriorities = storedPreferences?.priorities ?? (useSafeDefaults
      ? []
      : splitList(await ask("Optionale weitere Prioritaeten, durch Semikolon getrennt (leer erlaubt)")));
    const initialReadOnlyCheck = confirmedPlan ? true : storedPreferences?.initialReadOnlyCheck ?? (useSafeDefaults || await askYes(
      "Nach erfolgreichem Setup eine erste Read-only-Pruefung vorbereiten? Wenn Sie unsicher sind, antworten Sie Ja",
      true,
    ));
    const port = existingConfiguration?.port ?? Number(
      useSafeDefaults ? DEFAULT_API_PORT : await ask("Lokaler API-Port", String(DEFAULT_API_PORT)),
    );
    if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("Port muss zwischen 1 und 65535 liegen.");
    const token = existingConfiguration?.token ?? randomBytes(32).toString("base64url");
    const values: SetupValues = {
      repoRoot,
      profileId,
      configPath,
      sseExecutable,
      ...(caseDirInput ? { caseDir: resolve(caseDirInput) } : {}),
      documentsDir,
      workspaceDir,
      resultDir,
      backupsDir,
      port,
      token,
      preferences: {
        useSafeDefaults: storedPreferences?.useSafeDefaults ?? useSafeDefaults,
        mode,
        transport,
        documentCollection,
        sourceFolders,
        connectors,
        tracking: { format: trackingFormat === "xlsx" ? "xlsx" : "markdown", path: trackingPath },
        initialReadOnlyCheck,
        ...(additionalPriorities.length ? { priorities: additionalPriorities } : {}),
      },
    };
    if (confirmedPlan && existingConfiguration) {
      const samePath = (left: string | undefined, right: string): boolean =>
        Boolean(left) && resolve(left!).toLocaleLowerCase("de-DE") === resolve(right).toLocaleLowerCase("de-DE");
      const storedSources = storedPreferences?.sourceFolders ?? [];
      const sameSources = storedPreferences &&
        storedSources.length === confirmedPlan.sourceFolders.length &&
        storedSources.every((path, index) => samePath(path, confirmedPlan.sourceFolders[index]!));
      const explicitMcpUpgrade = options.withMcp && storedPreferences?.transport === "api";
      if (
        existingConfiguration.profileId !== confirmedPlan.profileId ||
        !samePath(existingConfiguration.caseDir, confirmedPlan.caseDir) ||
        (confirmedPlan.sseExecutable !== undefined &&
          !samePath(existingConfiguration.sseExecutable, confirmedPlan.sseExecutable)) ||
        (storedPreferences && (!sameSources || storedPreferences.mode !== "read-only-check" ||
          (!explicitMcpUpgrade && storedPreferences.transport !== transport) ||
          storedPreferences.documentCollection !== "reference-only" ||
          storedPreferences.initialReadOnlyCheck !== true || storedPreferences.tracking?.format !== "markdown" ||
          (storedPreferences.connectors?.length ?? 0) !== 0))
      ) {
        throw new Error(
          "Bestaetigter Setup-Plan weicht von der vorhandenen Konfiguration ab. " +
          "Bestehende API nicht automatisch umkonfigurieren; zuerst bewusst sichern oder interaktiv neu einrichten.",
        );
      }
    }
    const existingTargets = setupArtifactTargetPaths(values).filter(existsSync);
    const overwrite = existingTargets.length && (options.defaults || Boolean(confirmedPlan))
      ? true
      : existingTargets.length
      ? /^(j|ja|y|yes)$/i.test(await ask(
          `${existingTargets.length} vorhandene Setup-Datei(en) nach redigiertem Backup ersetzen? (ja/nein)`,
          "nein",
        ))
      : false;
    const written = writeSetupArtifacts(values, overwrite, {
      preserveExistingSettings: Boolean(existingConfiguration),
    });
    stdout.write(`\nAPI-Konfiguration: ${written.apiConfigPath}\n`);
    if (written.mcpConfigPath) stdout.write(`MCP-Mergevorlage: ${written.mcpConfigPath}\n`);
    stdout.write(`Fensterloser API-Starter: ${written.apiLauncherPath}\n`);
    stdout.write(`Setup-Entscheidungen: ${written.setupDecisionsPath}\n`);
    stdout.write(`Persoenliche Einstellungen: ${written.settingsPath}\n`);
    stdout.write(`Privates Tracking: ${written.trackingPath}${written.trackingCreated ? " (neu angelegt)" : " (beibehalten)"}\n`);
    if (written.backups.length) stdout.write(`Backups: ${written.backups.join(", ")}\n`);
    stdout.write("Token wurde nur in den lokalen Konfigurationsdateien gespeichert.\n");
    let apiVerification: SetupApiVerification | undefined;
    const startApiNow = options.startApi && (
      options.defaults || Boolean(confirmedPlan) || await askYes("Lokale API jetzt fensterlos starten und pruefen?", true)
    );
    if (startApiNow) {
      const writtenConfig = loadApiServerConfig(environmentForExplicitApiConfig(written.apiConfigPath));
      apiVerification = await startAndVerifySetupApi(
        {
          host: writtenConfig.host,
          port: writtenConfig.port,
          token: writtenConfig.token,
          expectedConfigurationFingerprint: configurationFingerprint(writtenConfig),
        },
        written.apiLauncherPath,
      );
      stdout.write(
        `API verifiziert: ${apiVerification.baseUrl}, ${apiVerification.operationCount} Operationen, ` +
        `Workspace bereit${apiVerification.startedBySetup ? ", neu gestartet" : ", bereits aktiv"}.\n`,
      );
    } else {
      stdout.write(`API noch nicht gestartet. Fensterloser Starter: ${written.apiLauncherPath}\n`);
    }
    if (transport === "api-and-mcp") {
      if (!written.mcpConfigPath) throw new Error("MCP-Transport wurde ohne Mergevorlage erzeugt.");
      stdout.write(`MCP bleibt optional. Mergevorlage erst nach gezeigtem Konfigurations-Diff verwenden: ${written.mcpConfigPath}\n`);
    }
    if (initialReadOnlyCheck) {
      stdout.write(
        "Naechster Schritt: Einstellungen und Tracking zuruecklesen und eine erste Read-only-Pruefung anbieten. " +
        "Ohne Fallordner oder ausdrueckliche UI-Freigabe keine Steuerdaten aendern.\n",
      );
    }
    stdout.write("Nach Token- oder Pfadaenderungen eine laufende API bzw. die geplante Aufgabe neu starten.\n");
  } finally {
    prompt.close();
  }
}
