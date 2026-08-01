import { MAX_XP, TRAINABLE_SKILLS, xpToLevel } from "./skills";
import type { PlayerFile } from "./store";

/** AEST is UTC+10 all year round (Queensland — no daylight saving). */
export const AEST_OFFSET_MS = 10 * 3_600_000;
const DAY_MS = 86_400_000;

export type WeeklyMode = "xp" | "level";
export type WeekKey = "this" | "last";

export const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

/** UTC ms of the Monday 00:00 AEST that starts the week containing `ms`. */
export function startOfAestWeek(ms: number): number {
  const shifted = ms + AEST_OFFSET_MS;
  const dayStart = Math.floor(shifted / DAY_MS) * DAY_MS;
  const dow = new Date(shifted).getUTCDay(); // 0 = Sun … 6 = Sat
  const sinceMonday = (dow + 6) % 7;
  return dayStart - sinceMonday * DAY_MS - AEST_OFFSET_MS;
}

export interface Week {
  key: WeekKey;
  /** UTC ms of Monday 00:00 AEST. */
  startMs: number;
  /** UTC ms of the following Monday 00:00 AEST (exclusive end). */
  endMs: number;
  label: string;
}

/** The current AEST week and the one before it, most recent first. */
export function weekOptions(now: number = Date.now()): Week[] {
  const thisStart = startOfAestWeek(now);
  const lastStart = thisStart - 7 * DAY_MS;
  return [
    { key: "this", startMs: thisStart, endMs: thisStart + 7 * DAY_MS, label: "This week" },
    { key: "last", startMs: lastStart, endMs: lastStart + 7 * DAY_MS, label: "Last week" },
  ];
}

/** "3 Aug – 9 Aug" style range label for a week, rendered in AEST. */
export function weekRangeLabel(week: Week): string {
  const fmt = (ms: number) =>
    new Date(ms + AEST_OFFSET_MS).toLocaleDateString(undefined, {
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    });
  return `${fmt(week.startMs)} – ${fmt(week.endMs - DAY_MS)} AEST`;
}

export interface PlayerWeek {
  rsn: string;
  /** Per day (Mon…Sun): skill name ⇒ gain. Only non-zero skills are present. */
  days: Array<Record<string, number>>;
  /** Per day total gain. */
  dayTotals: number[];
  /**
   * Running total at the end of each day. `null` for days that lie entirely in
   * the future so the cumulative line stops at today.
   */
  cumulative: Array<number | null>;
  /** Total gain across the week. */
  total: number;
}

/**
 * Value of a skill for gain purposes: XP is clamped to the level-99 cap so
 * post-99 XP never counts towards the race; levels come straight from the
 * XP table (already capped at 99).
 */
function metric(xp: number, mode: WeeklyMode): number {
  if (xp < 0) return mode === "level" ? 1 : 0;
  return mode === "level" ? xpToLevel(xp) : Math.min(xp, MAX_XP);
}

/**
 * Per-day, per-skill gains for one player across a week (Mon → Sun AEST).
 *
 * Each day's gain is the difference between the last snapshot at or before the
 * day's end boundary and the last snapshot at or before its start boundary, so
 * snapshot gaps never invent or duplicate XP.
 */
export function playerWeek(
  pf: PlayerFile,
  week: Week,
  mode: WeeklyMode,
  now: number = Date.now(),
): PlayerWeek {
  const snaps = pf.snapshots;
  // Last snapshot at or before each of the 8 day boundaries.
  const boundaries: Array<number[] | null> = [];
  let i = 0;
  let last: number[] | null = null;
  for (let b = 0; b <= 7; b++) {
    const t = week.startMs + b * DAY_MS;
    while (i < snaps.length && Date.parse(snaps[i].t) <= t) {
      last = snaps[i].s;
      i++;
    }
    boundaries.push(last);
  }

  const days: Array<Record<string, number>> = [];
  const dayTotals: number[] = [];
  const cumulative: Array<number | null> = [];
  let running = 0;
  for (let d = 0; d < 7; d++) {
    const a = boundaries[d];
    const b = boundaries[d + 1];
    const breakdown: Record<string, number> = {};
    let total = 0;
    if (a && b) {
      for (let s = 1; s <= TRAINABLE_SKILLS.length; s++) {
        const gain = metric(b[s] ?? -1, mode) - metric(a[s] ?? -1, mode);
        if (gain <= 0) continue;
        breakdown[TRAINABLE_SKILLS[s - 1]] = gain;
        total += gain;
      }
    }
    days.push(breakdown);
    dayTotals.push(total);
    running += total;
    const dayStart = week.startMs + d * DAY_MS;
    cumulative.push(dayStart > now ? null : running);
  }
  return { rsn: pf.rsn, days, dayTotals, cumulative, total: running };
}

/** Chart row: one per day of the week. */
export interface WeeklyRow {
  label: string;
  dayMs: number;
  [key: string]: number | string | null;
}

/** Data key for a player's stacked skill column segment. */
export function barKey(rsn: string, skill: string): string {
  return `${rsn}\u0000${skill}`;
}

export interface WeeklyRace {
  /** Top 3 players by gain in the week, best first. */
  leaders: PlayerWeek[];
  rows: WeeklyRow[];
  /** Skills anyone gained in, in canonical order — used for the legend. */
  skills: string[];
  /** Y-axis max: first place's weekly total. */
  max: number;
}

/**
 * Build the weekly race dataset: the three MVPs for the week plus the chart
 * rows combining their cumulative totals and per-day skill breakdowns.
 */
export function weeklyRace(
  pfs: readonly PlayerFile[],
  week: Week,
  mode: WeeklyMode,
  now: number = Date.now(),
): WeeklyRace {
  const leaders = pfs
    .map((pf) => playerWeek(pf, week, mode, now))
    .filter((p) => p.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, 3);

  const used = new Set<string>();
  const rows: WeeklyRow[] = DAY_LABELS.map((label, d) => {
    const row: WeeklyRow = { label, dayMs: week.startMs + d * DAY_MS };
    for (const p of leaders) {
      row[p.rsn] = p.cumulative[d];
      for (const [skill, v] of Object.entries(p.days[d])) {
        row[barKey(p.rsn, skill)] = v;
        used.add(skill);
      }
    }
    return row;
  });

  return {
    leaders,
    rows,
    skills: TRAINABLE_SKILLS.filter((s) => used.has(s)),
    max: leaders[0]?.total ?? 0,
  };
}
