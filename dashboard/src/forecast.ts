import { bisector, quantileSorted } from "d3-array";
import { startOfDay } from "date-fns";

const DAY_MS = 86_400_000;
const LN2 = Math.LN2;

/** Reliability threshold — gaps larger than this are excluded from the bootstrap pool. */
export const MAX_RELIABLE_GAP_DAYS = 14;
/** Half-life for recency weighting of historical days. */
export const RECENCY_HALFLIFE_DAYS = 30;
/** Centered window used by `rollingMean`. */
export const SMOOTH_WINDOW_DAYS = 7;
/** Number of Monte Carlo paths simulated per player. */
export const SIM_RUNS = 400;
/** Maximum forecast horizon, regardless of selected range. */
export const MAX_HORIZON_DAYS = 365;

export interface RawSample {
  /** Snapshot timestamp in ms. */
  t: number;
  /** Y value (xp or level). May be undefined when the snapshot lacks data. */
  y: number | undefined;
}

export interface DailyBucket {
  /** Start-of-UTC-day in ms. */
  dayMs: number;
  /** End-of-day y value (max y observed that day). */
  y: number;
}

export interface ClassifiedDay extends DailyBucket {
  gainSinceLast: number;
  gapDays: number;
  /** Was the previous bucket close enough in time to trust the gain? */
  reliable: boolean;
}

export interface InterpolatedDay {
  dayMs: number;
  y: number;
  /** False for synthetic days inside an unreliable gap. */
  reliable: boolean;
  /** True when this row corresponds to an actual observation (not interpolation). */
  observed: boolean;
}

export interface ForecastResult {
  /** Daily-resolved historical points (interpolated where needed). */
  history: InterpolatedDay[];
  /** Centered rolling-mean trendline aligned to `history`. */
  smooth: Array<{ dayMs: number; y: number }>;
  /** Raw observed daily buckets for scatter rendering. */
  observed: DailyBucket[];
  /** Per-future-day P10/P50/P90, starting at `lastDayMs + 1 day`. */
  forecast: Array<{ dayMs: number; p10: number; p50: number; p90: number }>;
  /** y value at the player's last observed day (anchor for the forecast). */
  lastY: number;
  /** Last observed day in ms. */
  lastDayMs: number;
}

/** Group raw samples into UTC-day buckets, taking the maximum y per day. */
export function bucketDaily(samples: RawSample[]): DailyBucket[] {
  const byDay = new Map<number, number>();
  for (const s of samples) {
    if (s.y === undefined) continue;
    const dayMs = startOfDay(new Date(s.t)).getTime();
    const prev = byDay.get(dayMs);
    if (prev === undefined || s.y > prev) byDay.set(dayMs, s.y);
  }
  return [...byDay.entries()]
    .map(([dayMs, y]) => ({ dayMs, y }))
    .sort((a, b) => a.dayMs - b.dayMs);
}

/** Annotate each daily bucket with its gain and reliability flag. */
export function classifyGaps(
  daily: DailyBucket[],
  maxGapDays = MAX_RELIABLE_GAP_DAYS,
): ClassifiedDay[] {
  const out: ClassifiedDay[] = [];
  for (let i = 0; i < daily.length; i++) {
    const cur = daily[i];
    if (i === 0) {
      out.push({ ...cur, gainSinceLast: 0, gapDays: 0, reliable: false });
      continue;
    }
    const prev = daily[i - 1];
    const gapDays = Math.max(1, Math.round((cur.dayMs - prev.dayMs) / DAY_MS));
    const gain = Math.max(0, cur.y - prev.y);
    out.push({
      ...cur,
      gainSinceLast: gain,
      gapDays,
      reliable: gapDays <= maxGapDays,
    });
  }
  return out;
}

/** Fill missing calendar days between observed buckets via linear distribution. */
export function interpolateDaily(classified: ClassifiedDay[]): InterpolatedDay[] {
  if (classified.length === 0) return [];
  const out: InterpolatedDay[] = [];
  const first = classified[0];
  out.push({ dayMs: first.dayMs, y: first.y, reliable: false, observed: true });
  for (let i = 1; i < classified.length; i++) {
    const prev = classified[i - 1];
    const cur = classified[i];
    const steps = Math.max(1, Math.round((cur.dayMs - prev.dayMs) / DAY_MS));
    for (let k = 1; k < steps; k++) {
      const frac = k / steps;
      out.push({
        dayMs: prev.dayMs + k * DAY_MS,
        y: prev.y + (cur.y - prev.y) * frac,
        reliable: cur.reliable,
        observed: false,
      });
    }
    out.push({ dayMs: cur.dayMs, y: cur.y, reliable: cur.reliable, observed: true });
  }
  return out;
}

/** Build the bootstrap pool of per-day rates from the classified history. */
export function buildPool(classified: ClassifiedDay[]): Array<{ dayMs: number; rate: number }> {
  const pool: Array<{ dayMs: number; rate: number }> = [];
  for (const c of classified) {
    if (!c.reliable || c.gapDays < 1) continue;
    pool.push({ dayMs: c.dayMs, rate: c.gainSinceLast / c.gapDays });
  }
  return pool;
}

/** Exponential recency weights anchored at `lastDayMs`. */
export function recencyWeights(
  pool: Array<{ dayMs: number }>,
  lastDayMs: number,
  halflifeDays = RECENCY_HALFLIFE_DAYS,
): number[] {
  const decay = LN2 / halflifeDays;
  return pool.map((p) => {
    const ageDays = Math.max(0, (lastDayMs - p.dayMs) / DAY_MS);
    return Math.exp(-decay * ageDays);
  });
}

/** Centered rolling mean over the daily-interpolated y values. */
export function rollingMean(
  history: InterpolatedDay[],
  windowDays = SMOOTH_WINDOW_DAYS,
): Array<{ dayMs: number; y: number }> {
  const out: Array<{ dayMs: number; y: number }> = [];
  const half = Math.floor(windowDays / 2);
  for (let i = 0; i < history.length; i++) {
    const lo = Math.max(0, i - half);
    const hi = Math.min(history.length - 1, i + half);
    let sum = 0;
    for (let k = lo; k <= hi; k++) sum += history[k].y;
    out.push({ dayMs: history[i].dayMs, y: sum / (hi - lo + 1) });
  }
  return out;
}

/** Tiny seeded PRNG (mulberry32) so forecasts look stable across re-renders. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Hash a string + numeric salt into a 32-bit unsigned int (FNV-1a-ish). */
export function seedFrom(rsn: string, salt: number): number {
  let h = 2166136261 ^ (salt | 0);
  for (let i = 0; i < rsn.length; i++) {
    h ^= rsn.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Run a bootstrapped Monte Carlo simulation. Returns one row per future day
 * (1..horizonDays after `lastDayMs`) with P10/P50/P90 of the simulated XP.
 * Returns null when there isn't enough material to bootstrap, the player is
 * already at cap, or the weights collapse to zero.
 */
export function simulate(
  pool: Array<{ rate: number }>,
  weights: number[],
  lastY: number,
  lastDayMs: number,
  horizonDays: number,
  cap: number,
  rng: () => number,
  runs = SIM_RUNS,
): Array<{ dayMs: number; p10: number; p50: number; p90: number }> | null {
  if (lastY >= cap) return null;
  if (pool.length < 3) return null;
  if (horizonDays < 1) return null;

  // Cumulative weights for O(log n) sampling.
  const cum: number[] = new Array(pool.length);
  let total = 0;
  for (let i = 0; i < pool.length; i++) {
    total += weights[i];
    cum[i] = total;
  }
  if (!(total > 0)) return null;

  const bisect = bisector<number, number>((d) => d).left;

  // paths[d][r] = simulated y at future day d+1 for run r.
  const paths: number[][] = new Array(horizonDays);
  for (let d = 0; d < horizonDays; d++) paths[d] = new Array(runs);

  for (let r = 0; r < runs; r++) {
    let y = lastY;
    for (let d = 0; d < horizonDays; d++) {
      const u = rng() * total;
      const idx = bisect(cum, u);
      y = Math.min(cap, y + pool[idx].rate);
      paths[d][r] = y;
    }
  }

  const out: Array<{ dayMs: number; p10: number; p50: number; p90: number }> = new Array(horizonDays);
  for (let d = 0; d < horizonDays; d++) {
    const sorted = paths[d].slice().sort((a, b) => a - b);
    out[d] = {
      dayMs: lastDayMs + (d + 1) * DAY_MS,
      p10: quantileSorted(sorted, 0.1) ?? sorted[0],
      p50: quantileSorted(sorted, 0.5) ?? sorted[0],
      p90: quantileSorted(sorted, 0.9) ?? sorted[sorted.length - 1],
    };
  }
  return out;
}

/**
 * Full per-player pipeline. Returns null when the player is already at cap
 * or the history is too sparse to forecast.
 */
export function buildForecast(
  rsn: string,
  samples: RawSample[],
  cap: number,
  horizonDays: number,
): ForecastResult | null {
  const daily = bucketDaily(samples);
  if (daily.length === 0) return null;
  const classified = classifyGaps(daily);
  const history = interpolateDaily(classified);
  const smooth = rollingMean(history);
  const observed = daily;
  const last = daily[daily.length - 1];

  if (last.y >= cap || horizonDays < 1) {
    return { history, smooth, observed, forecast: [], lastY: last.y, lastDayMs: last.dayMs };
  }

  const pool = buildPool(classified);
  const weights = recencyWeights(pool, last.dayMs);
  const rng = mulberry32(seedFrom(rsn, last.dayMs));
  const forecast = simulate(pool, weights, last.y, last.dayMs, horizonDays, cap, rng);
  return {
    history,
    smooth,
    observed,
    forecast: forecast ?? [],
    lastY: last.y,
    lastDayMs: last.dayMs,
  };
}
