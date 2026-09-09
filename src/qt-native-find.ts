import type { WorkerResult } from "./api-contract.js";
import { QtNativeTransportError, type QtNativeClient } from "./qt-native-client.js";
import { readQtNativeSnapshot } from "./qt-native-snapshot.js";

type Token = "*" | ((character: string) => boolean);
const invalid = () => new QtNativeTransportError("Invalid PowerShell wildcard expression.", "bad-args");

/** PowerShell string wildcards: stars, one UTF-16 character, bracket sets/ranges and backtick escapes.
 * A bounded state machine avoids regular-expression backtracking for caller-supplied selectors. */
export function nativeWildcard(pattern: string): (text: string) => boolean {
  const tokens: Token[] = [];
  const literal = (value: string) => tokens.push(character => character.toLowerCase() === value.toLowerCase());
  for (let index = 0; index < pattern.length; ++index) {
    const character = pattern[index]!;
    if (character === "`") {
      if (index + 1 < pattern.length) literal(pattern[++index]!);
      else if (pattern.length > 1) literal("`");
    } else if (character === "*") {
      if (tokens.at(-1) !== "*") tokens.push("*");
    } else if (character === "?") tokens.push(() => true);
    else if (character === "[") {
      const contents: { value: string; dash: boolean }[] = [];
      let closed = false, first = true;
      while (++index < pattern.length) {
        let value = pattern[index]!, escaped = false;
        if (value === "]" && !first) { closed = true; break; }
        if (value === "`") {
          first = false;
          if (++index >= pattern.length) break;
          value = pattern[index]!; escaped = true;
        }
        contents.push({ value, dash: value === "-" && !escaped }); first = false;
      }
      if (!closed) throw invalid();
      const matchers: ((value: string) => boolean)[] = [];
      for (let part = 0; part < contents.length; ++part) {
        const lower = contents[part]!.value;
        if (part + 2 < contents.length && contents[part + 1]!.dash) {
          const upper = contents[part + 2]!.value; part += 2;
          if (lower > upper) throw invalid();
          // Character classes alone are bounded to a single UTF-16 code unit.
          const hex = (value: string) => `\\u${value.charCodeAt(0).toString(16).padStart(4, "0")}`;
          const range = new RegExp(`[${hex(lower)}-${hex(upper)}]`, "i");
          matchers.push(value => range.test(value));
        } else matchers.push(value => value.toLowerCase() === lower.toLowerCase());
      }
      tokens.push(value => matchers.some(match => match(value)));
    } else literal(character);
  }
  let budget = 10_000_000;
  return text => {
    let current = new Uint8Array(tokens.length + 1); current[0] = 1;
    const closure = (states: Uint8Array) => {
      for (let index = 0; index < tokens.length; ++index) if (states[index] && tokens[index] === "*") states[index + 1] = 1;
    };
    closure(current);
    for (let offset = 0; offset < text.length; ++offset) {
      budget -= tokens.length;
      if (budget < 0) throw new QtNativeTransportError("Wildcard evaluation exceeds the bounded selector budget.", "native-selector-limit");
      const next = new Uint8Array(tokens.length + 1);
      for (let index = 0; index < tokens.length; ++index) {
        if (!current[index]) continue;
        const token = tokens[index]!;
        if (token === "*") next[index] = 1;
        else if (token(text[offset]!)) next[index + 1] = 1;
      }
      closure(next); current = next;
    }
    return current[tokens.length] === 1;
  };
}

export async function executeQtNativeFind(
  client: QtNativeClient, args: Readonly<Record<string, unknown>>, timeoutMs: number, signal?: AbortSignal,
): Promise<WorkerResult> {
  const name = typeof args.name === "string" ? args.name : "", aid = typeof args.aid === "string" ? args.aid : "";
  const type = typeof args.type === "string" ? args.type : "";
  if ((!name && !aid && !type) || (args.contains && !name)) throw new QtNativeTransportError("find requires name, aid or type; contains requires name.", "bad-args");
  const nameMatch = args.contains ? nativeWildcard(`*${name}*`) : undefined;
  const aidMatch = nativeWildcard(`*${aid}`);
  const equalitySelectors = { ...(name && !args.contains ? { name } : {}), ...(aid ? { aid } : {}), ...(type ? { type } : {}) };
  const result = await readQtNativeSnapshot(client, { ...args, withValues: false, equalitySelectors }, timeoutMs, signal);
  const exactName = new Set(result.exactMatches.name), exactAid = new Set(result.exactMatches.aid), exactType = new Set(result.exactMatches.type);
  const hits = result.nodes.filter(node => (!name || (nameMatch ? nameMatch(node.name) : exactName.has(node.i)))
    && (!aid || exactAid.has(node.i) || aidMatch(node.aid)) && (!type || exactType.has(node.i)));
  return { ok: true, backend: "qt", count: hits.length, hits, stats: result.stats, incomplete: result.stats.truncated,
    note: result.stats.truncated ? 'ACHTUNG: Der Baumlauf wurde abgeschnitten. "Nicht gefunden" ist hier KEIN Beweis fuer Abwesenheit.' : null,
    nativeDurationMs: result.nativeDurationMs };
}
