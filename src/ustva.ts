import type { WorkerResult } from "./api-contract.js";

export const USTVA_PAGE_HEADING_PREFIX = "Umsatzsteuer-Voranmeldungen ";
const USTVA_PAGE_HEADING_PATTERN = /^Umsatzsteuer-Voranmeldungen (?<taxYear>\d{4})$/u;
export const USTVA_REVERSE_CHARGE_PAGE = "Steuerschuldnerschaft nach § 13b UStG";
export const USTVA_INPUT_TAX_PAGE = "Abziehbare Vorsteuer";

function parseUstvaPageHeading(value: unknown): { page: string; taxYear: number } | null {
  if (typeof value !== "string") return null;
  const match = USTVA_PAGE_HEADING_PATTERN.exec(value);
  if (!match?.groups?.taxYear) return null;
  const taxYear = Number(match.groups.taxYear);
  if (!Number.isInteger(taxYear) || taxYear < 2000 || taxYear > 2200) return null;
  return { page: value, taxYear };
}

export const USTVA_PERIOD_SELECTORS = {
  frequency: {
    aid: ".AuswahlAnmeldezeitraum.Zeitraum.Combobox",
    values: {
      monthly: "monatlich",
      quarterly: "vierteljährlich",
    },
  },
  month: {
    aid: ".AuswahlAnmeldezeitraum.AuswahlMonat.Combobox",
    values: {
      january: "Januar",
      february: "Februar",
      march: "März",
      april: "April",
      may: "Mai",
      june: "Juni",
      july: "Juli",
      august: "August",
      september: "September",
      october: "Oktober",
      november: "November",
      december: "Dezember",
    },
  },
  quarter: {
    aid: ".AuswahlAnmeldezeitraum.AuswahlQuartal.Combobox",
    values: {
      q1: "1. Vierteljahr",
      q2: "2. Vierteljahr",
      q3: "3. Vierteljahr",
      q4: "4. Vierteljahr",
    },
  },
} as const;

export const USTVA_FLAGS = {
  corrected: ".AngabenZurVoranmeldung.Berichtigt",
  documents: ".AngabenZurVoranmeldung.Belege",
  offset_request: ".AngabenZurVoranmeldung.Verrech",
  revoke_sepa: ".AngabenZurVoranmeldung.Widerruf",
  additional_information: ".AngabenZurVoranmeldung.WeitereAngaben",
  manual_input: ".RahmenWerteUebersicht.ManuelleEingabe",
} as const;

export const USTVA_VALUE_FIELDS = {
  taxable_19_base: {
    aid: ".RahmenWerteUebersicht.LieferungNorm.BetragEigen", page: "overview", manualOnly: true,
  },
  taxable_7_base: {
    aid: ".RahmenWerteUebersicht.LieferungErm.BetragEigen", page: "overview", manualOnly: true,
  },
  taxable_zero_base: {
    aid: ".RahmenWerteUebersicht.UStSatzNull.Wert", page: "overview", manualOnly: false,
  },
  other_rates_base: {
    aid: ".RahmenWerteUebersicht.LieferungAnder.BetragEigen", page: "overview", manualOnly: true,
  },
  other_rates_tax: {
    aid: ".RahmenWerteUebersicht.LieferungAnder.BetragUStEigen", page: "overview", manualOnly: true,
  },
  reverse_charge_eu_base: {
    aid: ".Steuerschuldnerschaft13b.SonstigeLeistungEU.Betraege13bEigenAngaben.Wert",
    page: "reverse_charge",
    manualOnly: true,
  },
  reverse_charge_eu_tax: {
    aid: ".Steuerschuldnerschaft13b.SonstigeLeistungEU.Betraege13bEigenAngaben.Wert2",
    page: "reverse_charge",
    manualOnly: true,
  },
  reverse_charge_foreign_services_base: {
    aid: ".Steuerschuldnerschaft13b.SonstigeLeistungAuslUnternehmer.Betraege13bEigenAngaben.Wert",
    page: "reverse_charge",
    manualOnly: true,
  },
  reverse_charge_foreign_services_tax: {
    aid: ".Steuerschuldnerschaft13b.SonstigeLeistungAuslUnternehmer.Betraege13bEigenAngaben.Wert2",
    page: "reverse_charge",
    manualOnly: true,
  },
  input_tax_invoices: {
    aid: ".VoStManuell.SummeVoStAndere.BetragManuell", page: "input_tax", manualOnly: true,
  },
  input_tax_reverse_charge: {
    aid: ".VoStManuell.VoStAuslandUndSumme.VoSt13b.BetragEigen", page: "input_tax", manualOnly: true,
  },
  input_tax_import: {
    aid: ".VoStManuell.VoStAuslandUndSumme.EinfuhrUSt.BetragManuell", page: "input_tax", manualOnly: true,
  },
  input_tax_adjustment: {
    aid: ".RahmenWerteUebersicht.VStBerichtigung.Wert", page: "overview", manualOnly: false,
  },
  special_advance_payment: {
    aid: ".RahmenWerteUebersicht.SonderVZ.Wert", page: "overview", manualOnly: false,
  },
  reduction_taxable_base: { aid: ".MinderungBMG.Wert", page: "overview", manualOnly: false },
  reduction_input_tax: { aid: ".MinderungVoSt.Wert", page: "overview", manualOnly: false },
} as const;

export const USTVA_SECTIONS = {
  reverse_charge: {
    aid: ".RahmenWerteUebersicht.GrpAuslandsgeschaefte.Empf13b.Button",
    targetPage: USTVA_REVERSE_CHARGE_PAGE,
  },
  input_tax: {
    aid: ".RahmenWerteUebersicht.VoSt.Button",
    targetPage: USTVA_INPUT_TAX_PAGE,
  },
  small_business: {
    aid: ".RahmenKleinunternehmer.BesteuerungKleinU.Button",
    targetPage: "Themenfilter/Angaben zur Umsatzsteuer",
  },
  tax_exempt: {
    aid: ".RahmenSteuerfreiUndNichtSteuerbar.Stfr.Button",
    targetPage: "Steuerfreie Umsätze",
  },
  non_taxable: {
    aid: ".RahmenSteuerfreiUndNichtSteuerbar.NichtsteuerbareUmsaetze.Button",
    targetPage: "Meldepflichtige nicht steuerbare Umsätze",
  },
} as const;

type PageField = {
  label?: unknown;
  typ?: unknown;
  wert?: unknown;
  schreibgeschuetzt?: unknown;
  aid?: unknown;
};

function normalizedLabel(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[\u200b-\u200d\ufeff]/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

function cents(display: unknown): number | null {
  if (typeof display !== "string") return null;
  const text = display.trim();
  if (text.length > 64 || !/^-?(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d{1,2})?$/u.test(text)) return null;
  const negative = text.startsWith("-");
  const unsigned = negative ? text.slice(1) : text;
  const [euros = "", decimal = ""] = unsigned.split(",", 2);
  const exact = BigInt(euros.replaceAll(".", "")) * 100n + BigInt(decimal.padEnd(2, "0") || "0");
  const signed = negative ? -exact : exact;
  if (signed > BigInt(Number.MAX_SAFE_INTEGER) || signed < BigInt(Number.MIN_SAFE_INTEGER)) return null;
  return Number(signed);
}

function amount(display: unknown) {
  const text = typeof display === "string" ? display : null;
  return { display: text, cents: cents(text) };
}

function findFields(fields: PageField[], label: string, type?: string): PageField[] {
  return fields.filter((field) => normalizedLabel(field.label) === label && (!type || field.typ === type));
}

function firstValue(fields: PageField[], label: string, type?: string): unknown {
  return findFields(fields, label, type)[0]?.wert;
}

function flagValue(fields: PageField[], label: string): boolean | null {
  const value = firstValue(fields, label, "CheckBox");
  return typeof value === "boolean" ? value : null;
}

function pair(fields: PageField[], label: string) {
  const matches = findFields(fields, label, "Edit");
  const byAid = (...aids: string[]) => matches.find((field) => aids.includes(String(field.aid ?? "")))?.wert;
  return {
    base: amount(byAid("Wert", "BetragEigen")),
    tax: amount(byAid("WertUSt", "BetragUStEigen")),
  };
}

function detailPair(fields: PageField[], label: string) {
  const matches = findFields(fields, label, "Edit");
  return {
    base: amount(matches[0]?.wert),
    tax: amount(matches[1]?.wert),
  };
}

function semanticPeriod(frequencyDisplay: string | null, periodDisplay: string | null) {
  const frequency = frequencyDisplay === "monatlich"
    ? "monthly"
    : frequencyDisplay === "vierteljährlich"
      ? "quarterly"
      : null;
  const selector = frequency === "monthly" ? "month" : frequency === "quarterly" ? "quarter" : null;
  let key: string | null = null;
  if (selector) {
    const values = USTVA_PERIOD_SELECTORS[selector].values as Record<string, string>;
    key = Object.entries(values).find(([, display]) => display === periodDisplay)?.[0] ?? null;
  }
  return { frequency, frequencyDisplay, selector, key, display: periodDisplay };
}

export function mapUstvaPeriodValue(selector: string, key: string): { aid: string; display: string } {
  if (!Object.hasOwn(USTVA_PERIOD_SELECTORS, selector)) {
    throw new Error(`Unbekannter UStVA-Zeitraumselektor: '${selector}'.`);
  }
  const definition = USTVA_PERIOD_SELECTORS[selector as keyof typeof USTVA_PERIOD_SELECTORS];
  const display = (definition.values as Record<string, string>)[key];
  if (!display) throw new Error(`UStVA-Wert '${key}' ist fuer '${selector}' nicht erlaubt.`);
  return { aid: definition.aid, display };
}

function blockedPage(page: WorkerResult): WorkerResult | null {
  if (page.ok === false) return page;
  const dialogs = Array.isArray(page.dialoge) ? page.dialoge : [];
  if (dialogs.length > 0) {
    return {
      ok: false,
      kind: "dialog-open",
      error: "Ein modaler Dialog ist offen; UStVA-Werte wurden nicht als belastbarer Snapshot ausgegeben.",
      dialogs,
    };
  }
  return null;
}

function normalizeUstvaPage(page: WorkerResult): WorkerResult {
  const blocked = blockedPage(page);
  if (blocked) return blocked;
  const heading = parseUstvaPageHeading(page.ueberschrift);
  if (!heading) {
    return {
      ok: false,
      kind: "ustva-page",
      error: `UStVA-Lesung braucht '${USTVA_PAGE_HEADING_PREFIX}<Jahr>'; aktuell ist '${String(page.ueberschrift ?? "")}' offen.`,
    };
  }
  const fields = Array.isArray(page.felder) ? page.felder as PageField[] : [];
  const frequencyDisplay = firstValue(fields, "Voranmeldezeitraum", "ComboBox");
  const monthDisplay = firstValue(fields, "Auswahl Monat", "ComboBox");
  const quarterDisplay = firstValue(fields, "Auswahl Quartal", "ComboBox");
  const settlementPayment = firstValue(fields, "Umsatzsteuerzahllast", "Edit");
  const settlementRefund = firstValue(fields, "Umsatzsteuererstattung", "Edit");
  const actions = Array.isArray(page.aktionen) ? page.aktionen as Array<Record<string, unknown>> : [];
  const elster = actions.find((action) => normalizedLabel(action.name).includes("ELSTER"));
  const flags = Object.fromEntries(Object.entries({
    corrected: "Berichtigte Voranmeldung",
    documents: "Belege",
    offset_request: "Verrechnungswunsch",
    revoke_sepa: "Widerruf SEPA-Lastschriftmandat",
    additional_information: "Ergänzende Angaben zur Umsatzsteuer-Voranmeldung",
    manual_input: "Beträge für die Umsatzsteuer-Voranmeldung manuell erfassen",
  }).map(([key, label]) => [key, flagValue(fields, label)]));

  return {
    ok: true,
    pageKind: "overview",
    taxYear: heading.taxYear,
    page: heading.page,
    period: semanticPeriod(
      typeof frequencyDisplay === "string" ? frequencyDisplay : null,
      typeof monthDisplay === "string" ? monthDisplay : typeof quarterDisplay === "string" ? quarterDisplay : null,
    ),
    flags,
    amounts: {
      taxable19: pair(fields, "Lieferungen/Leistungen zu 19%"),
      taxable7: pair(fields, "Lieferungen/Leistungen zu 7%"),
      taxableZero: amount(firstValue(fields, "Lieferungen/Leistungen zu 0%", "Edit")),
      otherRates: pair(fields, "Umsätze zu anderen Steuersätzen"),
      taxableTotal: pair(fields, "Steuerpflichtige Umsätze"),
      otherSales: amount(firstValue(fields, "Weitere Umsätze", "Edit")),
      reverseCharge: amount(firstValue(fields, "Steuerschuldner nach § 13b UStG", "Edit")),
      inputTax: amount(firstValue(fields, "Vorsteuer", "Edit")),
      inputTaxAdjustment: amount(firstValue(fields, "Vorsteuerberichtigung nach § 15a UStG", "Edit")),
      unauthorizedTax: amount(firstValue(fields, "unberechtigt ausgewiesene Steuerbeträge", "Edit")),
      specialAdvancePayment: amount(firstValue(fields, "Anrechnung Sondervorauszahlung", "Edit")),
      settlement: settlementPayment !== undefined
        ? { kind: "payment", ...amount(settlementPayment) }
        : settlementRefund !== undefined
          ? { kind: "refund", ...amount(settlementRefund) }
          : { kind: "unknown", ...amount(null) },
      reductionTaxableBase: amount(firstValue(fields, "Minderung der Bemessungsgrundlage", "Edit")),
      reductionInputTax: amount(firstValue(fields, "Minderung der abziehbaren Vorsteuer", "Edit")),
    },
    sections: Object.keys(USTVA_SECTIONS),
    blocked: page.blockiert === true,
    messages: Array.isArray(page.prueferMeldungen) ? page.prueferMeldungen : [],
    transmission: {
      blockedByApi: true,
      uiGuardObserved: elster ? elster.gesperrt === true : null,
      existingSubmissionStatus: "not-read",
    },
    effects: { savePerformed: false, submissionPerformed: false },
    note: "Read-only snapshot. Diese Operation speichert und uebermittelt nichts.",
  };
}

export function normalizeUstvaCurrentPage(page: WorkerResult): WorkerResult {
  const blocked = blockedPage(page);
  if (blocked) return blocked;
  if (parseUstvaPageHeading(page.ueberschrift)) return normalizeUstvaPage(page);

  const fields = Array.isArray(page.felder) ? page.felder as PageField[] : [];
  if (page.ueberschrift === USTVA_REVERSE_CHARGE_PAGE) {
    return {
      ok: true,
      pageKind: "reverse_charge",
      page: USTVA_REVERSE_CHARGE_PAGE,
      amounts: {
        euServices: detailPair(fields, "Sonst. Leistungen ausländ. Unternehmer EU"),
        foreignWorkSupplies: detailPair(fields, "Werklieferungen ausländ. Unternehmer"),
        foreignServices: detailPair(fields, "Sonst. Leistungen ausländ. Unternehmer"),
        total: detailPair(fields, "Umsatzsteuer als Leistungsempfänger nach § 13b UStG"),
      },
      effects: { savePerformed: false, submissionPerformed: false },
      note: "Read-only §13b-Snapshot. Diese Operation speichert und uebermittelt nichts.",
    };
  }
  if (page.ueberschrift === USTVA_INPUT_TAX_PAGE) {
    return {
      ok: true,
      pageKind: "input_tax",
      page: USTVA_INPUT_TAX_PAGE,
      amounts: {
        invoices: amount(firstValue(fields, "Vorsteuer aus Rechnungen von anderen Unternehmern", "Edit")),
        reverseCharge: amount(firstValue(fields, "Vorsteuer als Steuerschuldner nach § 13b UStG", "Edit")),
        intraCommunityAcquisitions: amount(firstValue(fields, "Vorsteuer aus innergemeinschaftlichen Erwerben", "Edit")),
        import: amount(firstValue(fields, "Entrichtete Einfuhrumsatzsteuer", "Edit")),
        intraCommunityTriangular: amount(firstValue(fields, "Vorsteuer aus innergemeinschaftl. Dreiecksgeschäften", "Edit")),
        total: amount(firstValue(fields, "Summe der abziehbaren Vorsteuerbeträge", "Edit")),
      },
      effects: { savePerformed: false, submissionPerformed: false },
      note: "Read-only Vorsteuer-Snapshot. Diese Operation speichert und uebermittelt nichts.",
    };
  }
  return {
    ok: false,
    kind: "ustva-page",
    error: `UStVA-Lesung braucht die Übersicht oder einen bekannten Detailbereich; aktuell ist '${String(page.ueberschrift ?? "")}' offen.`,
  };
}
