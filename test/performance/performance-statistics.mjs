function rounded(value) {
  const scaled = value * 1_000;
  return Number.isFinite(scaled) ? Math.round(scaled) / 1_000 : value;
}

/** Nearest-rank percentile: deterministic even for deliberately small samples. */
export function percentile(values, probability) {
  if (!Array.isArray(values)) throw new TypeError("percentile values must be an array");
  if (values.length === 0) return null;
  if (!(probability > 0 && probability <= 1)) {
    throw new RangeError("percentile probability must be in (0, 1].");
  }
  for (let index = 0; index < values.length; index += 1) {
    if (!Number.isFinite(values[index])) {
      throw new TypeError("percentile values must be finite numbers");
    }
  }
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(probability * sorted.length) - 1)];
}

export function summarizeDurations(values) {
  if (!Array.isArray(values)) throw new TypeError("duration samples must be an array");
  if (values.length === 0) {
    return {
      count: 0, min: null, max: null, mean: null,
      p50: null, p90: null, p95: null, p99: null,
    };
  }
  let mean = 0;
  let minimum = Number.POSITIVE_INFINITY;
  let maximum = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!Number.isFinite(value) || value < 0) {
      throw new TypeError("duration samples must be finite nonnegative numbers");
    }
    minimum = Math.min(minimum, value);
    maximum = Math.max(maximum, value);
    mean += (value - mean) / (index + 1);
  }
  return {
    count: values.length,
    min: rounded(minimum),
    max: rounded(maximum),
    mean: rounded(mean),
    p50: rounded(percentile(values, 0.50)),
    p90: rounded(percentile(values, 0.90)),
    p95: rounded(percentile(values, 0.95)),
    p99: rounded(percentile(values, 0.99)),
  };
}

export function summarizeOutcomes(records) {
  if (!Array.isArray(records)) throw new TypeError("outcome records must be an array");
  const kindCounts = new Map();
  let successCount = 0;
  let nonOkCount = 0;
  let threwCount = 0;
  for (const record of records) {
    if (record?.ok === true) successCount += 1;
    else nonOkCount += 1;
    if (record?.threw === true) threwCount += 1;
    if (typeof record?.kind === "string" && record.kind) {
      kindCounts.set(record.kind, (kindCounts.get(record.kind) ?? 0) + 1);
    }
  }
  return {
    ok: successCount,
    nonOk: nonOkCount,
    threw: threwCount,
    kinds: Object.fromEntries([...kindCounts].sort(([left], [right]) => left.localeCompare(right))),
  };
}
