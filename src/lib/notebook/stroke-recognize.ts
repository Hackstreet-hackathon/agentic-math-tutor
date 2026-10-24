/**
 * DTW-based stroke recognition engine.
 * Runs entirely in the browser — no server dependency.
 */
import type { InkObject } from "./schemas";
import { SYMBOL_LIBRARY, type SymbolDef } from "./stroke-library";

export interface RecognizeResult {
  /** Best-guess LaTeX for the entire selection */
  latex: string;
  /** Human-readable string */
  chars: string;
  /** 0-1 confidence (higher is better) */
  confidence: number;
}

/** Number of resampled points per stroke used for DTW comparison. */
const DTW_N = 16;

/**
 * Normalize a flat [x0,y0,...] stroke so its bounding box fits [0,1]×[0,1].
 * Degenerate cases (zero width or height) are handled gracefully.
 */
export function normalizeStroke(pts: number[]): number[] {
  if (pts.length < 2) return pts;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < pts.length; i += 2) {
    const x = pts[i]!;
    const y = pts[i + 1]!;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const rx = maxX - minX;
  const ry = maxY - minY;
  const out: number[] = [];
  for (let i = 0; i < pts.length; i += 2) {
    out.push(rx === 0 ? 0.5 : (pts[i]! - minX) / rx);
    out.push(ry === 0 ? 0.5 : (pts[i + 1]! - minY) / ry);
  }
  return out;
}

/**
 * Resample a flat [x0,y0,...] stroke to exactly n points using linear interpolation.
 */
function resampleStroke(pts: number[], n: number): number[] {
  if (pts.length < 4) {
    // Pad with repeated last point if too short
    const result: number[] = [...pts];
    while (result.length < n * 2) result.push(pts[pts.length - 2]!, pts[pts.length - 1]!);
    return result.slice(0, n * 2);
  }

  // Compute cumulative arc lengths
  const lengths: number[] = [0];
  for (let i = 2; i < pts.length; i += 2) {
    const dx = pts[i]! - pts[i - 2]!;
    const dy = pts[i + 1]! - pts[i - 1]!;
    lengths.push(lengths[lengths.length - 1]! + Math.sqrt(dx * dx + dy * dy));
  }
  const total = lengths[lengths.length - 1]!;
  if (total === 0) {
    // All points are the same
    const x = pts[0]!;
    const y = pts[1]!;
    const result: number[] = [];
    for (let i = 0; i < n; i++) result.push(x, y);
    return result;
  }

  const result: number[] = [];
  for (let i = 0; i < n; i++) {
    const target = (i / (n - 1)) * total;
    // Find which segment this target falls in
    let seg = 0;
    for (let j = 1; j < lengths.length; j++) {
      if (lengths[j]! >= target) {
        seg = j - 1;
        break;
      }
      seg = j - 1;
    }
    const segLen = lengths[seg + 1]! - lengths[seg]!;
    const t = segLen === 0 ? 0 : (target - lengths[seg]!) / segLen;
    const x0 = pts[seg * 2]!;
    const y0 = pts[seg * 2 + 1]!;
    const x1 = pts[(seg + 1) * 2]!;
    const y1 = pts[(seg + 1) * 2 + 1]!;
    result.push(x0 + t * (x1 - x0), y0 + t * (y1 - y0));
  }
  return result;
}

/**
 * Classic O(n²) DTW distance between two equal-length flat stroke arrays.
 */
function dtwDist(a: number[], b: number[]): number {
  const n = a.length / 2;
  // Use flat array for DTW matrix
  const dtw = new Float32Array(n * n);
  const INF = 1e9;

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const dx = a[i * 2]! - b[j * 2]!;
      const dy = a[i * 2 + 1]! - b[j * 2 + 1]!;
      const cost = Math.sqrt(dx * dx + dy * dy);

      let prev: number;
      if (i === 0 && j === 0) {
        prev = 0;
      } else if (i === 0) {
        prev = dtw[j - 1]!;
      } else if (j === 0) {
        prev = dtw[(i - 1) * n]!;
      } else {
        prev = Math.min(dtw[(i - 1) * n + j]!, dtw[i * n + j - 1]!, dtw[(i - 1) * n + j - 1]!);
      }
      dtw[i * n + j] = (prev >= INF ? INF : prev) + cost;
    }
  }
  return dtw[n * n - 1]! / n;
}

/**
 * Match one set of stroke segments (all strokes forming one character) against the library.
 * Returns the best match or null if no suitable match found.
 */
function matchCharacter(strokes: InkObject[]): { def: SymbolDef; score: number } | null {
  // Prepare input strokes: normalize + resample
  const inputStrokes = strokes.map((ink) => {
    const norm = normalizeStroke(ink.data.points);
    return resampleStroke(norm, DTW_N);
  });
  const strokeCount = inputStrokes.length;

  let bestDef: SymbolDef | null = null;
  let bestScore = Infinity;

  for (const def of SYMBOL_LIBRARY) {
    if (def.strokes.length !== strokeCount) continue;

    // Try matching input strokes to template strokes (same order)
    let totalDist = 0;
    for (let i = 0; i < strokeCount; i++) {
      const templateNorm = normalizeStroke(def.strokes[i]!);
      const templateResampled = resampleStroke(templateNorm, DTW_N);
      totalDist += dtwDist(inputStrokes[i]!, templateResampled);
    }
    const avgScore = totalDist / strokeCount;

    if (avgScore < bestScore) {
      bestScore = avgScore;
      bestDef = def;
    }
  }

  if (!bestDef) return null;
  return { def: bestDef, score: bestScore };
}

/**
 * Segment ink objects into character groups by x-position, then recognize each group.
 * Groups are formed by sorting by x and merging overlapping bounding boxes.
 * Returns full recognized LaTeX string or null if confidence is too low.
 */
export function recognizeStrokes(inks: InkObject[]): RecognizeResult | null {
  if (inks.length === 0) return null;

  // Sort by x position
  const sorted = [...inks].sort((a, b) => a.x - b.x);

  // Group strokes into character groups by proximity
  const groups: InkObject[][] = [];
  let currentGroup: InkObject[] = [sorted[0]!];

  for (let i = 1; i < sorted.length; i++) {
    const ink = sorted[i]!;
    const prev = currentGroup[currentGroup.length - 1]!;
    const maxWidth = Math.max(...currentGroup.map((o) => o.width), ink.width);
    const gap = ink.x - (prev.x + prev.width);

    if (gap < maxWidth * 0.5) {
      currentGroup.push(ink);
    } else {
      groups.push(currentGroup);
      currentGroup = [ink];
    }
  }
  groups.push(currentGroup);

  // Recognize each group
  const CONFIDENCE_THRESHOLD = 0.25;
  let totalScore = 0;
  let recognized = 0;
  const latexParts: string[] = [];
  const charParts: string[] = [];

  for (const group of groups) {
    const match = matchCharacter(group);
    if (!match || match.score > CONFIDENCE_THRESHOLD) {
      // Unknown character — skip or use placeholder
      latexParts.push("?");
      charParts.push("?");
    } else {
      latexParts.push(match.def.latex);
      charParts.push(match.def.char);
      totalScore += match.score;
      recognized++;
    }
  }

  if (recognized === 0) return null;

  const avgConfidence = 1 - totalScore / recognized / CONFIDENCE_THRESHOLD;
  const clampedConfidence = Math.max(0, Math.min(1, avgConfidence));

  return {
    latex: latexParts.join(""),
    chars: charParts.join(""),
    confidence: clampedConfidence,
  };
}
