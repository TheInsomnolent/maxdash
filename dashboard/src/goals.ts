import { MAX_XP, SKILLS, TRAINABLE_SKILLS, xpForLevel, xpToLevel } from "./skills";
import {
  type IndexEntry, type PlayerFile, latestSnapshot, xpGainInRange,
} from "./store";

/**
 * Goal definitions are intentionally simple so they round-trip safely through
 * localStorage and so the evaluator stays a pure function of (goal, players).
 */
export type Goal =
  | {
      id: string;
      kind: "everyoneReachesLevel";
      title: string;
      skill: string;     // a SKILLS name, including "Overall" → uses total level
      level: number;     // 2..99 (or 2..2277 when skill === "Overall")
    }
  | {
      id: string;
      kind: "groupTotalXp";
      title: string;
      skill: string;     // a SKILLS name; "Overall" sums total XP
      target: number;
    }
  | {
      id: string;
      kind: "groupHas99sCount";
      title: string;
      target: number;    // total count of 99s across the whole roster
    };

export interface GoalContribution {
  rsn: string;
  /** Current value for the metric we're aggregating (xp or level). */
  current: number;
  /** Threshold this player needs to hit (level/xp goals); -1 when N/A. */
  target: number;
  /** Contribution percent toward the group target (0..100). */
  contribution: number;
  /** Whether this player has individually completed their share. */
  done: boolean;
}

export interface GoalProgress {
  goal: Goal;
  /** 0..100 group progress. */
  percent: number;
  /** Group-level current vs target. */
  current: number;
  target: number;
  contributions: GoalContribution[];
  /** Estimated days to completion at current 30-day pace, or null if stalled. */
  etaDays: number | null;
  /** Pretty-formatted current/target for the headline. */
  format: (n: number) => string;
}

const STORAGE_KEY = "maxdash:goals:v1";

/** Built-in goals that always show even if the user never adds anything. */
export function defaultGoals(): Goal[] {
  return [
    {
      id: "builtin:everyone-2000",
      kind: "everyoneReachesLevel",
      title: "Everyone hits Total Level 2000",
      skill: "Overall",
      level: 2000,
    },
    {
      id: "builtin:everyone-99-slayer",
      kind: "everyoneReachesLevel",
      title: "Everyone gets 99 Slayer",
      skill: "Slayer",
      level: 99,
    },
    {
      id: "builtin:group-1b-overall",
      kind: "groupTotalXp",
      title: "Group total XP reaches 1 billion",
      skill: "Overall",
      target: 1_000_000_000,
    },
    {
      id: "builtin:fifty-99s",
      kind: "groupHas99sCount",
      title: "50 collective 99s across the roster",
      target: 50,
    },
  ];
}

export function loadGoals(): Goal[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultGoals();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return defaultGoals();
    // Merge: keep user-defined first, then any built-ins they haven't deleted.
    return parsed as Goal[];
  } catch {
    return defaultGoals();
  }
}

export function saveGoals(goals: Goal[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(goals));
  } catch {
    // localStorage may be disabled (private mode); silently ignore.
  }
}

/** Sum overall XP gained over the last `days` for one player. */
function recentDailyXp(pf: PlayerFile, skillIdx: number, days: number): number {
  // Reuse the existing range-based gain helper for consistency with the rest
  // of the app's "last N days" math. We only need overall XP per player.
  const range = days <= 1 ? "24h"
    : days <= 7 ? "7d"
    : days <= 30 ? "30d"
    : "30d";
  const gain = xpGainInRange(pf, skillIdx, range);
  return gain / Math.max(1, days);
}

export function evaluateGoal(
  goal: Goal,
  index: IndexEntry[],
  players: Record<string, PlayerFile>,
): GoalProgress {
  switch (goal.kind) {
    case "everyoneReachesLevel": return evalEveryoneLevel(goal, index, players);
    case "groupTotalXp":         return evalGroupTotalXp(goal, index, players);
    case "groupHas99sCount":     return evalGroup99s(goal, index, players);
  }
}

function evalEveryoneLevel(
  goal: Extract<Goal, { kind: "everyoneReachesLevel" }>,
  index: IndexEntry[],
  players: Record<string, PlayerFile>,
): GoalProgress {
  const isOverall = goal.skill === "Overall";
  const skillIdx = isOverall ? 0 : SKILLS.indexOf(goal.skill as (typeof SKILLS)[number]);
  if (skillIdx < 0) return emptyProgress(goal, () => "—");

  const targetLevel = goal.level;
  const targetXp = isOverall ? null : xpForLevel(targetLevel);

  let groupCurrent = 0;
  let groupTarget = 0;
  let etaXpTotal = 0;
  let etaDailyXp = 0;

  const contributions: GoalContribution[] = index.map((p) => {
    const pf = players[p.rsn];
    const last = pf ? latestSnapshot(pf) : null;
    const snap = last?.s ?? [];
    let current: number;
    let target: number;
    let done: boolean;
    if (isOverall) {
      // Sum of skill levels across all trainable skills (matches store helper).
      let lvl = 0;
      for (let i = 1; i < snap.length; i++) {
        lvl += snap[i] >= 0 ? xpToLevel(snap[i]) : 1;
      }
      current = Math.min(lvl, targetLevel);
      target = targetLevel;
      done = lvl >= targetLevel;
    } else {
      const xp = snap[skillIdx] ?? -1;
      current = xp >= 0 ? Math.min(xp, targetXp!) : 0;
      target = targetXp!;
      done = xp >= targetXp!;
      if (!done && pf) {
        // Per-day pace toward this skill, used for ETA aggregation.
        etaDailyXp += recentDailyXp(pf, skillIdx, 30);
        etaXpTotal += target - current;
      }
    }
    groupCurrent += current;
    groupTarget += target;
    return {
      rsn: p.rsn,
      current,
      target,
      contribution: target > 0 ? (current / target) * 100 : 0,
      done,
    };
  });

  const percent = groupTarget > 0 ? (groupCurrent / groupTarget) * 100 : 0;
  const etaDays = !isOverall && etaDailyXp > 0 ? etaXpTotal / etaDailyXp : null;

  return {
    goal,
    percent,
    current: groupCurrent,
    target: groupTarget,
    contributions,
    etaDays,
    format: isOverall ? (n) => `${Math.round(n).toLocaleString()} lvls` : fmtXpCompact,
  };
}

function evalGroupTotalXp(
  goal: Extract<Goal, { kind: "groupTotalXp" }>,
  index: IndexEntry[],
  players: Record<string, PlayerFile>,
): GoalProgress {
  const isOverall = goal.skill === "Overall";
  const skillIdx = isOverall ? 0 : SKILLS.indexOf(goal.skill as (typeof SKILLS)[number]);
  if (skillIdx < 0) return emptyProgress(goal, fmtXpCompact);

  let groupCurrent = 0;
  let dailyXp = 0;

  const contributions: GoalContribution[] = index.map((p) => {
    const pf = players[p.rsn];
    const last = pf ? latestSnapshot(pf) : null;
    const xp = last?.s[skillIdx] ?? 0;
    const cur = Math.max(0, xp);
    groupCurrent += cur;
    if (pf) dailyXp += recentDailyXp(pf, skillIdx, 30);
    return {
      rsn: p.rsn,
      current: cur,
      target: -1,
      contribution: goal.target > 0 ? (cur / goal.target) * 100 : 0,
      done: false,
    };
  });

  const remaining = Math.max(0, goal.target - groupCurrent);
  const etaDays = dailyXp > 0 && remaining > 0 ? remaining / dailyXp : (remaining === 0 ? 0 : null);
  return {
    goal,
    percent: goal.target > 0 ? Math.min(100, (groupCurrent / goal.target) * 100) : 100,
    current: groupCurrent,
    target: goal.target,
    contributions,
    etaDays,
    format: fmtXpCompact,
  };
}

function evalGroup99s(
  goal: Extract<Goal, { kind: "groupHas99sCount" }>,
  index: IndexEntry[],
  players: Record<string, PlayerFile>,
): GoalProgress {
  let total = 0;
  const contributions: GoalContribution[] = index.map((p) => {
    const pf = players[p.rsn];
    const last = pf ? latestSnapshot(pf) : null;
    const snap = last?.s ?? [];
    let n = 0;
    for (let i = 1; i < snap.length; i++) if (snap[i] >= MAX_XP) n++;
    total += n;
    return {
      rsn: p.rsn,
      current: n,
      target: -1,
      contribution: goal.target > 0 ? (n / goal.target) * 100 : 0,
      done: false,
    };
  });
  return {
    goal,
    percent: goal.target > 0 ? Math.min(100, (total / goal.target) * 100) : 100,
    current: total,
    target: goal.target,
    contributions,
    etaDays: null, // discrete events; ETA isn't meaningful
    format: (n) => `${Math.round(n)} 99s`,
  };
}

function emptyProgress(goal: Goal, format: (n: number) => string): GoalProgress {
  return {
    goal, percent: 0, current: 0, target: 0,
    contributions: [], etaDays: null, format,
  };
}

function fmtXpCompact(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B xp`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M xp`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k xp`;
  return `${Math.round(n)} xp`;
}

export const SKILL_OPTIONS_FOR_GOALS = ["Overall", ...TRAINABLE_SKILLS];
