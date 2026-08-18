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
