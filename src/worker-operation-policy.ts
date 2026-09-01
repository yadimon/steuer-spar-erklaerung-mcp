import type { SseApiOperation } from "./api-contract.js";

/**
 * Statische Worker-Lesewege ohne UI-/Desktopzugriff und ohne Controller-Lease.
 *
 * Ein vorhandener Desktop-Marker wird trotzdem vor jedem Aufruf vollstaendig
 * gelesen und auf Eigentum geprueft. Nur der anschliessende Prozess darf auf
 * dem sichtbaren Desktop vorgewaermt bleiben, weil diese beiden Operationen
 * weder Fenster enumerieren noch Eingaben an SSE senden.
 */
export const SSE_DESKTOP_INDEPENDENT_STATIC_WORKER_OPERATIONS = Object.freeze([
  "page_objects",
  "product_info",
] as const satisfies readonly SseApiOperation[]);

// Heute ist exakt derselbe enge Katalog auch mutexfrei. Der getrennte Name
// verhindert, dass eine kuenftige controllerfreie Fensteroperation dadurch
// versehentlich ebenfalls die Desktopgrenze umgeht.
export const SSE_WORKER_CONTROLLER_BYPASS_OPERATIONS =
  SSE_DESKTOP_INDEPENDENT_STATIC_WORKER_OPERATIONS;

const DESKTOP_INDEPENDENT_SET = new Set<string>(SSE_DESKTOP_INDEPENDENT_STATIC_WORKER_OPERATIONS);

export function workerOperationNeedsMarkedDesktop(operation: string): boolean {
  return !DESKTOP_INDEPENDENT_SET.has(operation);
}
