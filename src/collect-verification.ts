import type { WorkerResult } from "./api-contract.js";

interface DecimalValue {
  coefficient: bigint;
  scale: number;
}

interface MatchResult {
  ok: boolean;
  kind: "matched" | "missing" | "ambiguous" | "occurrence-out-of-range";
  mode: string;
  count: number;
  item: Record<string, unknown> | null;
  candidates: string[];
}

export type CollectComparisonOutcome =
  | { kind: "result"; result: WorkerResult }
  | { kind: "worker-fallback" };

const DOTNET_DECIMAL_MAX = 79_228_162_514_264_337_593_543_950_335n;
const POWERS_OF_TEN = Array.from({ length: 29 }, (_, exponent) => 10n ** BigInt(exponent));

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function dotNetWhitespace(character: string): boolean {
  return character === "\u0085" || (character !== "\uFEFF" && /^\s$/u.test(character));
}

function trimDotNet(value: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && dotNetWhitespace(value[start]!)) start += 1;
  while (end > start && dotNetWhitespace(value[end - 1]!)) end -= 1;
  return value.slice(start, end);
}

function removeDotNetWhitespace(value: string): string {
  return [...value].filter((character) => !dotNetWhitespace(character)).join("");
}

/**
 * Reproduziert den fuer deutsche SSE-Bezeichner benoetigten, sicheren Teil
 * von .NET OrdinalIgnoreCase. Sobald Node eine weitere Unicode-Faltung
 * vornehmen wuerde, entscheidet der Aufrufer nicht selbst, sondern nutzt den
 * kompatiblen Worker. Das verhindert insbesondere falsche Treffer fuer ẞ
 * und das Kelvinzeichen.
 */
function foldLocalOrdinal(value: string): string | undefined {
  let folded = "";
  for (const character of value) {
    if (character >= "A" && character <= "Z") {
      folded += character.toLowerCase();
    } else if (character >= "a" && character <= "z") {
      folded += character;
    } else if (character === "Ä") {
      folded += "ä";
    } else if (character === "ä") {
      folded += character;
    } else if (character === "Ö") {
      folded += "ö";
    } else if (character === "ö") {
      folded += character;
    } else if (character === "Ü") {
      folded += "ü";
    } else if (character === "ü") {
      folded += character;
    } else if (character === "ß") {
      folded += character;
    } else if (character.toLowerCase() !== character || character.toUpperCase() !== character) {
      return undefined;
    } else {
      folded += character;
    }
  }
  return folded;
}

/** PowerShell -eq ist fuer Strings invariant-kulturell und ignoriert Gross-/Kleinschreibung. */
function foldLocalValue(value: string): string | undefined {
  let folded = "";
  for (const character of value) {
    if (character >= "a" && character <= "z") {
      folded += character.toUpperCase();
    } else if (character >= "A" && character <= "Z") {
      folded += character;
    } else if (character === "ä" || character === "Ä") {
      folded += "Ä";
    } else if (character === "ö" || character === "Ö") {
      folded += "Ö";
    } else if (character === "ü" || character === "Ü") {
      folded += "Ü";
    } else if (character === "ß") {
      folded += "SS";
    } else if (/^\p{Cf}$/u.test(character)) {
      return undefined;
    } else if (character.toLowerCase() !== character || character.toUpperCase() !== character) {
      return undefined;
    } else {
      folded += character;
    }
  }
  return folded;
}

function decimalFromNormalized(value: string): DecimalValue | "worker-fallback" {
  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const [integer = "", fraction = ""] = unsigned.split(".", 2);
  let scale = fraction.length;
  let coefficient = BigInt(`${integer}${fraction}` || "0");
  while (scale > 0 && coefficient % 10n === 0n) {
    coefficient /= 10n;
    scale -= 1;
  }
  if (scale > 28 || coefficient > DOTNET_DECIMAL_MAX) return "worker-fallback";
  return { coefficient: negative ? -coefficient : coefficient, scale };
}

function parseTableNumber(value: string): DecimalValue | null | "worker-fallback" {
  let text = trimDotNet(value);
  text = text.replace(/^(?:€|EUR)\s*/iu, "");
  text = text.replace(/\s*(?:€|EUR|%)$/iu, "");
  text = removeDotNetWhitespace(text);
  if (!text) return null;

  let normalized: string;
  if (/^-?[0-9]+$/u.test(text)) {
    normalized = text;
  } else if (/^-?(?:[0-9]{1,3}(?:\.[0-9]{3})+|[0-9]+),[0-9]+$/u.test(text)) {
    normalized = text.replaceAll(".", "").replace(",", ".");
  } else if (/^-?[0-9]+\.[0-9]+$/u.test(text)) {
    const fraction = text.replace(/^-/, "").split(".", 2)[1] ?? "";
    normalized = fraction.length === 3 ? text.replace(".", "") : text;
  } else if (/^-?[0-9]{1,3}(?:\.[0-9]{3}){2,}$/u.test(text)) {
    normalized = text.replaceAll(".", "");
  } else {
    return null;
  }
  return decimalFromNormalized(normalized);
}

function decimalEqual(left: DecimalValue, right: DecimalValue): boolean {
  const scale = Math.max(left.scale, right.scale);
  return left.coefficient * POWERS_OF_TEN[scale - left.scale]! ===
    right.coefficient * POWERS_OF_TEN[scale - right.scale]!;
}

function roundedDifference(left: DecimalValue, right: DecimalValue): number | "worker-fallback" {
  const scale = Math.max(left.scale, right.scale);
  const difference = left.coefficient * POWERS_OF_TEN[scale - left.scale]! -
    right.coefficient * POWERS_OF_TEN[scale - right.scale]!;
  let cents: bigint;
  if (scale <= 2) {
    cents = difference * POWERS_OF_TEN[2 - scale]!;
  } else {
    const divisor = POWERS_OF_TEN[scale - 2]!;
    const absolute = difference < 0n ? -difference : difference;
    let rounded = absolute / divisor;
    const remainder = absolute % divisor;
    if (remainder * 2n > divisor || (remainder * 2n === divisor && rounded % 2n !== 0n)) rounded += 1n;
    cents = difference < 0n ? -rounded : rounded;
  }
  if (cents > BigInt(Number.MAX_SAFE_INTEGER) || cents < BigInt(Number.MIN_SAFE_INTEGER)) {
    return "worker-fallback";
  }
  return Number(cents) / 100;
}

function resolveMatch(
  items: unknown[],
  property: string,
  needle: string,
  occurrence: number | undefined,
): MatchResult | "worker-fallback" {
  const foldedNeedle = foldLocalOrdinal(needle);
  if (foldedNeedle === undefined) return "worker-fallback";
  const prepared: Array<{ item: Record<string, unknown>; value: string; folded: string }> = [];
  for (const candidate of items) {
    const item = objectValue(candidate);
    if (!item || typeof item[property] !== "string") return "worker-fallback";
    const value = item[property];
    const folded = foldLocalOrdinal(value);
    if (folded === undefined) return "worker-fallback";
    prepared.push({ item, value, folded });
  }

  const exact = prepared.filter((candidate) => candidate.folded === foldedNeedle);
  const matches = exact.length > 0
    ? exact
    : prepared.filter((candidate) => candidate.folded.includes(foldedNeedle));
  const mode = exact.length > 0 ? "exact" : "substring";
  const candidates = matches.map((candidate) => candidate.value);
  if (matches.length === 0) {
    return { ok: false, kind: "missing", mode, count: 0, item: null, candidates };
  }
  if (occurrence !== undefined) {
    if (occurrence < 1 || occurrence > matches.length) {
      return { ok: false, kind: "occurrence-out-of-range", mode, count: matches.length, item: null, candidates };
    }
    return {
      ok: true,
      kind: "matched",
      mode: `${mode}-occurrence`,
      count: matches.length,
      item: matches[occurrence - 1]!.item,
      candidates,
    };
  }
  if (matches.length !== 1) {
    return { ok: false, kind: "ambiguous", mode, count: matches.length, item: null, candidates };
  }
  return { ok: true, kind: "matched", mode, count: 1, item: matches[0]!.item, candidates };
}

function compareValues(actual: string, expected: string):
  | { equal: boolean; difference: number | null }
  | "worker-fallback" {
  const actualNumber = parseTableNumber(actual);
  const expectedNumber = parseTableNumber(expected);
  if (actualNumber === "worker-fallback" || expectedNumber === "worker-fallback") return "worker-fallback";
  if (actualNumber !== null && expectedNumber !== null) {
    const difference = roundedDifference(actualNumber, expectedNumber);
    if (difference === "worker-fallback") return "worker-fallback";
    return { equal: decimalEqual(actualNumber, expectedNumber), difference };
  }
  const actualText = foldLocalValue(trimDotNet(actual));
  const expectedText = foldLocalValue(trimDotNet(expected));
  if (actualText === undefined || expectedText === undefined) return "worker-fallback";
  return { equal: actualText === expectedText, difference: null };
}

function failureStatus(kind: MatchResult["kind"], target: "page" | "field"): string {
  if (kind === "missing") return target === "page" ? "Seite fehlt" : "Feld fehlt";
  if (kind === "ambiguous") return target === "page" ? "Seite mehrdeutig" : "Feld mehrdeutig";
  return target === "page" ? "Seiten-Occurrence ungueltig" : "Feld-Occurrence ungueltig";
}

export function compareCollectExpectations(
  source: unknown,
  expectations: unknown[],
  allowIncompleteSource: boolean,
  sourceHash: string,
): CollectComparisonOutcome {
  const document = objectValue(source);
  if (!document || !Array.isArray(document.seiten)) {
    return { kind: "result", result: { ok: false, kind: "invalid-source", error: "Collect-JSON enthaelt keine Seitenliste." } };
  }
  const pages = document.seiten;
  if (pages.length === 0) {
    return { kind: "result", result: { ok: false, kind: "invalid-source", error: "Collect-JSON enthaelt keine Seiten." } };
  }
  const sourceComplete = typeof document.vollstaendig === "boolean" ? document.vollstaendig : null;
  const sourceStopKind = document.stopKind ?? null;
  const sourceStopReason = document.stopReason ?? null;
  if (sourceComplete !== true && !allowIncompleteSource) {
    return {
      kind: "result",
      result: {
        ok: false,
        kind: "verification-source-incomplete",
        error: "Collect-JSON ist unvollstaendig oder stammt aus einem alten Format ohne " +
          "Vollstaendigkeitsnachweis. Nur mit allowIncompleteSource=true ist ein klar begrenzter " +
          "Teilstandsabgleich erlaubt.",
        sourceHash,
        sourceVollstaendig: sourceComplete,
        sourceStopKind,
        sourceStopReason,
        seiten: pages.length,
      },
    };
  }

  const results: Array<Record<string, unknown>> = [];
  for (const rawExpectation of expectations) {
    const expectation = objectValue(rawExpectation);
    if (!expectation || typeof expectation.seite !== "string" ||
        typeof expectation.label !== "string" || typeof expectation.wert !== "string") {
      return { kind: "worker-fallback" };
    }
    const requestedPage = expectation.seite;
    const requestedLabel = expectation.label;
    const expectedValue = expectation.wert;
    if (!trimDotNet(requestedPage) || !trimDotNet(requestedLabel)) {
      results.push({
        seite: requestedPage,
        label: requestedLabel,
        soll: expectedValue,
        ist: null,
        status: "Ungueltige Erwartung",
      });
      continue;
    }
    const pageMatch = resolveMatch(
      pages,
      "ueberschrift",
      requestedPage,
      typeof expectation.seiteOccurrence === "number" ? expectation.seiteOccurrence : undefined,
    );
    if (pageMatch === "worker-fallback") return { kind: "worker-fallback" };
    if (!pageMatch.ok) {
      results.push({
        seite: requestedPage,
        label: requestedLabel,
        soll: expectedValue,
        ist: null,
        status: failureStatus(pageMatch.kind, "page"),
        matchMode: pageMatch.mode,
        treffer: pageMatch.count,
        kandidaten: pageMatch.candidates,
      });
      continue;
    }
    const page = pageMatch.item!;
    if (!Array.isArray(page.felder) || typeof page.ueberschrift !== "string") return { kind: "worker-fallback" };
    const fieldMatch = resolveMatch(
      page.felder,
      "label",
      requestedLabel,
      typeof expectation.labelOccurrence === "number" ? expectation.labelOccurrence : undefined,
    );
    if (fieldMatch === "worker-fallback") return { kind: "worker-fallback" };
    if (!fieldMatch.ok) {
      results.push({
        seite: page.ueberschrift,
        label: requestedLabel,
        soll: expectedValue,
        ist: null,
        status: failureStatus(fieldMatch.kind, "field"),
        pageMatchMode: pageMatch.mode,
        matchMode: fieldMatch.mode,
        treffer: fieldMatch.count,
        kandidaten: fieldMatch.candidates,
      });
      continue;
    }
    const field = fieldMatch.item!;
    if (typeof field.label !== "string" || typeof field.wert !== "string") return { kind: "worker-fallback" };
    const comparison = compareValues(field.wert, expectedValue);
    if (comparison === "worker-fallback") return { kind: "worker-fallback" };
    results.push({
      seite: page.ueberschrift,
      label: field.label,
      soll: expectedValue,
      ist: field.wert,
      differenz: comparison.difference,
      pageMatchMode: pageMatch.mode,
      matchMode: fieldMatch.mode,
      status: comparison.equal ? "stimmt" : "ABWEICHUNG",
    });
  }

  const deviations = results.filter((result) => result.status !== "stimmt").length;
  return {
    kind: "result",
    result: {
      ok: true,
      vergleichOk: deviations === 0,
      sourceHash,
      sourceVollstaendig: sourceComplete,
      sourceStopKind,
      sourceStopReason,
      geprueft: results.length,
      abweichungen: deviations,
      ergebnis: results,
      zusammenfassung: deviations > 0
        ? `${deviations} von ${results.length} Erwartungen weichen ab oder sind nicht eindeutig zugeordnet.`
        : sourceComplete === true
          ? `Alle ${results.length} Erwartungen stimmen im vollstaendigen Collect-Stand.`
          : `Alle ${results.length} Erwartungen stimmen im bewusst unvollstaendigen Teilstand; keine Gesamtaussage zur Erklaerung.`,
    },
  };
}
