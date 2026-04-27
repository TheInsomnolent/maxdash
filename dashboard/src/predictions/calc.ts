import { MAX_XP, xpForLevel, xpToLevel } from "../skills";
import type { PlayerFile } from "../store";
import type { MethodTier, SkillMethod } from "./methods";

/** Linear regression result from a player's recent samples for a single skill. */
export interface Regression {
  /** XP per millisecond. Always > 0; null when no positive trend. */
  slope: number;
  /** XP at the last observed sample. */
  lastXp: number;
  /** Timestamp (ms) of the last observed sample. */
  lastT: number;
}

/**
 * Fit `xp = slope * t + b` over the player's snapshots in the last `windowDays`.
 * Returns null if there's no positive trend (e.g. player is afk or already maxed).
 */
export function regressForSkill(
  pf: PlayerFile,
  skillIdx: number,
  windowDays = 14,
): Regression | null {
  const cutoff = Date.now() - windowDays * 86400_000;
  const pts = pf.snapshots
    .filter((s) => Date.parse(s.t) >= cutoff && s.s[skillIdx] >= 0)
    .map((s) => ({ x: Date.parse(s.t), y: s.s[skillIdx] }));
  if (pts.length < 2) return null;
  const n = pts.length;
  const meanX = pts.reduce((a, p) => a + p.x, 0) / n;
  const meanY = pts.reduce((a, p) => a + p.y, 0) / n;
  let num = 0;
  let den = 0;
  for (const p of pts) {
    num += (p.x - meanX) * (p.y - meanY);
    den += (p.x - meanX) ** 2;
  }
  if (den === 0) return null;
  const slope = num / den;
  if (slope <= 0) return null;
  const last = pts[pts.length - 1];
  return { slope, lastXp: last.y, lastT: last.x };
}

/**
 * Project a player's regression line forward to `targetXp`. Returns the time
 * (ms since epoch) at which the line would cross the target, or null if
 * already past it.
 */
export function regressionEtaTs(reg: Regression, targetXp: number): number | null {
  if (reg.lastXp >= targetXp) return null;
  const remaining = targetXp - reg.lastXp;
  return reg.lastT + remaining / reg.slope;
}

/**
 * Forward-simulate XP growth from `currentXp` using a list of method tiers.
 * Returns an array of `{t, xp}` samples where t is ms since epoch.
 *
 * Sampling strategy: emit a point at every tier boundary plus the start and
 * the moment of hitting `targetXp`. This is enough to render a piecewise-linear
 * curve in Recharts.
 */
export function simulateMethod(
  startTs: number,
  startXp: number,
  tiers: readonly MethodTier[],
  targetXp = MAX_XP,
): Array<{ t: number; xp: number }> {
  if (startXp >= targetXp) return [{ t: startTs, xp: startXp }];
  const sortedTiers = [...tiers].sort((a, b) => a.minLvl - b.minLvl);
  const out: Array<{ t: number; xp: number }> = [{ t: startTs, xp: startXp }];
  let xp = startXp;
  let t = startTs;
  while (xp < targetXp) {
    const lvl = xpToLevel(xp);
    // Highest tier the player currently qualifies for.
    let activeIdx = -1;
    for (let i = 0; i < sortedTiers.length; i++) {
      if (sortedTiers[i].minLvl <= lvl) activeIdx = i;
      else break;
    }
    if (activeIdx === -1) {
      // Below the floor of any tier — bail with what we have.
      break;
    }
    const active = sortedTiers[activeIdx];
    const next = sortedTiers[activeIdx + 1];
    // The next checkpoint is either the next tier's unlock or the final target.
    const checkpointXp = next ? Math.min(targetXp, xpForLevel(next.minLvl)) : targetXp;
    if (active.xpPerHour <= 0) break;
    const hours = (checkpointXp - xp) / active.xpPerHour;
    t += hours * 3600_000;
    xp = checkpointXp;
    out.push({ t, xp });
  }
  return out;
}

/**
 * For a single (player, skill, method) build the sample list that should be
 * plotted. Returns null when the player has already maxed the skill.
 */
export function methodProjection(
  pf: PlayerFile,
  skillIdx: number,
  method: SkillMethod,
): Array<{ t: number; xp: number }> | null {
  const last = pf.snapshots.at(-1);
  if (!last) return null;
  const xp = last.s[skillIdx];
  if (xp < 0 || xp >= MAX_XP) return null;
  return simulateMethod(Date.parse(last.t), xp, method.tiers, MAX_XP);
}

/** Convert a samples list to days-from-now horizontal axis values. */
export function toDaysFromNow(samples: Array<{ t: number; xp: number }>): Array<{ d: number; xp: number }> {
  const now = Date.now();
  return samples.map((s) => ({ d: (s.t - now) / 86400_000, xp: s.xp }));
}
