import { MAX_XP, SKILLS, xpToLevel } from "./skills";
import type { PlayerFile } from "./store";

export type MilestoneKind = "skill99" | "skillLevel" | "totalLevel" | "totalXp" | "bigDay";

export interface Milestone {
  /** ISO timestamp of the snapshot where the milestone was first observed. */
  t: string;
  rsn: string;
  kind: MilestoneKind;
  /** Human-readable title (e.g. "99 Slayer", "Total level 2000"). */
  title: string;
  /** Optional secondary line ("from 98", "300M xp", etc.). */
  detail?: string;
  /** Skill icon to render, when applicable. */
  skill?: string;
  /** Numeric value for sorting/highlighting (the achieved threshold). */
  value: number;
  /** Bigger = more significant. Used to feature the row visually. */
  weight: number;
}

/** Level breakpoints we treat as celebration-worthy. */
const SKILL_LEVEL_STEPS = [50, 60, 70, 80, 85, 90, 92, 94, 96, 98];
const TOTAL_LEVEL_STEPS = [1500, 1700, 1800, 1900, 2000, 2100, 2150, 2200, 2250, 2275, 2277];
const TOTAL_XP_STEPS = [
  50_000_000, 100_000_000, 150_000_000, 200_000_000, 300_000_000,
  500_000_000, 750_000_000, 1_000_000_000, 1_500_000_000, 2_000_000_000,
  3_000_000_000, 4_000_000_000, 4_600_000_000,
];
/** Treat any single-day overall XP gain above this as a "big day" milestone. */
const BIG_DAY_THRESHOLD = 5_000_000;

/** Maximum gap (in days) between two snapshots for us to trust an "observed
 *  transition" between them. Larger gaps mean the player was almost certainly
 *  between thresholds at some point we never saw, so attributing the crossing
 *  to a single snapshot is misleading. */
const MAX_TRANSITION_GAP_DAYS = 14;
/** Big-day events require continuous coverage across the day boundary. */
const MAX_BIGDAY_GAP_DAYS = 1.5;

const DAY_MS = 86_400_000;

/**
 * Walk a player's snapshot history and emit one milestone per *observed*
 * threshold crossing. To avoid back-dating dozens of milestones onto sparse
 * histories (single-datapoint backfills, long unranked stretches, etc.):
 *
 *  - The very first snapshot can never trigger a milestone — we have no
 *    "before" reference, so anything it shows might have been crossed years
 *    ago in-game.
 *  - For every other threshold, we require the *previous* snapshot to be
 *    below the threshold AND to be no more than MAX_TRANSITION_GAP_DAYS old.
 *  - Big-day events require near-contiguous coverage across the day boundary.
 */
export function milestonesForPlayer(pf: PlayerFile): Milestone[] {
  const out: Milestone[] = [];
  const snaps = pf.snapshots;
  if (snaps.length < 2) return out;

  let prevSnap = snaps[0];
  let prevTotalLevel = computeTotalLevel(prevSnap.s);

  // Daily-bucket the snapshots so big-day events align to a single calendar
  // day. We also require near-contiguous coverage across the day boundary.
  let prevDay = Math.floor(Date.parse(prevSnap.t) / DAY_MS);
  let prevDayLastXp = prevSnap.s[0] >= 0 ? prevSnap.s[0] : null;
  let prevDayLastTs = Date.parse(prevSnap.t);

  for (let i = 1; i < snaps.length; i++) {
    const snap = snaps[i];
    const t = snap.t;
    const ts = Date.parse(t);
    const gapDays = (ts - Date.parse(prevSnap.t)) / DAY_MS;
    const reliable = gapDays <= MAX_TRANSITION_GAP_DAYS;

    // Per-skill milestones — only on observed transitions inside a reliable gap.
    let totalLevel = 0;
    for (let k = 1; k < snap.s.length; k++) {
      const cur = snap.s[k];
      const prev = prevSnap.s[k];
      const lvl = cur >= 0 ? xpToLevel(cur) : 1;
      totalLevel += lvl;

      if (!reliable) continue;
      if (prev < 0 || cur < 0) continue;

      // 99 — fires when prev was below MAX_XP and current is >= MAX_XP.
      if (cur >= MAX_XP && prev < MAX_XP) {
        out.push({
          t,
          rsn: pf.rsn,
          kind: "skill99",
          title: `99 ${SKILLS[k]}`,
          detail: `${pf.rsn} maxed ${SKILLS[k]}`,
          skill: SKILLS[k],
          value: 99,
          weight: 100,
        });
      }

      // Skill-level breakpoints.
      const prevLvl = xpToLevel(prev);
      for (const step of SKILL_LEVEL_STEPS) {
        if (lvl >= step && prevLvl < step) {
          out.push({
            t,
            rsn: pf.rsn,
            kind: "skillLevel",
            title: `Level ${step} ${SKILLS[k]}`,
            detail: pf.rsn,
            skill: SKILLS[k],
            value: step,
            weight: step >= 90 ? 40 : step >= 70 ? 20 : 10,
          });
        }
      }
    }

    if (reliable) {
      // Total level milestones.
      for (const step of TOTAL_LEVEL_STEPS) {
        if (totalLevel >= step && prevTotalLevel < step) {
          out.push({
            t,
            rsn: pf.rsn,
            kind: "totalLevel",
            title: `Total level ${step}`,
            detail: pf.rsn,
            value: step,
            weight: step >= 2000 ? 60 : 25,
          });
        }
      }

      // Total XP milestones.
      const curTotal = snap.s[0];
      const prevTotal = prevSnap.s[0];
      if (curTotal >= 0 && prevTotal >= 0) {
        for (const step of TOTAL_XP_STEPS) {
          if (curTotal >= step && prevTotal < step) {
            out.push({
              t,
              rsn: pf.rsn,
              kind: "totalXp",
              title: `${formatStep(step)} total XP`,
              detail: pf.rsn,
              value: step,
              weight: step >= 1_000_000_000 ? 70 : step >= 200_000_000 ? 35 : 15,
            });
          }
        }
      }
    }

    // Big-day events: a calendar day where overall XP grew by >= threshold,
    // attributed to that calendar day. Requires (a) a previous-day reading,
    // (b) the gap between this snapshot and the last reading of the previous
    // day is small enough to know coverage was continuous.
    const day = Math.floor(ts / DAY_MS);
    if (snap.s[0] >= 0) {
      if (day !== prevDay) {
        if (prevDayLastXp !== null) {
          const dayGap = (ts - prevDayLastTs) / DAY_MS;
          const gain = snap.s[0] - prevDayLastXp;
          if (gain >= BIG_DAY_THRESHOLD && dayGap <= MAX_BIGDAY_GAP_DAYS) {
            const prevDayMs = prevDay * DAY_MS;
            out.push({
              t: new Date(prevDayMs + 23 * 3600_000).toISOString(),
              rsn: pf.rsn,
              kind: "bigDay",
              title: `Big day: ${(gain / 1_000_000).toFixed(1)}M xp`,
              detail: pf.rsn,
              value: gain,
              weight: gain >= 20_000_000 ? 50 : 30,
            });
          }
        }
        prevDay = day;
      }
      prevDayLastXp = snap.s[0];
      prevDayLastTs = ts;
    }

    prevSnap = snap;
    prevTotalLevel = totalLevel;
  }
  return out;
}

function computeTotalLevel(s: number[]): number {
  let total = 0;
  for (let i = 1; i < s.length; i++) total += s[i] >= 0 ? xpToLevel(s[i]) : 1;
  return total;
}

function formatStep(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(n % 1_000_000_000 === 0 ? 0 : 1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(0)}M`;
  return n.toLocaleString();
}

export const MILESTONE_KIND_LABEL: Record<MilestoneKind, string> = {
  skill99: "99s",
  skillLevel: "Level breakpoints",
  totalLevel: "Total level",
  totalXp: "Total XP",
  bigDay: "Big days",
};

export const MILESTONE_KINDS: MilestoneKind[] = [
  "skill99", "totalLevel", "totalXp", "skillLevel", "bigDay",
];
