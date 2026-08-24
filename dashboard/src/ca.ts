import { CA_COMPLETION } from "./data/caCompletion";
import type { CaTask } from "./store";

/**
 * Combat Achievement domain logic: merging the RuneProfile task list with the
 * static community completion-rate table, filtering, and laying out the
 * "easiest path to the next reward tier" plan.
 */

export interface CaTierDef {
  id: number;
  name: string;
  /** Points awarded per task of this tier (equal to the tier id). */
  points: number;
  /** Cumulative points needed to unlock this tier's rewards. */
  threshold: number;
  icon: string;
}

/**
 * Reward thresholds are point totals, independent of which tiers the points
 * came from — you can unlock Elite rewards purely on Easy/Medium tasks.
 */
export const CA_TIERS: readonly CaTierDef[] = [
  { id: 1, name: "Easy", points: 1, threshold: 41, icon: "easy" },
  { id: 2, name: "Medium", points: 2, threshold: 161, icon: "medium" },
  { id: 3, name: "Hard", points: 3, threshold: 419, icon: "hard" },
  { id: 4, name: "Elite", points: 4, threshold: 1075, icon: "elite" },
  { id: 5, name: "Master", points: 5, threshold: 1940, icon: "master" },
  { id: 6, name: "Grandmaster", points: 6, threshold: 2672, icon: "grandmaster" },
];

export const TOTAL_POSSIBLE_POINTS = CA_TIERS[CA_TIERS.length - 1].threshold;

export function tierById(id: number): CaTierDef | undefined {
  return CA_TIERS.find((t) => t.id === id);
}

/** Total points on offer across every task the API knows about. */
export function totalPossiblePoints(tasks: ReadonlyArray<{ tierId: number }>): number {
  return tasks.reduce((sum, t) => sum + t.tierId, 0);
}

export function tierIconUrl(tier: CaTierDef | string): string {
  const icon = typeof tier === "string" ? tier.toLowerCase() : tier.icon;
  return `${import.meta.env.BASE_URL}images/cas/${icon}.webp`;
}

/** Wiki article for a task, e.g. `A Scaley Encounter`. */
export function wikiUrl(taskName: string): string {
  return `https://oldschool.runescape.wiki/w/${encodeURIComponent(taskName.replace(/ /g, "_"))}`;
}

/**
 * Lowest completion rate present in the datastore. Tasks with an unknown or
 * N/A rate sort just below it so they land at the bottom of the plan.
 */
const LOWEST_KNOWN_PCT = (() => {
  let min = Infinity;
  for (const v of Object.values(CA_COMPLETION)) {
    if (typeof v === "number" && v < min) min = v;
  }
  return Number.isFinite(min) ? min : 1;
})();

export const UNKNOWN_COMPLETION_PCT = Math.max(0, LOWEST_KNOWN_PCT - 0.1);

/** True when the datastore has no entry at all for this task name. */
export function isMissingFromDatastore(taskName: string): boolean {
  return !(taskName in CA_COMPLETION);
}

/** Raw completion rate, or null when unknown / reported as N/A by the wiki. */
export function completionPct(taskName: string): number | null {
  const v = CA_COMPLETION[taskName];
  return typeof v === "number" ? v : null;
}

export interface PlannedTask extends CaTask {
  /** Points this task is worth (equals its tier id). */
  points: number;
  /** Community completion rate, or null when unknown / N/A. */
  pct: number | null;
  /** Rate used for sorting — unknowns sink below every known rate. */
  sortPct: number;
  /** True when the completion datastore has no row for this task. */
  missingData: boolean;
}

export function toPlannedTask(task: CaTask): PlannedTask {
  const pct = completionPct(task.name);
  return {
    ...task,
    points: task.tierId,
    pct,
    sortPct: pct ?? UNKNOWN_COMPLETION_PCT,
    missingData: isMissingFromDatastore(task.name),
  };
}

// ----- preferences -----

export interface CaPrefs {
  rsn: string | null;
  /** Task types the user has switched off. */
  excludedTypes: string[];
  /** Monsters/bosses the user never wants to see. */
  excludedMonsters: string[];
  /** Task difficulty tiers the user has switched off. */
  excludedTiers: number[];
  /** Show the to-do list as a reward tier → monster → task pivot. */
  grouped: boolean;
}

const PREFS_KEY = "maxdash:ca:prefs:v1";

export function defaultCaPrefs(): CaPrefs {
  return {
    rsn: null,
    excludedTypes: [],
    excludedMonsters: [],
    excludedTiers: [],
    grouped: true,
  };
}

export function loadCaPrefs(): CaPrefs {
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    if (!raw) return defaultCaPrefs();
    const parsed = JSON.parse(raw) as Partial<CaPrefs>;
    return {
      rsn: typeof parsed.rsn === "string" ? parsed.rsn : null,
      excludedTypes: Array.isArray(parsed.excludedTypes) ? parsed.excludedTypes.filter((v) => typeof v === "string") : [],
      excludedMonsters: Array.isArray(parsed.excludedMonsters) ? parsed.excludedMonsters.filter((v) => typeof v === "string") : [],
      excludedTiers: Array.isArray(parsed.excludedTiers) ? parsed.excludedTiers.filter((v) => typeof v === "number") : [],
      grouped: parsed.grouped !== false,
    };
  } catch {
    return defaultCaPrefs();
  }
}

export function saveCaPrefs(prefs: CaPrefs): void {
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // localStorage may be disabled (private mode); preferences just won't stick.
  }
}

// ----- aggregation -----

export interface GroupProgress {
  key: string;
  completed: number;
  total: number;
  pointsEarned: number;
  pointsRemaining: number;
  /** Mean completion rate of the tasks still outstanding (higher = easier). */
  avgRemainingPct: number | null;
  /** Best (highest) completion rate among outstanding tasks. */
  bestRemainingPct: number | null;
}

function groupBy(
  tasks: PlannedTask[],
  keyOf: (t: PlannedTask) => string,
): GroupProgress[] {
  const map = new Map<string, PlannedTask[]>();
  for (const t of tasks) {
    const k = keyOf(t) || "Unknown";
    const list = map.get(k);
    if (list) list.push(t);
    else map.set(k, [t]);
  }
  return [...map.entries()].map(([key, list]) => {
    const remaining = list.filter((t) => !t.completed);
    const knownPcts = remaining.map((t) => t.pct).filter((p): p is number => p !== null);
    return {
      key,
      completed: list.length - remaining.length,
      total: list.length,
      pointsEarned: list.filter((t) => t.completed).reduce((a, t) => a + t.points, 0),
      pointsRemaining: remaining.reduce((a, t) => a + t.points, 0),
      avgRemainingPct: knownPcts.length ? knownPcts.reduce((a, b) => a + b, 0) / knownPcts.length : null,
      bestRemainingPct: knownPcts.length ? Math.max(...knownPcts) : null,
    };
  });
}

export const groupByMonster = (tasks: PlannedTask[]) => groupBy(tasks, (t) => t.monster);
export const groupByType = (tasks: PlannedTask[]) => groupBy(tasks, (t) => t.type);
export const groupByTier = (tasks: PlannedTask[]) => groupBy(tasks, (t) => t.tierName);

// ----- plan -----

export type PlanRow =
  | { kind: "task"; id: string; task: PlannedTask; cumulativePoints: number; order: number }
  | {
      kind: "goal";
      id: string;
      tier: CaTierDef;
      /** Points still needed when this row is reached (0 once achieved). */
      pointsNeeded: number;
      /** Tasks from this plan required to get there. */
      tasksNeeded: number;
      /** False when the filtered plan never reaches the threshold. */
      reachable: boolean;
      /** Shortfall if unreachable with the current filters. */
      shortfall: number;
    };

export interface CaPlan {
  rows: PlanRow[];
  /** Outstanding tasks after filters, easiest first. */
  tasks: PlannedTask[];
  /** Points already banked (all completed tasks, filters don't apply). */
  startingPoints: number;
  /** Points reachable if every task in the filtered plan is done. */
  maxPlanPoints: number;
  /** Next unearned reward tier, if any. */
  nextTier: CaTierDef | null;
}

export interface CaFilters {
  excludedTypes: ReadonlySet<string>;
  excludedMonsters: ReadonlySet<string>;
  excludedTiers: ReadonlySet<number>;
}

export function filterTasks(tasks: PlannedTask[], filters: CaFilters): PlannedTask[] {
  return tasks.filter(
    (t) =>
      !filters.excludedTypes.has(t.type) &&
      !filters.excludedMonsters.has(t.monster) &&
      !filters.excludedTiers.has(t.tierId),
  );
}

/** Easiest first: highest completion rate, then cheapest tier, then name. */
export function byEasiest(a: PlannedTask, b: PlannedTask): number {
  if (b.sortPct !== a.sortPct) return b.sortPct - a.sortPct;
  if (a.points !== b.points) return a.points - b.points;
  return a.name.localeCompare(b.name);
}

/**
 * Build the ordered to-do list: outstanding tasks easiest-first, with a goal
 * row spliced in at the exact point each reward tier's threshold is crossed.
 */
export function buildPlan(
  allTasks: PlannedTask[],
  filters: CaFilters,
  startingPoints: number,
): CaPlan {
  const outstanding = filterTasks(
    allTasks.filter((t) => !t.completed),
    filters,
  ).sort(byEasiest);

  const rows: PlanRow[] = [];
  const pending = CA_TIERS.filter((t) => startingPoints < t.threshold);
  const achievedAlready = CA_TIERS.filter((t) => startingPoints >= t.threshold);
  let cumulative = startingPoints;
  let goalIdx = 0;

  outstanding.forEach((task, i) => {
    cumulative += task.points;
    rows.push({
      kind: "task",
      id: `task:${task.name}`,
      task,
      cumulativePoints: cumulative,
      order: i + 1,
    });
    while (goalIdx < pending.length && cumulative >= pending[goalIdx].threshold) {
      const tier = pending[goalIdx];
      rows.push({
        kind: "goal",
        id: `goal:${tier.id}`,
        tier,
        pointsNeeded: 0,
        tasksNeeded: i + 1,
        reachable: true,
        shortfall: 0,
      });
      goalIdx++;
    }
  });

  // Any tier the filtered plan can't reach is still shown, at the end, so the
  // user can see how far short their current filter set leaves them.
  for (; goalIdx < pending.length; goalIdx++) {
    const tier = pending[goalIdx];
    rows.push({
      kind: "goal",
      id: `goal:${tier.id}`,
      tier,
      pointsNeeded: tier.threshold - cumulative,
      tasksNeeded: outstanding.length,
      reachable: false,
      shortfall: tier.threshold - cumulative,
    });
  }

  return {
    rows,
    tasks: outstanding,
    startingPoints,
    maxPlanPoints: cumulative,
    nextTier: pending[0] ?? achievedAlready.at(-1) ?? null,
  };
}

/** Points/tasks still needed to unlock a given reward tier. */
export function tierGap(plan: CaPlan, tier: CaTierDef): { points: number; tasks: number | null } {
  const points = Math.max(0, tier.threshold - plan.startingPoints);
  if (points === 0) return { points: 0, tasks: 0 };
  const row = plan.rows.find((r) => r.kind === "goal" && r.tier.id === tier.id);
  return {
    points,
    tasks: row && row.kind === "goal" && row.reachable ? row.tasksNeeded : null,
  };
}

export const fmtPct = (pct: number | null) =>
  pct === null ? "N/A" : `${pct.toFixed(1)}%`;

// ----- grouped ("pivot") view -----

export interface GroupedTask {
  task: PlannedTask;
  cumulativePoints: number;
  /** 1-based position within the whole plan. */
  order: number;
}

export interface MonsterGroup {
  monster: string;
  tasks: GroupedTask[];
  points: number;
  /** Highest completion rate in the group (the easiest task here). */
  easiestPct: number | null;
  /** Lowest completion rate in the group (the hardest task here). */
  hardestPct: number | null;
  /** Sort key for the hardest task, with unknown rates sinking to the bottom. */
  hardestSortPct: number;
}

export interface TierGroup {
  id: string;
  /** The reward tier this block unlocks, or null for tasks past the last one. */
  tier: CaTierDef | null;
  monsters: MonsterGroup[];
  taskCount: number;
  points: number;
  /** Points total once every task in this block is done. */
  endPoints: number;
  /** False when the filtered plan never reaches this tier's threshold. */
  reachable: boolean;
  shortfall: number;
}

function makeMonsterGroups(tasks: PlannedTask[], startPoints: number, startOrder: number): {
  monsters: MonsterGroup[];
  endPoints: number;
} {
  const byMonster = new Map<string, PlannedTask[]>();
  for (const t of tasks) {
    const list = byMonster.get(t.monster);
    if (list) list.push(t);
    else byMonster.set(t.monster, [t]);
  }

  const groups = [...byMonster.entries()].map(([monster, list]) => {
    // Within a monster, easiest first (descending completion rate).
    const ordered = [...list].sort(byEasiest);
    const known = ordered.map((t) => t.pct).filter((p): p is number => p !== null);
    return {
      monster,
      ordered,
      points: ordered.reduce((a, t) => a + t.points, 0),
      easiestPct: known.length ? Math.max(...known) : null,
      hardestPct: known.length ? Math.min(...known) : null,
      hardestSortPct: Math.min(...ordered.map((t) => t.sortPct)),
    };
  });

  // Monsters whose hardest task is the least hard come first, so the top of
  // the block is the least painful monster to clear out entirely.
  groups.sort((a, b) => {
    if (b.hardestSortPct !== a.hardestSortPct) return b.hardestSortPct - a.hardestSortPct;
    return a.monster.localeCompare(b.monster);
  });

  let cumulative = startPoints;
  let order = startOrder;
  const monsters: MonsterGroup[] = groups.map((g) => ({
    monster: g.monster,
    points: g.points,
    easiestPct: g.easiestPct,
    hardestPct: g.hardestPct,
    hardestSortPct: g.hardestSortPct,
    tasks: g.ordered.map((task) => {
      cumulative += task.points;
      return { task, cumulativePoints: cumulative, order: order++ };
    }),
  }));

  return { monsters, endPoints: cumulative };
}

/**
 * Pivot the flat plan into reward tier → monster → task blocks.
 *
 * Which tasks land in which reward-tier block is decided by the flat
 * easiest-first ordering (so a block still contains exactly the tasks needed
 * to cross that threshold); the monster ordering only rearranges them within
 * the block, which leaves each block's end-of-block points total unchanged.
 */
export function groupPlan(plan: CaPlan): TierGroup[] {
  const groups: TierGroup[] = [];
  let pending: PlannedTask[] = [];
  let points = plan.startingPoints;
  let order = 1;

  const push = (tier: CaTierDef | null, reachable: boolean, shortfall: number) => {
    const { monsters, endPoints } = makeMonsterGroups(pending, points, order);
    // Skip empty tail blocks, but keep empty unreachable tiers so the user can
    // still see how far short their filters leave them.
    if (pending.length === 0 && tier === null) return;
    groups.push({
      id: tier ? `tier:${tier.id}` : "tier:beyond",
      tier,
      monsters,
      taskCount: pending.length,
      points: endPoints - points,
      endPoints,
      reachable,
      shortfall,
    });
    order += pending.length;
    points = endPoints;
    pending = [];
  };

  for (const row of plan.rows) {
    if (row.kind === "task") {
      pending.push(row.task);
      continue;
    }
    push(row.tier, row.reachable, row.shortfall);
  }
  push(null, true, 0);

  return groups;
}

