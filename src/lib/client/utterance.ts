/** Words a finished sentence does not end on; if a transcript ends with one, the student is probably mid-thought. */
const DANGLING = new Set([
  "i", "a", "an", "the", "to", "of", "and", "or", "but", "so", "if", "is", "are", "was", "do", "does", "did", "can", "could", "would", "should", "will",
  "my", "your", "our", "with", "for", "in", "on", "at", "by", "from", "as", "than", "then", "because", "what", "how", "why",
  "when", "where", "which", "who", "um", "uh", "about", "into", "its", "it's", "i'm", "i'd", "i'll", "i've", "not",
]);

/** True when the transcript trails off on a function word ("How do I", "What is the derivative of"). */
export function looksUnfinished(transcript: string): boolean {
  const t = transcript.trim().toLowerCase().replace(/[.?!,;:…\s]+$/g, "");
  if (!t) return false;
  const words = t.split(/\s+/).map((w) => w.replace(/^[^a-z']+|[^a-z']+$/g, ""));
  const last = words[words.length - 1] ?? "";
  // "can you" is cut off, "thank you" is not.
  if (last === "you") return ["can", "could", "would", "will", "do", "did", "are", "how", "what", "why", "where", "when", "and", "if"].includes(words[words.length - 2] ?? "");
  return DANGLING.has(last);
}
