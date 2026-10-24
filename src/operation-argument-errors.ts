import { z } from "zod";

/** Argumentnamen über alle Union-Zweige, ohne den Operationskatalog zu laden. */
function acceptedArgumentKeys(schema: unknown, keys = new Set<string>()): Set<string> {
  const def = (schema as { _def?: Record<string, unknown> } | undefined)?._def;
  if (!def) return keys;
  if (def.type === "object") {
    for (const key of Object.keys((schema as z.ZodObject).shape)) keys.add(key);
  } else if (def.type === "union") {
    for (const option of def.options as unknown[]) acceptedArgumentKeys(option, keys);
  } else if (def.type === "pipe") {
    acceptedArgumentKeys(def.in, keys);
  } else if (def.type === "intersection") {
    acceptedArgumentKeys(def.left, keys);
    acceptedArgumentKeys(def.right, keys);
  }
  return keys;
}

function hasUnrecognizedKey(issues: readonly z.ZodIssue[]): boolean {
  return issues.some((issue) =>
    issue.code === z.ZodIssueCode.unrecognized_keys ||
    (issue.code === z.ZodIssueCode.invalid_union && issue.errors.some((nested) => hasUnrecognizedKey(nested))));
}

/** Fehlermeldungen behalten Feldpfade und bevorzugen fachliche Union-Fehler. */
export function formatSchemaArgumentError(error: z.ZodError, schema?: z.ZodType): string {
  const containsCustomIssue = (issues: z.ZodIssue[]): boolean => issues.some((issue) =>
    issue.code === z.ZodIssueCode.custom ||
    (issue.code === z.ZodIssueCode.invalid_union && issue.errors.some((nested) => containsCustomIssue(nested))));
  const formatIssue = (issue: z.ZodIssue, parentPath: PropertyKey[] = []): string[] => {
    const issuePath = [...parentPath, ...issue.path];
    if (issue.code === "invalid_key" || issue.code === "invalid_element") {
      return issue.issues.flatMap((child) => formatIssue(child, issuePath));
    }
    if (issue.code === z.ZodIssueCode.invalid_union) {
      const candidates = issue.errors.map((issues) => ({
        custom: containsCustomIssue(issues),
        messages: issues.flatMap((child) => formatIssue(child, issuePath)),
      }));
      const preferred = candidates.some((candidate) => candidate.custom)
        ? candidates.filter((candidate) => candidate.custom)
        : candidates;
      const alternatives = preferred
        .map((candidate) => candidate.messages)
        .sort((left, right) => left.length - right.length || left.join("; ").length - right.join("; ").length);
      return alternatives[0] ?? [issue.message];
    }
    const path = issuePath.length ? `'${issuePath.map(String).join(".")}' ` : "";
    return [`${path}${issue.message}`];
  };
  const message = [...new Set(error.issues.flatMap((issue) => formatIssue(issue)))].join("; ");
  if (!schema || !hasUnrecognizedKey(error.issues)) return message;
  const allowed = [...acceptedArgumentKeys(schema)].sort();
  return allowed.length ? `${message.replace(/\.$/u, "")}. Erlaubt sind: ${allowed.join(", ")}` : message;
}
