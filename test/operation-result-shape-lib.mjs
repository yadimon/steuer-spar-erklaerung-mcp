export const RESULT_TYPE_TAGS = Object.freeze([
  "array-empty",
  "array-many:array",
  "array-many:boolean",
  "array-many:mixed",
  "array-many:negative-number",
  "array-many:nonnegative-number",
  "array-many:null",
  "array-many:object",
  "array-many:string-empty",
  "array-many:string-hex64",
  "array-many:string-other",
  "array-many:string-unknown",
  "array-one:array",
  "array-one:boolean",
  "array-one:negative-number",
  "array-one:nonnegative-number",
  "array-one:null",
  "array-one:object",
  "array-one:string-empty",
  "array-one:string-hex64",
  "array-one:string-other",
  "array-one:string-unknown",
  "boolean",
  "negative-number",
  "nonfinite-number",
  "nonnegative-number",
  "null",
  "object",
  "string-empty",
  "string-hex64",
  "string-other",
  "string-unknown",
  "unsupported",
]);

const RESULT_OBJECT_TAG_PREFIX = "object:";
const RESULT_OBJECT_FIELD_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,63}$/u;
const RESULT_OBJECT_MAX_FIELDS = 32;

const mergeSorted = (left = [], right = []) => [...new Set([...left, ...right])].sort();

export function mergeFieldEvidence(previous = {}, observed = {}) {
  return {
    types: mergeSorted(previous.types, observed.types),
    labels: mergeSorted(previous.labels, observed.labels),
    outcomes: mergeSorted(previous.outcomes, observed.outcomes),
  };
}

export function mergeScopeEvidence(previous = {}, observed = {}) {
  const fields = {};
  for (const field of [...new Set([
    ...Object.keys(previous.fields ?? {}),
    ...Object.keys(observed.fields ?? {}),
  ])].sort()) {
    fields[field] = mergeFieldEvidence(previous.fields?.[field], observed.fields?.[field]);
  }
  return {
    profiles: mergeSorted(previous.profiles, observed.profiles),
    fields,
  };
}

export function samplesForResultTypeTag(tag) {
  switch (tag) {
    case "array-empty": return [[]];
    case "boolean": return [true, false];
    case "negative-number": return [-1];
    case "nonnegative-number": return [0, 1];
    case "null": return [null];
    case "object": return [{}];
    case "string-empty": return [""];
    case "string-hex64": return ["A".repeat(64)];
    case "string-other": return ["synthetic"];
    case "string-unknown": return ["unknown"];
    default: break;
  }
  const object = parseResultObjectTag(tag);
  if (object) {
    const sample = {};
    for (const [field, fieldTag] of Object.entries(object)) {
      const values = samplesForResultTypeTag(fieldTag);
      if (values.length === 0) return [];
      sample[field] = values[0];
    }
    return [sample];
  }
  const array = /^array-(one|many):(.+)$/u.exec(tag);
  if (!array) return [];
  const one = sampleArrayElement(array[2]);
  if (one === undefined) return [];
  return [array[1] === "one" ? [one] : [one, sampleArrayElement(array[2], true)]];
}

export function isResultTypeTag(tag) {
  return RESULT_TYPE_TAGS.includes(tag) || parseResultObjectTag(tag) !== null;
}

export function resultObjectTypeTag(value) {
  const fields = Object.entries(value);
  if (fields.length > RESULT_OBJECT_MAX_FIELDS || fields.some(([field]) => !RESULT_OBJECT_FIELD_PATTERN.test(field))) {
    return "object";
  }
  return `${RESULT_OBJECT_TAG_PREFIX}${JSON.stringify(Object.fromEntries(
    fields
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([field, fieldValue]) => [field, nestedResultFieldTypeTag(fieldValue)]),
  ))}`;
}

export function resultTypeTag(value) {
  if (Array.isArray(value)) return resultArrayTypeTag(value);
  if (value && typeof value === "object") return resultObjectTypeTag(value);
  return atomicTypeTag(value);
}

function parseResultObjectTag(tag) {
  if (typeof tag !== "string" || !tag.startsWith(RESULT_OBJECT_TAG_PREFIX)) return null;
  try {
    const value = JSON.parse(tag.slice(RESULT_OBJECT_TAG_PREFIX.length));
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const fields = Object.entries(value);
    if (fields.length > RESULT_OBJECT_MAX_FIELDS) return null;
    if (fields.some(([field, fieldTag]) =>
      !RESULT_OBJECT_FIELD_PATTERN.test(field) || !RESULT_TYPE_TAGS.includes(fieldTag))) return null;
    return value;
  } catch {
    return null;
  }
}

function atomicTypeTag(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "nonfinite-number";
    return value < 0 ? "negative-number" : "nonnegative-number";
  }
  if (typeof value === "string") {
    if (value === "") return "string-empty";
    if (value === "unknown") return "string-unknown";
    if (/^[A-Fa-f0-9]{64}$/u.test(value)) return "string-hex64";
    return "string-other";
  }
  if (typeof value === "boolean") return "boolean";
  if (value && typeof value === "object") return "object";
  return "unsupported";
}

function nestedResultFieldTypeTag(value) {
  return Array.isArray(value) ? resultArrayTypeTag(value) : atomicTypeTag(value);
}

function resultArrayTypeTag(value) {
  if (value.length === 0) return "array-empty";
  const elementTags = [...new Set(value.map(atomicTypeTag))].sort();
  const cardinality = value.length === 1 ? "one" : "many";
  return `array-${cardinality}:${elementTags.length === 1 ? elementTags[0] : "mixed"}`;
}

function sampleArrayElement(tag, alternate = false) {
  switch (tag) {
    case "array": return [];
    case "boolean": return alternate ? false : true;
    case "mixed": return alternate ? { name: "synthetic" } : "synthetic";
    case "negative-number": return alternate ? -2 : -1;
    case "nonnegative-number": return alternate ? 1 : 0;
    case "null": return null;
    case "object": return { name: alternate ? "synthetic-2" : "synthetic" };
    case "string-empty": return "";
    case "string-hex64": return (alternate ? "B" : "A").repeat(64);
    case "string-other": return alternate ? "synthetic-2" : "synthetic";
    case "string-unknown": return "unknown";
    default: return undefined;
  }
}
