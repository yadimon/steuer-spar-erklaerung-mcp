import assert from "node:assert/strict";
import { once } from "node:events";
import { createSseApiServer } from "../dist/api-server.js";
import { localHttpFetch } from "../dist/local-http-transport.js";

/**
 * Jede Operation steuert dieselbe sichtbare Anwendung. Zwei gleichzeitige
 * Aufrufe wuerden zwei Arbeitsprozesse auf dasselbe Fenster setzen. Dieser
 * Vertrag haelt fest: es laeuft immer nur eine Operation, die zweite wird
 * ehrlich abgelehnt, und die Fortschrittsauskunft bleibt waehrenddessen
 * erreichbar.
 */

let releaseFirst;
const firstReleased = new Promise((resolve) => { releaseFirst = resolve; });
let started = 0;

const server = createSseApiServer({
  execute: async () => {
    started += 1;
    await firstReleased;
    return { ok: true, running: false };
  },
});
let peerStarted = 0;
const peerServer = createSseApiServer({
  execute: async () => {
    peerStarted += 1;
    return { ok: true, running: false };
  },
});
const listening = Promise.all([once(server, "listening"), once(peerServer, "listening")]);
server.listen(0, "127.0.0.1");
peerServer.listen(0, "127.0.0.1");
await listening;
const { port } = server.address();
const { port: peerPort } = peerServer.address();
const baseUrl = `http://127.0.0.1:${port}`;
const peerBaseUrl = `http://127.0.0.1:${peerPort}`;

const post = (operation) => localHttpFetch(`${baseUrl}/v1/operations/${operation}`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ args: {} }),
});
const health = () => localHttpFetch(`${baseUrl}/healthz`, { method: "GET" });
const peerPost = (operation) => localHttpFetch(`${peerBaseUrl}/v1/operations/${operation}`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ args: {} }),
});
const peerHealth = () => localHttpFetch(`${peerBaseUrl}/healthz`, { method: "GET" });

let first;
try {
  first = post("health");
  // Warten, bis der Arbeitsprozess wirklich belegt ist; sonst misst der Test
  // nur eine Wettlaufsituation statt der Sperre.
  while (started === 0) await new Promise((resolve) => setTimeout(resolve, 5));

  const busy = await post("capabilities");
  assert.equal(busy.status, 409, "Zweiter Aufruf muss abgelehnt werden, nicht parallel laufen.");
  const busyBody = await busy.json();
  assert.equal(busyBody.error.code, "busy");
  assert.equal(busyBody.inFlight.operation, "health");
  assert.match(busyBody.error.message, /nur eine Operation/u);
  assert(Number.isInteger(busyBody.inFlight.elapsedMs), "Belegtmeldung nennt keine bisherige Dauer.");

  // Die Fortschrittsauskunft darf gerade dann nicht blockieren.
  const during = await health();
  assert.equal(during.status, 200, "/healthz muss auch waehrend einer Operation antworten.");
  const duringBody = await during.json();
  assert.equal(duringBody.inFlight.operation, "health");
  assert.equal(duringBody.inFlight.requestId, busyBody.inFlight.requestId);

  // Die Sperre schuetzt genau die von dieser Serverinstanz gesteuerte
  // Anwendung. Ein zweiter eingebetteter Server darf weder den Zustand sehen
  // noch von ihm blockiert werden.
  const peerDuring = await peerHealth();
  assert.equal((await peerDuring.json()).inFlight, null, "Serverzustand darf nicht instanzuebergreifend durchsickern.");
  const peerOperation = await peerPost("health");
  await peerOperation.json();
  assert.equal(peerOperation.status, 200,
    "Unabhaengige API-Server duerfen sich nicht gegenseitig blockieren.");
  assert.equal(peerStarted, 1);

  releaseFirst();
  assert.equal((await first).status, 200);
  assert.equal(started, 1, "Es darf nur ein Arbeitsprozess gestartet worden sein.");

  // Nach Abschluss ist der Platz wieder frei und die Auskunft leer.
  const after = await health();
  assert.equal((await after.json()).inFlight, null);
  assert.equal((await post("capabilities")).status, 200, "Nach Abschluss muss der naechste Aufruf laufen.");
  assert.equal(started, 2);
} finally {
  releaseFirst();
  if (first) await first.then((response) => response.json()).catch(() => undefined);
  await Promise.all([
    new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
    new Promise((resolve, reject) => peerServer.close((error) => (error ? reject(error) : resolve()))),
  ]);
}

process.stdout.write("API-Single-Flight: instanzlokale Sperre, ehrliche Belegtmeldung und freie Fortschrittsauskunft bestanden\n");
