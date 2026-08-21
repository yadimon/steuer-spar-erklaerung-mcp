import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";

/**
 * Haengt den npm-Kanal `latest` auf die aktuelle Paketversion.
 *
 * Trusted Publishing deckt nur `npm publish` ab, nicht `npm dist-tag`. Dieser
 * eine Schritt braucht deshalb die Anmeldung des Maintainers. Damit daraus
 * nicht jedes Mal zwei handgetippte Befehle werden, fragt dieses Skript genau
 * einmal nach dem Einmalcode und erledigt beide Pakete.
 *
 * Der Code wird ausschliesslich ueber `npm_config_otp` an npm weitergereicht,
 * landet also weder in der Prozessliste noch in einer Ausgabe oder Datei.
 */

const npmCli = process.env.npm_execpath ?? join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
if (!existsSync(npmCli)) throw new Error(`npm CLI fehlt: ${npmCli}`);

const packageNames = ["@yadimon/steuer-spar-erklaerung-mcp", "@yadimon/steuer-spar-erklaerung-api"];
const version = JSON.parse(readFileSync("package.json", "utf8")).version;

function npm(args, otp) {
  return spawnSync(process.execPath, [npmCli, ...args], {
    encoding: "utf8",
    windowsHide: true,
    env: otp ? { ...process.env, npm_config_otp: otp } : process.env,
  });
}

function readTags(packageName) {
  const result = npm(["view", packageName, "dist-tags", "--json"]);
  if (result.status !== 0) {
    throw new Error(`dist-tags fuer ${packageName} nicht lesbar: ${(result.stderr || result.stdout).trim()}`);
  }
  return JSON.parse(result.stdout || "{}");
}

const pending = packageNames.filter((packageName) => readTags(packageName).latest !== version);
if (pending.length === 0) {
  process.stdout.write(`latest zeigt bereits auf ${version}; nichts zu tun.\n`);
  process.exit(0);
}

for (const packageName of pending) {
  process.stdout.write(`${packageName}: latest=${readTags(packageName).latest ?? "(keiner)"} -> ${version}\n`);
}

// Ohne Terminal darf nicht stillschweigend nichts passieren: dann wird der
// exakte Weg genannt und mit einem Fehler beendet.
if (!process.stdin.isTTY) {
  process.stderr.write(
    "Dieser Schritt braucht ein Terminal fuer den Einmalcode.\n" +
    "In einer eigenen Konsole ausfuehren:\n  npm run release:latest\n",
  );
  process.exit(1);
}

const prompt = createInterface({ input: process.stdin, output: process.stdout });
const otp = (await prompt.question("npm-Einmalcode (Authenticator): ")).trim();
prompt.close();
if (!/^[0-9]{6,8}$/u.test(otp)) throw new Error("Einmalcode muss 6 bis 8 Ziffern haben.");

for (const packageName of pending) {
  const result = npm(["dist-tag", "add", `${packageName}@${version}`, "latest"], otp);
  if (result.status !== 0) {
    throw new Error(`latest fuer ${packageName} nicht gesetzt: ${(result.stderr || result.stdout).trim()}`);
  }
}

for (const packageName of packageNames) {
  const tags = readTags(packageName);
  if (tags.latest !== version) {
    throw new Error(`Unerwartete dist-tags fuer ${packageName}: ${JSON.stringify(tags)}`);
  }
  process.stdout.write(`${packageName}: latest und beta zeigen auf ${version}.\n`);
}
