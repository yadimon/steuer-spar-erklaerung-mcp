export interface ApiMainArguments {
  help: boolean;
  configPath?: string;
}

export const API_MAIN_USAGE =
  "Aufruf: steuer-spar-erklaerung-api [--config <config.json>]";

export function parseApiMainArguments(argv: readonly string[]): ApiMainArguments {
  if (argv.length === 0) return { help: false };
  if (argv.length === 1 && ["--help", "-h"].includes(argv[0]!)) return { help: true };
  if (argv.length === 2 && argv[0] === "--config" && argv[1] && !argv[1].startsWith("--")) {
    return { help: false, configPath: argv[1] };
  }
  throw new Error(`Ungueltige API-Startargumente. ${API_MAIN_USAGE}`);
}
