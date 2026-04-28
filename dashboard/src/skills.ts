/** Skill names in API order. Index 0 is the synthetic Overall aggregate. */
export const SKILLS = [
  "Overall",
  "Attack",
  "Defence",
  "Strength",
  "Hitpoints",
  "Ranged",
  "Prayer",
  "Magic",
  "Cooking",
  "Woodcutting",
  "Fletching",
  "Fishing",
  "Firemaking",
  "Crafting",
  "Smithing",
  "Mining",
  "Herblore",
  "Agility",
  "Thieving",
  "Slayer",
  "Farming",
  "Runecraft",
  "Hunter",
  "Construction",
  "Sailing",
] as const;

export type SkillName = (typeof SKILLS)[number];

export const TRAINABLE_SKILLS = SKILLS.slice(1);
export const MAX_XP = 13_034_431;
export const TRAINABLE_SKILL_COUNT = TRAINABLE_SKILLS.length;
export const MAX_TOTAL_LEVEL = TRAINABLE_SKILL_COUNT * 99;
/**
 * Canonical "max total XP" as reported by OSRS Hiscores. The Overall row is
 * counted in addition to the 23 trainable skills, giving 24 × MAX_XP.
 */
export const MAX_TOTAL_XP = 24 * MAX_XP;

const XP_TABLE: number[] = (() => {
  const t: number[] = [0];
  let pts = 0;
  for (let lvl = 1; lvl < 99; lvl++) {
    pts += Math.floor(lvl + 300 * Math.pow(2, lvl / 7));
    t.push(Math.floor(pts / 4));
  }
  return t;
})();

export function xpToLevel(xp: number): number {
  if (xp <= 0) return 1;
  if (xp >= MAX_XP) return 99;
  let lo = 1;
  let hi = 99;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if (XP_TABLE[mid - 1] <= xp) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export function xpForLevel(level: number): number {
  if (level <= 1) return 0;
  if (level >= 99) return MAX_XP;
  return XP_TABLE[level - 1];
}

/**
 * 16 hand-tuned, perceptually distinct hues that read well on the dark wood
 * background. Ordering is intentional — adjacent slots are far apart in hue
 * and lightness so a small roster gets maximum contrast.
 */
const PALETTE: readonly string[] = [
  "#ffb43b", // amber (OSRS accent)
  "#4fc3f7", // sky blue
  "#e57373", // coral red
  "#81c784", // mint green
  "#ba68c8", // violet
  "#ffd54f", // pale yellow
  "#4dd0e1", // cyan
  "#f06292", // pink
  "#aed581", // lime
  "#9575cd", // lavender
  "#ff8a65", // salmon
  "#64b5f6", // blue
  "#dce775", // chartreuse
  "#a1887f", // taupe
  "#7986cb", // periwinkle
  "#ff7043", // orange
];

/** Stable color assignments registered by the data loader (sorted RSN ⇒ slot). */
const colorMap = new Map<string, string>();

/**
 * Register the full roster so colors are deterministic per RSN AND
 * collision-free across the known set. Idempotent.
 */
export function registerPlayerColors(rsns: readonly string[]): void {
  const sorted = [...rsns].sort();
  colorMap.clear();
  sorted.forEach((rsn, i) => {
    colorMap.set(rsn, PALETTE[i % PALETTE.length]);
  });
}

/** Display palette deterministically per RSN. */
export function colorFor(rsn: string): string {
  const known = colorMap.get(rsn);
  if (known) return known;
  // Fallback for unknown RSNs: FNV-1a hash → palette slot.
  let h = 0x811c9dc5;
  for (let i = 0; i < rsn.length; i++) {
    h ^= rsn.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return PALETTE[Math.abs(h) % PALETTE.length];
}
