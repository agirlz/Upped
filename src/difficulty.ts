// Fair-enough difficulty: rough buckets instead of exact measurements.
// Score = distance points + target size points + 2 per extra rule.

import type { DistanceBucket, Post, TargetSize } from './types';

export const DISTANCES: Array<{ id: DistanceBucket; label: string; hint: string; pts: number; maxFt: number }> = [
  { id: 'reach', label: "Arm's reach", hint: 'under 3 ft', pts: 1, maxFt: 3 },
  { id: 'short', label: 'Short', hint: '3–7 ft · 1–2 steps', pts: 2, maxFt: 7 },
  { id: 'medium', label: 'Medium', hint: '7–13 ft · 3–5 steps', pts: 3, maxFt: 13 },
  { id: 'long', label: 'Long', hint: '13–20 ft', pts: 4, maxFt: 20 },
  { id: 'deep', label: 'Deep', hint: '20+ ft', pts: 5, maxFt: Infinity },
];

export const TARGETS: Array<{ id: TargetSize; label: string; hint: string; pts: number }> = [
  { id: 'small', label: 'Small', hint: 'cup, mug, can', pts: 3 },
  { id: 'medium', label: 'Medium', hint: 'trash can, box, bucket', pts: 2 },
  { id: 'big', label: 'Big', hint: 'laundry basket, hoop', pts: 1 },
];

export const RULE_PTS = 2;

export function bucketForFeet(ft: number): DistanceBucket {
  return (DISTANCES.find((d) => ft < d.maxFt) ?? DISTANCES[DISTANCES.length - 1]).id;
}

export const distanceInfo = (b?: DistanceBucket) => DISTANCES.find((d) => d.id === b);
export const targetInfo = (t?: TargetSize) => TARGETS.find((x) => x.id === t);

/** Difficulty score, or undefined for clips posted before tagging existed. */
export function difficulty(p: Pick<Post, 'distance' | 'targetSize' | 'rules'>): number | undefined {
  const d = distanceInfo(p.distance);
  const t = targetInfo(p.targetSize);
  if (!d || !t) return undefined;
  return d.pts + t.pts + p.rules.length * RULE_PTS;
}

export function distanceLabel(p: Pick<Post, 'distance' | 'distanceFt' | 'measured'>): string | undefined {
  if (p.measured && p.distanceFt !== undefined) return `${p.distanceFt.toFixed(1)} ft measured`;
  return distanceInfo(p.distance)?.label;
}
