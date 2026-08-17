export const COVERAGE_RANK = Object.freeze({
  untested: 0,
  "error-path-only": 1,
  functional: 2,
});

/**
 * Ein expliziter Teil-Live-Lauf darf die bestehende Evidenz nur verbessern.
 * Eine reale Regression wird weiterhin vom normalen strikten Coverage-Lauf
 * erkannt; beim bewussten Schreiben soll sie nicht versehentlich historische
 * Nachweise aus einer unvollständigen Probe entfernen.
 */
export function retainHighestCoverageStatus(previous = "untested", observed = "untested") {
  if (!(previous in COVERAGE_RANK)) throw new Error(`Unbekannter bisheriger Coverage-Status '${previous}'.`);
  if (!(observed in COVERAGE_RANK)) throw new Error(`Unbekannter beobachteter Coverage-Status '${observed}'.`);
  return COVERAGE_RANK[observed] > COVERAGE_RANK[previous] ? observed : previous;
}

/** Herkunftsmarken sind Evidenz, keine flüchtige Testausgabe. */
export function mergeCoverageLabels(previous = [], observed = []) {
  if (!Array.isArray(previous) || !Array.isArray(observed)) {
    throw new Error("Coverage-Herkunftsmarken müssen Listen sein.");
  }
  return [...new Set([...previous, ...observed])].sort();
}
