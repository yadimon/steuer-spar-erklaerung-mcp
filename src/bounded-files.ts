import { closeSync, fstatSync, openSync, readSync } from "node:fs";

/** Liest eine regulaere Datei auch bei gleichzeitigem Wachstum speicherbegrenzt. */
export function readFileBounded(path: string, maxBytes: number): Buffer {
  if (!Number.isInteger(maxBytes) || maxBytes < 1) throw new Error("Dateilimit muss eine positive ganze Zahl sein.");
  const descriptor = openSync(path, "r");
  try {
    const stats = fstatSync(descriptor);
    if (!stats.isFile()) throw new Error("Pfad bezeichnet keine regulaere Datei.");
    if (stats.size > maxBytes) throw new Error(`Datei ist groesser als ${maxBytes} Bytes.`);

    const chunks: Buffer[] = [];
    const scratch = Buffer.allocUnsafe(Math.min(64 * 1024, maxBytes + 1));
    let total = 0;
    while (true) {
      const bytesRead = readSync(descriptor, scratch, 0, scratch.length, null);
      if (bytesRead === 0) break;
      total += bytesRead;
      if (total > maxBytes) throw new Error(`Datei ist groesser als ${maxBytes} Bytes.`);
      chunks.push(Buffer.from(scratch.subarray(0, bytesRead)));
    }
    return Buffer.concat(chunks, total);
  } finally {
    closeSync(descriptor);
  }
}
