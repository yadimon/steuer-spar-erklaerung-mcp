import { isAbsolute, resolve } from "node:path";

export interface ApiMainArguments {
  help: boolean;
  configPath?: string;
  caseDir?: string;
}

export const API_MAIN_USAGE = [
  "Aufruf: steuer-spar-erklaerung-api [--config <config.json>] [--case-dir <Fallordner>]",
  "Ohne --config wird beim ersten Foreground-Start eine lokale Standardkonfiguration erzeugt.",
  "--case-dir bindet nur den laufenden Prozess an einen bestaetigten absoluten Fallordner.",
].join("\n");

export function parseApiMainArguments(argv: readonly string[]): ApiMainArguments {
  if (argv.length === 0) return { help: false };
  if (argv.length === 1 && ["--help", "-h"].includes(argv[0]!)) return { help: true };
  let configPath: string | undefined;
  let caseDir: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    const value = argv[index + 1];
    if (!["--config", "--case-dir"].includes(option ?? "") || !value || value.startsWith("--")) {
      throw new Error(`Ungueltige API-Startargumente. ${API_MAIN_USAGE}`);
    }
    if (option === "--config") {
      if (configPath) throw new Error(`--config darf nur einmal angegeben werden. ${API_MAIN_USAGE}`);
      configPath = value;
    } else {
      if (caseDir) throw new Error(`--case-dir darf nur einmal angegeben werden. ${API_MAIN_USAGE}`);
      if (!isAbsolute(value) || /[\u0000-\u001f]/u.test(value)) {
        throw new Error(`--case-dir muss ein absoluter Pfad ohne Steuerzeichen sein. ${API_MAIN_USAGE}`);
      }
      caseDir = resolve(value);
    }
    index += 1;
  }
  return {
    help: false,
    ...(configPath ? { configPath } : {}),
    ...(caseDir ? { caseDir } : {}),
  };
}
