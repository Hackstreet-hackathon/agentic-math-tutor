const words = (t: string) => t.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);

/**
 * True when the transcript is mostly the tutor's own recent speech picked up by the microphone
 * (speaker echo), so the tutor never answers itself.
 */
export function isEcho(transcript: string, tutorSaid: string[]): boolean {
  const heard = words(transcript);
  if (heard.length < 3 || tutorSaid.length === 0) return false;
  const spoken = new Set(tutorSaid.flatMap(words));
  const hits = heard.filter((w) => spoken.has(w)).length;
  return hits / heard.length >= 0.8;
}
