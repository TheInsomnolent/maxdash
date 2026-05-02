import { addDays, startOfDay } from "date-fns";
import type { PlayerFile } from "./store";

const DAY_MS = 86_400_000;

export interface DailyGain {
  /** Start-of-local-day in ms. */
  dayMs: number;
  /** Overall XP gained that day (sum of all skills, via index 0). */
  xp: number;
}

/**
 * Per-day overall XP gain for a player. We bucket snapshots by local day
 * (taking the max overall XP per day), then diff consecutive observed days.
 *
 * Days with no observation are emitted with xp = 0 so the heatmap has a
 * complete grid. Gaps larger than `maxAttribDays` are NOT spread backwards —
 * the gain is attributed entirely to the day of the later snapshot to avoid
 * inventing activity on days the player almost certainly wasn't online.
 */
export function dailyGains(
  pf: PlayerFile,
  fromMs: number,
  toMs: number,
  maxAttribDays = 2,
): DailyGain[] {
  // Bucket: max overall XP per local day.
  const byDay = new Map<number, number>();
  for (const s of pf.snapshots) {
    const t = Date.parse(s.t);
    const xp = s.s[0];
    if (xp < 0) continue;
    const d = startOfDay(new Date(t)).getTime();
    const prev = byDay.get(d);
    if (prev === undefined || xp > prev) byDay.set(d, xp);
  }
  const days = [...byDay.entries()].sort((a, b) => a[0] - b[0]);

  // Diff consecutive observed days into gain map.
  const gainByDay = new Map<number, number>();
  for (let i = 1; i < days.length; i++) {
    const [prevDay, prevXp] = days[i - 1];
    const [curDay, curXp] = days[i];
    const gain = Math.max(0, curXp - prevXp);
    if (gain === 0) continue;
    const gapDays = Math.max(1, Math.round((curDay - prevDay) / DAY_MS));
    if (gapDays <= maxAttribDays) {
      // Spread evenly across the gap inclusive of the later day.
      const per = gain / gapDays;
      for (let k = 0; k < gapDays; k++) {
        const d = startOfDay(addDays(new Date(prevDay), k + 1)).getTime();
        gainByDay.set(d, (gainByDay.get(d) ?? 0) + per);
      }
    } else {
      // Long gap: attribute to the later day only.
      gainByDay.set(curDay, (gainByDay.get(curDay) ?? 0) + gain);
    }
  }

  // Materialize the requested range. Use addDays (DST-safe) instead of fixed
  // DAY_MS arithmetic so day keys stay aligned to local midnight even when a
  // DST transition falls inside the range.
  const out: DailyGain[] = [];
  let cursor = startOfDay(new Date(fromMs));
  const endDay = startOfDay(new Date(toMs)).getTime();
  while (cursor.getTime() <= endDay) {
    const dayMs = cursor.getTime();
    out.push({ dayMs, xp: Math.round(gainByDay.get(dayMs) ?? 0) });
    cursor = addDays(cursor, 1);
  }
  return out;
}

export interface HourBucket {
  hour: number; // 0-23
  xp: number;
  intervals: number;
}

/**
 * Aggregate XP gain by local hour-of-day across all snapshot intervals where
 * overall XP grew. The XP is attributed to the *end* hour of the interval
 * (the hour at which we observed the new XP). Intervals longer than 6h are
 * dropped because we can't tell which hour the player was actually playing.
 */
export function hourOfDayDistribution(
  pfs: PlayerFile[],
  fromMs: number,
  toMs: number,
  maxIntervalHours = 6,
): HourBucket[] {
  const buckets: HourBucket[] = Array.from({ length: 24 }, (_, h) => ({
    hour: h, xp: 0, intervals: 0,
  }));
  for (const pf of pfs) {
    const snaps = pf.snapshots;
    for (let i = 1; i < snaps.length; i++) {
      const ta = Date.parse(snaps[i - 1].t);
      const tb = Date.parse(snaps[i].t);
      if (tb < fromMs || ta > toMs) continue;
      const a = snaps[i - 1].s[0];
      const b = snaps[i].s[0];
      if (a < 0 || b < 0 || b <= a) continue;
      const dh = (tb - ta) / 3600_000;
      if (dh > maxIntervalHours) continue;
      const hour = new Date(tb).getHours();
      buckets[hour].xp += b - a;
      buckets[hour].intervals += 1;
    }
  }
  return buckets;
}

export interface DowBucket {
  dow: number; // 0=Sun .. 6=Sat
  xp: number;
}

export function dayOfWeekDistribution(
  pfs: PlayerFile[],
  fromMs: number,
  toMs: number,
): DowBucket[] {
  const buckets: DowBucket[] = Array.from({ length: 7 }, (_, d) => ({ dow: d, xp: 0 }));
  for (const pf of pfs) {
    const days = dailyGains(pf, fromMs, toMs);
    for (const d of days) {
      if (d.xp <= 0) continue;
      buckets[new Date(d.dayMs).getDay()].xp += d.xp;
    }
  }
  return buckets;
}

/** Format a large XP value for compact labels. */
export function fmtXp(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return String(Math.round(n));
}
