import { colors } from './theme';

export type TidePoint = { time: string; height: number };

function toMin(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/**
 * Interpolate tide height (meters) at a given HH:MM from a sorted list of
 * tide points using cosine interpolation between consecutive extremes
 * (more realistic than linear for tides).
 */
export function tideHeightAt(points: TidePoint[], hhmm: string): number | null {
  if (!points || points.length === 0 || !hhmm) return null;
  const sorted = [...points].sort((a, b) => toMin(a.time) - toMin(b.time));
  const t = toMin(hhmm);
  if (t <= toMin(sorted[0].time)) return sorted[0].height;
  if (t >= toMin(sorted[sorted.length - 1].time)) return sorted[sorted.length - 1].height;
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    const ta = toMin(a.time);
    const tb = toMin(b.time);
    if (t >= ta && t <= tb) {
      if (tb === ta) return a.height;
      const frac = (t - ta) / (tb - ta);
      // cosine interpolation for smooth tidal curve
      const smooth = (1 - Math.cos(frac * Math.PI)) / 2;
      return a.height + (b.height - a.height) * smooth;
    }
  }
  return null;
}

export type TideLevel = 'low' | 'mid' | 'high' | 'none';

export function tideLevel(height: number | null): TideLevel {
  if (height == null) return 'none';
  if (height < 0.5) return 'low';
  if (height <= 0.8) return 'mid';
  return 'high';
}

export function tideColor(height: number | null): { bg: string; fg: string } {
  const lvl = tideLevel(height);
  switch (lvl) {
    case 'low':
      return { bg: '#FEE2E2', fg: colors.error };
    case 'mid':
      return { bg: '#FEF3C7', fg: '#92400E' };
    case 'high':
      return { bg: '#DCFCE7', fg: colors.success };
    default:
      return { bg: colors.surfaceSecondary, fg: colors.onSurfaceTertiary };
  }
}

export function formatTide(height: number | null): string {
  if (height == null) return '—';
  return `${height.toFixed(2).replace('.', ',')} m`;
}

/**
 * Safe minimum tide (meters) for a boat given its length in feet.
 * <=20ft: no alert; (20,28]: 0.5; (28,34]: 0.8; >34: 1.0
 */
export function tideThresholdForLength(length?: number | null): number | null {
  if (length == null) return null;
  if (length <= 20) return null;
  if (length <= 28) return 0.5;
  if (length <= 34) return 0.8;
  return 1.0;
}

export function isTideUnsafe(height: number | null, length?: number | null): boolean {
  const threshold = tideThresholdForLength(length);
  if (threshold == null || height == null) return false;
  return height < threshold;
}

/** Half-hour slots for a booking type within its allowed range. */
export function slotsForType(type: 'descida' | 'subida'): string[] {
  const start = 8 * 60 + 30;
  const end = type === 'descida' ? 17 * 60 : 17 * 60 + 30;
  const out: string[] = [];
  for (let m = start; m <= end; m += 30) {
    out.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
  }
  return out;
}

/**
 * Find the next half-hour time (>= fromTime) where the tide is at/above the
 * safe threshold for the boat length. Returns HH:MM or null.
 */
export function nextSafeTime(
  points: TidePoint[],
  type: 'descida' | 'subida',
  fromTime: string,
  length?: number | null
): string | null {
  const threshold = tideThresholdForLength(length);
  if (threshold == null) return null;
  const slots = slotsForType(type);
  const toMin = (s: string) => Number(s.split(':')[0]) * 60 + Number(s.split(':')[1]);
  const fromMin = toMin(fromTime);
  for (const s of slots) {
    if (toMin(s) <= fromMin) continue;
    const h = tideHeightAt(points, s);
    if (h != null && h >= threshold) return s;
  }
  return null;
}
