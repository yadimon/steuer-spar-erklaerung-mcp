import type { BigIntStats } from "node:fs";

/**
 * Bindet einen bereits geoeffneten Handle an dasselbe Dateisystemobjekt wie
 * einen spaeteren Pfad-Stat. Groesse und Zeitstempel duerfen sich bei einem
 * kontrollierten Schreibvorgang aendern und gehoeren deshalb nicht hierher.
 */
export function sameFileIdentity(left: BigIntStats, right: BigIntStats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

/** Vollstaendige beobachtbare Dateiidentitaet fuer stabile Leseoperationen. */
export function sameFileState(left: BigIntStats, right: BigIntStats): boolean {
  return sameFileIdentity(left, right) && left.size === right.size &&
    left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs;
}
