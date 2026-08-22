/**
 * Ein Verzeichnis entfernen, sobald kein Prozess es mehr haelt.
 *
 * Wird eine API mit SIGTERM beendet, ist das unter Windows ein hartes
 * TerminateProcess: ihr Shutdown-Pfad laeuft nicht. Ihr vorgewaermter
 * Reservearbeiter beendet sich zwar von selbst, sobald er das Ende seiner
 * Standardeingabe sieht - aber erst, NACHDEM er das Workerskript fertig
 * geladen hat. Bis dahin haelt er sein Arbeitsverzeichnis und die geladene
 * Interop-DLL. Ein sofortiges rmSync scheitert dann auf langsamen Rechnern
 * mit EBUSY, auf schnellen zufaellig nicht. Deshalb wird hier gewartet statt
 * geraten.
 */
import { existsSync, rmSync } from "node:fs";

const TRANSIENT = new Set(["EBUSY", "EPERM", "ENOTEMPTY"]);

export async function removeDirectoryWhenFree(path, { attempts = 20, delayMs = 250 } = {}) {
  for (let attempt = 0; attempt < attempts && existsSync(path); attempt += 1) {
    try {
      rmSync(path, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 });
    } catch (error) {
      if (!error || !TRANSIENT.has(error.code) || attempt === attempts - 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}
