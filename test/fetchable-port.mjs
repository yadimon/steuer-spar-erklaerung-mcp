import { once } from "node:events";

/**
 * Ein flüchtiger Loopback-Port, den `fetch` auch wirklich anspricht.
 *
 * `server.listen(0)` überlässt dem Betriebssystem die Wahl, und die
 * Fetch-Spezifikation sperrt eine feste Liste von Ports: `fetch` bricht dort
 * mit `TypeError: fetch failed` / `Error: bad port` ab, ohne den Server je zu
 * kontaktieren. Auf dieser Maschine reicht der dynamische Portbereich von 1024
 * bis 65534 und enthält damit 17 gesperrte Ports - rund eine von 3800
 * Bindungen trifft einen. Genau das ist am 2026-09-06 im Release-Gate passiert
 * und sah aus wie ein Produktfehler.
 *
 * Der API-Client ist davon nicht betroffen: sein Transport baut auf
 * `node:http` auf, nicht auf dem globalen `fetch`. Betroffen sind nur Tests,
 * die den Port selbst per `fetch` ansprechen.
 */
const VON_FETCH_GESPERRTE_PORTS = new Set([
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79,
  87, 95, 101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137,
  139, 143, 161, 179, 389, 427, 465, 512, 513, 514, 515, 526, 530, 531, 532,
  540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993, 995, 1719, 1720, 1723,
  2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669,
  6679, 6697, 10080,
]);

export function isFetchablePort(port) {
  return Number.isInteger(port) && port > 0 && port < 65536 &&
    !VON_FETCH_GESPERRTE_PORTS.has(port);
}

/**
 * Bindet `server` an einen freien Loopback-Port, den `fetch` ansprechen darf,
 * und liefert ihn zurück. Trifft die Zuteilung einen gesperrten Port, wird der
 * Server geschlossen und erneut gebunden.
 *
 * Die Zahl der Versuche ist begrenzt: Ein Dauerfehlschlag ist ein Befund und
 * darf nicht als Endlosschleife enden.
 */
export async function listenOnFetchablePort(server, host = "127.0.0.1", maxAttempts = 20) {
  const abgelehnt = [];
  for (let versuch = 0; versuch < maxAttempts; versuch += 1) {
    server.listen(0, host);
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address !== "object") {
      throw new Error("Server meldet keine Adresse nach 'listening'.");
    }
    if (isFetchablePort(address.port)) return address.port;
    abgelehnt.push(address.port);
    await new Promise((schliessen) => server.close(schliessen));
  }
  throw new Error(
    `Kein von fetch ansprechbarer Port nach ${maxAttempts} Versuchen; abgelehnt: ${abgelehnt.join(", ")}.`,
  );
}
