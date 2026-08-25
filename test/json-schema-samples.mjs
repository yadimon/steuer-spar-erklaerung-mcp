function stringSample(schema, property) {
  if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0];
  if (schema.const !== undefined) return schema.const;
  if (/sha256|hash/i.test(property) || /\{64\}/.test(schema.pattern ?? "")) return "0".repeat(64);
  if (/rowRid/i.test(property)) return "42.100.1.-2147481409";
  if (/desktop.*name/i.test(property)) return "SSEWrapperTest";
  if (/^\^results:/.test(schema.pattern ?? "")) return "results:fixture.json";
  if (/^\^workspace:/.test(schema.pattern ?? "")) return "workspace:fixture.json";
  if (/^\^backups:/.test(schema.pattern ?? "")) return "backups:fixture";
  if (/^\^cases:/.test(schema.pattern ?? "")) return "cases:fixture.Gew2025";
  if (/scenarioRef/i.test(property)) return "workspace:scenarios/fixture.json";
  if (/resultRef/i.test(property)) return "results:fixture.json";
  if (/destinationRef/i.test(property)) return "backups:fixture";
  if (/\(\?:results\|workspace\)/.test(schema.pattern ?? "")) return "results:fixture.json";
  if (/caseRef|sourceRef|targetRef/i.test(property)) return "cases:fixture.Gew2025";
  if (/resourceRef/i.test(property)) return "documents:fixture.txt";
  if (/ref/i.test(property)) {
    if (/\^cases:/.test(schema.pattern ?? "")) return "cases:fixture.Gew2025";
    return "workspace:fixture.txt";
  }
  if (/path|file|from|target|dest|dir/i.test(property)) return "fixture.Gew2025";
  return "x".repeat(Math.max(1, schema.minLength ?? 1));
}

export function sampleJsonSchema(schema, property = "value") {
  if (!schema || typeof schema !== "object") return null;
  if (schema.default !== undefined) return schema.default;
  if (schema.const !== undefined) return schema.const;
  if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0];
  const alternatives = schema.anyOf ?? schema.oneOf;
  if (Array.isArray(alternatives)) {
    const selected = alternatives.find((entry) => entry.type !== "null") ?? alternatives[0];
    return sampleJsonSchema(selected, property);
  }
  if (Array.isArray(schema.type)) {
    return sampleJsonSchema({ ...schema, type: schema.type.find((entry) => entry !== "null") ?? schema.type[0] }, property);
  }
  switch (schema.type) {
    case "object": {
      const result = {};
      for (const required of schema.required ?? []) {
        result[required] = sampleJsonSchema(schema.properties?.[required] ?? schema.additionalProperties ?? {}, required);
      }
      // JSON Schema cannot express every Zod superRefine contract. Keep the
      // synthetic happy path semantically valid for both MCP and direct API
      // catalog tests without weakening the production validator.
      if ([
        "click", "click_point", "find", "get_value", "toggle", "combo_options", "combo_select", "tracked_set_value",
        "sse_click", "sse_click_point", "sse_find", "sse_get_value", "sse_toggle", "sse_combo_options",
        "sse_combo_select", "sse_change_field",
      ].includes(property)) {
        result.name = "Synthetisches Testelement";
      }
      if (property === "sse_center_refresh" || property === "center_refresh") {
        result.expectedMode = "Zuletzt verwendet";
      }
      return result;
    }
    case "array": {
      const count = Math.max(0, schema.minItems ?? 0);
      return Array.from({ length: count }, () => sampleJsonSchema(schema.items ?? {}, property));
    }
    case "integer":
    case "number":
      if (typeof schema.minimum === "number") return schema.minimum;
      if (typeof schema.exclusiveMinimum === "number") return schema.exclusiveMinimum + 1;
      return 1;
    case "boolean":
      return true;
    case "string":
      return stringSample(schema, property);
    case "null":
      return null;
    default:
      if (schema.properties) return sampleJsonSchema({ ...schema, type: "object" }, property);
      return null;
  }
}

export function enumChoices(schema) {
  if (!schema || typeof schema !== "object") return [];
  if (Array.isArray(schema.enum)) return schema.enum;
  const alternatives = schema.anyOf ?? schema.oneOf ?? [];
  return [...new Set(alternatives.flatMap(enumChoices))];
}

function primitiveTypes(schema) {
  if (!schema || typeof schema !== "object") return new Set();
  const result = new Set(Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : []);
  for (const alternative of schema.anyOf ?? schema.oneOf ?? []) {
    for (const type of primitiveTypes(alternative)) result.add(type);
  }
  return result;
}

export function invalidTypeValue(schema) {
  const types = primitiveTypes(schema);
  const candidates = [
    ["null", null],
    ["boolean", false],
    ["number", 1.5],
    ["string", "__falscher_typ__"],
    ["array", []],
    ["object", {}],
  ];
  return candidates.find(([type]) => !types.has(type) && !(type === "number" && types.has("integer")))?.[1];
}

export function validBoundaryValues(schema) {
  if (!schema || typeof schema !== "object") return [];
  if (schema.const !== undefined || Array.isArray(schema.enum)) return [];
  const alternatives = schema.anyOf ?? schema.oneOf;
  if (Array.isArray(alternatives)) return [...new Set(alternatives.flatMap(validBoundaryValues))];
  if (schema.type === "boolean") return [false, true];
  if (schema.type !== "integer" && schema.type !== "number") return [];
  const values = [];
  if (typeof schema.minimum === "number") values.push(schema.minimum);
  if (typeof schema.maximum === "number") values.push(schema.maximum);
  if (typeof schema.exclusiveMinimum === "number") {
    values.push(schema.exclusiveMinimum + (schema.type === "integer" ? 1 : 0.5));
  }
  if (typeof schema.exclusiveMaximum === "number") {
    values.push(schema.exclusiveMaximum - (schema.type === "integer" ? 1 : 0.5));
  }
  return [...new Set(values)].filter(Number.isFinite);
}
