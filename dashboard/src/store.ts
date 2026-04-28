import { create } from "zustand";
import { MAX_XP, SKILLS, registerPlayerColors, xpToLevel } from "./skills";
import type { AccountType } from "./components/AccountBadge";

export interface IndexEntry {
  rsn: string;
  type: AccountType;
  file: string;
  totalXp: number;
  totalLevel: number;
  skills99: number;
  lastChecked: string;
  lastChanged: string | null;
  status: "ok" | "unranked" | "error";
  error?: string;
}

export interface IndexFile {
  generatedAt: string;
  skills: readonly string[];
  players: IndexEntry[];
}

export interface PlayerFile {
  rsn: string;
  firstSeen: string;
  snapshots: Array<{ t: string; s: number[] }>;
}

interface DataState {
  index: IndexFile | null;
  players: Record<string, PlayerFile>;
  loading: boolean;
  error: string | null;
  load: () => Promise<void>;
}

const dataBase = `${import.meta.env.BASE_URL}data`;

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${dataBase}/${path}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`${res.status} ${path}`);
  return (await res.json()) as T;
}

export const useData = create<DataState>((set, get) => ({
  index: null,
  players: {},
  loading: false,
  error: null,
  async load() {
    if (get().loading) return;
    set({ loading: true, error: null });
    try {
      const idx = await fetchJson<IndexFile>("index.json");
      registerPlayerColors(idx.players.map((p) => p.rsn));
      const results = await Promise.all(
        idx.players.map(async (p) => {
          try {
            return [p.rsn, await fetchJson<PlayerFile>(p.file)] as const;
          } catch {
            return [p.rsn, { rsn: p.rsn, firstSeen: p.lastChecked, snapshots: [] } satisfies PlayerFile] as const;
          }
        }),
      );
      const players: Record<string, PlayerFile> = {};
      for (const [rsn, pf] of results) players[rsn] = pf;
      set({ index: idx, players, loading: false });
    } catch (err) {
      set({ error: (err as Error).message, loading: false });
    }
  },
}));

// ----- selectors -----

export type RangeKey = "24h" | "7d" | "30d" | "all";
export const RANGE_OPTIONS: Array<{ key: RangeKey; label: string; ms: number | null }> = [
  { key: "24h", label: "24h", ms: 24 * 3600_000 },
  { key: "7d", label: "7d", ms: 7 * 24 * 3600_000 },
  { key: "30d", label: "30d", ms: 30 * 24 * 3600_000 },
  { key: "all", label: "All", ms: null },
];

export function snapshotsInRange(pf: PlayerFile, range: RangeKey) {
  const opt = RANGE_OPTIONS.find((r) => r.key === range)!;
  if (!opt.ms) return pf.snapshots;
  const cutoff = Date.now() - opt.ms;
  const snaps = pf.snapshots;
  const firstInRange = snaps.findIndex((s) => Date.parse(s.t) >= cutoff);
  if (firstInRange === -1) {
    // Nothing in range — surface the most recent snapshot, clamped to cutoff,
    // so consumers (charts, deltas) still have a single point to anchor on.
    const last = snaps.at(-1);
    return last ? [{ ...last, t: new Date(cutoff).toISOString() }] : [];
  }
  if (firstInRange === 0) return snaps;
  // Include the snapshot just before cutoff so deltas are accurate, but clamp
  // its timestamp to the cutoff so charts don't stretch back to it.
  const anchor = { ...snaps[firstInRange - 1], t: new Date(cutoff).toISOString() };
  return [anchor, ...snaps.slice(firstInRange)];
}

export function latestSnapshot(pf: PlayerFile) {
  return pf.snapshots.at(-1) ?? null;
}

/** XP gain over a range. Returns 0 if fewer than 2 snapshots in range. */
export function xpGainInRange(pf: PlayerFile, skillIdx: number, range: RangeKey): number {
  const snaps = snapshotsInRange(pf, range);
  if (snaps.length < 2) return 0;
  const a = snaps[0].s[skillIdx];
  const b = snaps.at(-1)!.s[skillIdx];
  if (a < 0 || b < 0) return 0;
  return Math.max(0, b - a);
}

/** Level gain over a range. */
export function levelGainInRange(pf: PlayerFile, skillIdx: number, range: RangeKey): number {
  const snaps = snapshotsInRange(pf, range);
  if (snaps.length < 2) return 0;
  const a = snaps[0].s[skillIdx];
  const b = snaps.at(-1)!.s[skillIdx];
  if (a < 0 || b < 0) return 0;
  if (skillIdx === 0) {
    // Overall: difference of summed skill levels.
    let la = 0, lb = 0;
    for (let i = 1; i < snaps[0].s.length; i++) {
      if (snaps[0].s[i] >= 0) la += xpToLevel(snaps[0].s[i]);
      if (snaps.at(-1)!.s[i] >= 0) lb += xpToLevel(snaps.at(-1)!.s[i]);
    }
    return Math.max(0, lb - la);
  }
  return Math.max(0, xpToLevel(b) - xpToLevel(a));
}

/**
 * Days remaining to reach 99 in a skill, via simple linear regression on the
 * last 7 days of snapshots. Returns null when no meaningful trend / already maxed.
 */
export function etaToMaxDays(pf: PlayerFile, skillIdx: number): number | null {
  const last = latestSnapshot(pf);
  if (!last) return null;
  const cur = last.s[skillIdx];
  if (cur < 0) return null;
  // Overall (idx 0) caps at the sum of every skill at 99.
  const target = skillIdx === 0 ? MAX_XP * (last.s.length - 1) : MAX_XP;
  if (cur >= target) return 0;

  const cutoff = Date.now() - 7 * 24 * 3600_000;
  const pts = pf.snapshots
    .filter((s) => Date.parse(s.t) >= cutoff && s.s[skillIdx] >= 0)
    .map((s) => ({ x: Date.parse(s.t), y: s.s[skillIdx] }));
  if (pts.length < 2) return null;

  // Linear regression slope (xp per ms).
  const n = pts.length;
  const meanX = pts.reduce((a, p) => a + p.x, 0) / n;
  const meanY = pts.reduce((a, p) => a + p.y, 0) / n;
  let num = 0, den = 0;
  for (const p of pts) {
    num += (p.x - meanX) * (p.y - meanY);
    den += (p.x - meanX) ** 2;
  }
  if (den === 0) return null;
  const slope = num / den; // xp per ms
  if (slope <= 0) return null;
  const remainingXp = target - cur;
  const ms = remainingXp / slope;
  return ms / (24 * 3600_000);
}

export function totalLevelFromSnapshot(s: number[]): number {
  let lvl = 0;
  for (let i = 1; i < s.length; i++) {
    if (s[i] >= 0) lvl += xpToLevel(s[i]);
    else lvl += 1; // unranked still counts as level 1
  }
  return lvl;
}

export function skills99Count(s: number[]): number {
  let n = 0;
  for (let i = 1; i < s.length; i++) {
    if (s[i] >= MAX_XP) n++;
  }
  return n;
}

export function skillNameToIdx(name: string): number {
  return SKILLS.indexOf(name as (typeof SKILLS)[number]);
}

/** Apply the global account-type filter (empty filter ⇒ pass everything). */
export function filterByType<T extends { type: AccountType }>(
  items: readonly T[],
  filter: ReadonlySet<AccountType>,
): T[] {
  if (filter.size === 0) return [...items];
  return items.filter((p) => filter.has(p.type));
}

/** A player is considered inactive when there has been no XP change for 7+ days. */
export const INACTIVE_THRESHOLD_MS = 7 * 24 * 3600_000;
export function isInactive(p: Pick<IndexEntry, "lastChanged">): boolean {
  if (!p.lastChanged) return true;
  return Date.now() - Date.parse(p.lastChanged) > INACTIVE_THRESHOLD_MS;
}

/**
 * Combined player filter applying both the account-type filter and the
 * "hide inactive" toggle. Use this in views that render player rows/series.
 */
export function filterPlayers(
  items: readonly IndexEntry[],
  typeFilter: ReadonlySet<AccountType>,
  hideInactive: boolean,
): IndexEntry[] {
  let out = filterByType(items, typeFilter);
  if (hideInactive) out = out.filter((p) => !isInactive(p));
  return out;
}

/**
 * Active hours in a range: sum of inter-snapshot intervals where overall XP
 * actually grew. Bounded by the gap between snapshots, so a gap > 1d is still
 * counted as one full day of activity if XP went up across it (best we can do
 * without finer telemetry). Returns 0 when there's nothing to measure.
 */
export function activeHoursInRange(pf: PlayerFile, range: RangeKey): number {
  const inR = snapshotsInRange(pf, range);
  let hrs = 0;
  for (let i = 1; i < inR.length; i++) {
    const a = inR[i - 1].s[0];
    const b = inR[i].s[0];
    if (a < 0 || b < 0 || b === a) continue;
    hrs += (Date.parse(inR[i].t) - Date.parse(inR[i - 1].t)) / 3600_000;
  }
  return hrs;
}

/** Streak (in hours) since the player's most recent XP gain across any skill. */
export function noXpStreakHours(pf: PlayerFile): number | null {
  const snaps = pf.snapshots;
  if (snaps.length < 2) return null;
  // Find latest snapshot where any skill XP differs from the next one.
  for (let i = snaps.length - 1; i > 0; i--) {
    const a = snaps[i - 1].s;
    const b = snaps[i].s;
    for (let k = 1; k < b.length; k++) {
      if (a[k] >= 0 && b[k] >= 0 && b[k] !== a[k]) {
        return (Date.now() - Date.parse(snaps[i].t)) / 3600_000;
      }
    }
  }
  return (Date.now() - Date.parse(snaps[0].t)) / 3600_000;
}
