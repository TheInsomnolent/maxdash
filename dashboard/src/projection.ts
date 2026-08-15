import { MAX_XP, TRAINABLE_SKILL_COUNT } from "./skills";

const DAY_MS = 86_400_000;

/**
 * "Method projection" — what happens if a player grinds a chosen method at a
 * fixed XP rate, rather than continuing at their historical pace. Unlike the
 * bootstrapped forecast in `forecast.ts` this is deliberately deterministic:
 * a flat rate in, a straight line out.
 */
export interface MethodProjection {
  /** XP still needed to reach the target (99, or every skill at 99). */
  remainingXp: number;
  /** Hours of grinding left at the given rate. */
  hoursToMax: number;
  /** Calendar days left once the daily play time is applied (null if unset). */
  daysToMax: number | null;
  /** Effective XP per calendar day (0 when no daily play time was given). */
  xpPerDay: number;
  /** Estimated completion timestamp in ms (null when `daysToMax` is null). */
  etaMs: number | null;
}

/** XP left to 99 in a single skill. Unranked skills (xp < 0) count as 0 XP. */
export function remainingXpForSkill(xp: number): number {
  return Math.max(0, MAX_XP - Math.max(0, Math.min(xp, MAX_XP)));
}

/**
 * XP left for a whole account to max, from a hiscores snapshot row (index 0 is
 * Overall, indices 1..n are the trainable skills). XP past 99 doesn't count.
 */
export function remainingXpForOverall(snapshot: readonly number[]): number {
  let remaining = 0;
  for (let i = 1; i <= TRAINABLE_SKILL_COUNT; i++) {
    remaining += remainingXpForSkill(snapshot[i] ?? -1);
  }
  return remaining;
}

/**
 * Turn "XP remaining" into hours (and, when a daily grind is specified, days
 * and a completion date). Returns null when the rate is not usable.
 */
export function methodProjection(
  remainingXp: number,
  xpPerHour: number,
  hoursPerDay: number,
  fromMs: number,
): MethodProjection | null {
  if (!Number.isFinite(xpPerHour) || xpPerHour <= 0) return null;
  const remaining = Math.max(0, remainingXp);
  const hoursToMax = remaining / xpPerHour;
  const perDay = Number.isFinite(hoursPerDay) && hoursPerDay > 0 ? hoursPerDay : 0;
  const daysToMax = perDay > 0 ? hoursToMax / perDay : null;
  return {
    remainingXp: remaining,
    hoursToMax,
    xpPerDay: perDay > 0 ? xpPerHour * perDay : 0,
    daysToMax,
    etaMs: daysToMax === null ? null : fromMs + daysToMax * DAY_MS,
  };
}

/**
 * Daily points for the projected line, starting at the player's last observed
 * day and rising by `xpPerDay` until the target XP is hit. Points stop at the
 * completion day, or at `maxDays` when the grind runs longer than the horizon.
 */
export function projectionSeries(
  startDayMs: number,
  startXp: number,
  remainingXp: number,
  xpPerDay: number,
  maxDays: number,
  toY: (xp: number) => number,
): Array<{ dayMs: number; y: number }> {
  if (!Number.isFinite(xpPerDay) || xpPerDay <= 0) return [];
  if (maxDays < 1) return [];
  const remaining = Math.max(0, remainingXp);
  if (remaining <= 0) return [];
  const targetXp = startXp + remaining;
  const daysToTarget = Math.ceil(remaining / xpPerDay);
  const days = Math.min(maxDays, Math.max(1, daysToTarget));
  const out: Array<{ dayMs: number; y: number }> = [
    { dayMs: startDayMs, y: toY(startXp) },
  ];
  for (let d = 1; d <= days; d++) {
    const xp = Math.min(targetXp, startXp + xpPerDay * d);
    out.push({ dayMs: startDayMs + d * DAY_MS, y: toY(xp) });
  }
  return out;
}

/** Compact display for a day count ("0.5 days", "1 day", "84 days"). */
export function formatDays(days: number): string {
  const text = days < 10 ? days.toFixed(1) : Math.round(days).toLocaleString();
  return `${text} ${text === "1.0" || text === "1" ? "day" : "days"}`;
}
