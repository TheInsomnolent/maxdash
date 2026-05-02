import { startOfDay } from "date-fns";
import { SKILLS, TRAINABLE_SKILLS } from "./skills";
import type { PlayerFile } from "./store";

const DAY_MS = 86_400_000;
/** Don't attribute gain across snapshot gaps wider than this (in days). */
const MAX_ATTRIB_GAP_DAYS = 2;
/** A "session" is bounded by gaps wider than this between snapshots (hours). */
const SESSION_GAP_HOURS = 6;

/** Daily overall + per-skill XP gain, indexed by skill column. */
interface DailyRow {
  dayMs: number;
  /** s[0] = overall, s[1..] = per skill, matches snapshot layout. */
  s: number[];
}

/**
 * Bucket a player's snapshot history into day → max-XP-per-skill, then diff
 * consecutive observed days into per-skill gain rows. Gains across gaps wider
 * than `MAX_ATTRIB_GAP_DAYS` are dropped (we don't know which day they
 * actually occurred on).
 */
function dailyAllSkills(pf: PlayerFile): DailyRow[] {
  if (pf.snapshots.length < 2) return [];
  const skillCount = pf.snapshots[0].s.length;
  // Day → max XP observed per skill column.
  const byDay = new Map<number, number[]>();
  for (const snap of pf.snapshots) {
    const d = startOfDay(new Date(snap.t)).getTime();
    let row = byDay.get(d);
    if (!row) {
      row = new Array(skillCount).fill(-1);
      byDay.set(d, row);
    }
    for (let k = 0; k < skillCount; k++) {
      const v = snap.s[k];
      if (v < 0) continue;
      if (row[k] < 0 || v > row[k]) row[k] = v;
    }
  }
  const days = [...byDay.entries()].sort((a, b) => a[0] - b[0]);

  const out: DailyRow[] = [];
  for (let i = 1; i < days.length; i++) {
    const [prevDay, prev] = days[i - 1];
    const [curDay, cur] = days[i];
    const gapDays = Math.max(1, Math.round((curDay - prevDay) / DAY_MS));
    if (gapDays > MAX_ATTRIB_GAP_DAYS) continue;
    const gain: number[] = new Array(skillCount).fill(0);
    let any = false;
    for (let k = 0; k < skillCount; k++) {
      const a = prev[k];
      const b = cur[k];
      if (a < 0 || b < 0) continue;
      const d = b - a;
      if (d > 0) { gain[k] = d; any = true; }
    }
    if (any) out.push({ dayMs: curDay, s: gain });
  }
  return out;
}

export interface PlayerRecords {
  rsn: string;
  /** Best single calendar day of overall XP gain. */
  bestDay: { dayMs: number; xp: number } | null;
  /** Best 7-consecutive-day overall XP. */
  bestWeek: { startMs: number; endMs: number; xp: number } | null;
  /** Longest streak (in days) of consecutive days where overall XP grew. */
  longestStreak: { length: number; startMs: number | null; endMs: number | null };
  /** Current ongoing streak (matches the same rule, ending today). */
  currentStreak: number;
  /** Best single-day single-skill grind ever (highest XP gained in one skill in one day). */
  bestSkillDay: { dayMs: number; skill: string; xp: number } | null;
  /** Total active days (any gain) over the entire history. */
  activeDays: number;
  /** Total XP ever recorded since first snapshot. */
  lifetimeXpGained: number;
}

export function computePlayerRecords(pf: PlayerFile): PlayerRecords {
  const days = dailyAllSkills(pf);

  let bestDay: PlayerRecords["bestDay"] = null;
  let bestSkillDay: PlayerRecords["bestSkillDay"] = null;
  let lifetimeXp = 0;
  for (const d of days) {
    const overall = d.s[0];
    lifetimeXp += overall;
    if (!bestDay || overall > bestDay.xp) bestDay = { dayMs: d.dayMs, xp: overall };
    for (let k = 1; k < d.s.length; k++) {
      const v = d.s[k];
      if (v <= 0) continue;
      if (!bestSkillDay || v > bestSkillDay.xp) {
        bestSkillDay = { dayMs: d.dayMs, skill: SKILLS[k], xp: v };
      }
    }
  }

  // Best 7-day rolling sum, anchored on actual calendar days. We re-key by
  // dayMs so days with no observed gain count as 0.
  let bestWeek: PlayerRecords["bestWeek"] = null;
  if (days.length > 0) {
    const dayMap = new Map(days.map((d) => [d.dayMs, d.s[0]]));
    const startDay = days[0].dayMs;
    const endDay = days[days.length - 1].dayMs;
    const total = Math.round((endDay - startDay) / DAY_MS) + 1;
    const series: Array<{ dayMs: number; xp: number }> = [];
    for (let i = 0; i < total; i++) {
      const dayMs = startDay + i * DAY_MS;
      series.push({ dayMs, xp: dayMap.get(dayMs) ?? 0 });
    }
    let win = 0;
    for (let i = 0; i < Math.min(7, series.length); i++) win += series[i].xp;
    let bestWin = win;
    let bestEndIdx = Math.min(7, series.length) - 1;
    for (let i = 7; i < series.length; i++) {
      win += series[i].xp - series[i - 7].xp;
      if (win > bestWin) { bestWin = win; bestEndIdx = i; }
    }
    if (bestWin > 0) {
      const endMs = series[bestEndIdx].dayMs;
      const startMs = series[Math.max(0, bestEndIdx - 6)].dayMs;
      bestWeek = { startMs, endMs, xp: bestWin };
    }
  }

  // Streaks: consecutive calendar days with positive overall gain.
  let longest = { length: 0, startMs: null as number | null, endMs: null as number | null };
  let cur = 0;
  let curStart: number | null = null;
  let prevDay: number | null = null;
  for (const d of days) {
    if (d.s[0] <= 0) continue;
    if (prevDay != null && d.dayMs - prevDay === DAY_MS) {
      cur++;
    } else {
      cur = 1;
      curStart = d.dayMs;
    }
    if (cur > longest.length) {
      longest = { length: cur, startMs: curStart, endMs: d.dayMs };
    }
    prevDay = d.dayMs;
  }

  // Current streak: walk back from today (or the latest day with a gain).
  const todayMs = startOfDay(new Date()).getTime();
  let currentStreak = 0;
  const dayGainMap = new Map(days.map((d) => [d.dayMs, d.s[0]]));
  // Start at today; if today has no gain yet, drop back to yesterday so an
  // active player isn't penalised for not having played in the last few hours.
  let cursor = (dayGainMap.get(todayMs) ?? 0) > 0 ? todayMs : todayMs - DAY_MS;
  while ((dayGainMap.get(cursor) ?? 0) > 0) {
    currentStreak++;
    cursor -= DAY_MS;
  }

  const activeDays = days.filter((d) => d.s[0] > 0).length;

  return {
    rsn: pf.rsn,
    bestDay,
    bestWeek,
    longestStreak: longest,
    currentStreak,
    bestSkillDay,
    activeDays,
    lifetimeXpGained: lifetimeXp,
  };
}

export interface SessionRecord {
  rsn: string;
  startMs: number;
  endMs: number;
  durationHrs: number;
  xp: number;
  /** Skill index with the largest gain in the session. */
  topSkill: string;
  topSkillXp: number;
}

/**
 * Identify "sessions" in a player's snapshot history: contiguous runs of
 * snapshots where overall XP is growing AND the gap between snapshots is
 * <= SESSION_GAP_HOURS. Returns the longest sessions sorted by XP.
 */
export function topSessionsForPlayer(pf: PlayerFile, limit = 20): SessionRecord[] {
  const snaps = pf.snapshots;
  if (snaps.length < 2) return [];
  const skillCount = snaps[0].s.length;
  const out: SessionRecord[] = [];

  let runStart = -1;
  let runStartTs = 0;
  for (let i = 1; i < snaps.length; i++) {
    const ta = Date.parse(snaps[i - 1].t);
    const tb = Date.parse(snaps[i].t);
    const gapHrs = (tb - ta) / 3600_000;
    const a = snaps[i - 1].s[0];
    const b = snaps[i].s[0];
    const growing = a >= 0 && b >= 0 && b > a;
    const continuous = gapHrs <= SESSION_GAP_HOURS;
    if (growing && continuous) {
      if (runStart < 0) { runStart = i - 1; runStartTs = ta; }
    } else {
      if (runStart >= 0) flush(runStart, i - 1, runStartTs);
      runStart = -1;
    }
  }
  if (runStart >= 0) flush(runStart, snaps.length - 1, runStartTs);

  function flush(from: number, to: number, startTs: number) {
    if (to <= from) return;
    const endTs = Date.parse(snaps[to].t);
    const durationHrs = (endTs - startTs) / 3600_000;
    let topIdx = 1;
    let topXp = 0;
    let totalXp = 0;
    for (let k = 1; k < skillCount; k++) {
      const a = snaps[from].s[k];
      const b = snaps[to].s[k];
      if (a < 0 || b < 0) continue;
      const d = b - a;
      if (d <= 0) continue;
      totalXp += d;
      if (d > topXp) { topXp = d; topIdx = k; }
    }
    if (totalXp <= 0) return;
    out.push({
      rsn: pf.rsn,
      startMs: startTs,
      endMs: endTs,
      durationHrs,
      xp: totalXp,
      topSkill: SKILLS[topIdx],
      topSkillXp: topXp,
    });
  }

  out.sort((a, b) => b.xp - a.xp);
  return out.slice(0, limit);
}

/** Top single-day overall XP gains across the whole roster (by player). */
export interface DayRecord {
  rsn: string;
  dayMs: number;
  xp: number;
}
export function topGroupDays(records: PlayerRecords[], limit = 10): DayRecord[] {
  // For ranking, we re-collect per-day series for each player using
  // dailyAllSkills indirectly through the records; here we expose the
  // aggregate "best day" per player. For a true top-10, the caller should
  // use buildAllDayRecords below.
  const out: DayRecord[] = records
    .filter((r): r is PlayerRecords & { bestDay: NonNullable<PlayerRecords["bestDay"]> } => r.bestDay != null)
    .map((r) => ({ rsn: r.rsn, dayMs: r.bestDay!.dayMs, xp: r.bestDay!.xp }));
  out.sort((a, b) => b.xp - a.xp);
  return out.slice(0, limit);
}

/** True top-N XP days across all players (any day, not just per-player best). */
export interface SkillDayRecord extends DayRecord {
  skill: string;
}
export function buildAllDayRecords(
  pfs: PlayerFile[],
  limit = 10,
): { topDays: DayRecord[]; topSkillDays: SkillDayRecord[] } {
  const allDays: DayRecord[] = [];
  const allSkillDays: SkillDayRecord[] = [];
  for (const pf of pfs) {
    const days = dailyAllSkills(pf);
    for (const d of days) {
      if (d.s[0] > 0) allDays.push({ rsn: pf.rsn, dayMs: d.dayMs, xp: d.s[0] });
      for (let k = 1; k < d.s.length; k++) {
        if (d.s[k] > 0) {
          allSkillDays.push({ rsn: pf.rsn, dayMs: d.dayMs, xp: d.s[k], skill: SKILLS[k] });
        }
      }
    }
  }
  allDays.sort((a, b) => b.xp - a.xp);
  allSkillDays.sort((a, b) => b.xp - a.xp);
  return {
    topDays: allDays.slice(0, limit),
    topSkillDays: allSkillDays.slice(0, limit),
  };
}

export const TRAINABLE_RECORDS_COUNT = TRAINABLE_SKILLS.length;
