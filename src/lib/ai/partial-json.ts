/**
 * Best-effort parse of a JSON document that is still being streamed. Closes open strings,
 * arrays and objects, and drops a dangling key / incomplete literal. Returns undefined when
 * nothing parseable exists yet. Never throws.
 */
export function parsePartialJson(src: string): unknown | undefined {
  let text = src.trimStart();
  if (!text) return undefined;

  for (let attempt = 0; attempt < 64; attempt++) {
    const { closers, inString, body } = scan(text);
    let candidate = body;
    if (inString) candidate += '"';
    try {
      return JSON.parse(candidate + closers);
    } catch {
      // Cut back to the last structural boundary (comma / open bracket) and retry.
      const cut = Math.max(text.lastIndexOf(","), text.lastIndexOf("{"), text.lastIndexOf("["));
      if (cut < 0) return undefined;
      const isOpen = text[cut] !== ",";
      text = text.slice(0, isOpen ? cut + 1 : cut);
      if (!text.trim()) return undefined;
    }
  }
  return undefined;
}

function scan(text: string): { closers: string; inString: boolean; body: string } {
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  for (const ch of text) {
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") stack.push("}");
    else if (ch === "[") stack.push("]");
    else if (ch === "}" || ch === "]") stack.pop();
  }
  let body = text;
  if (inString) {
    // Remove an incomplete escape sequence at the very end (a lone "\" or a short \uXXXX).
    body = body.replace(/\\u[0-9a-fA-F]{0,3}$/, "").replace(/(?<!\\)(\\\\)*\\$/, (m) => m.slice(0, -1));
  }
  return { closers: stack.reverse().join(""), inString, body };
}
