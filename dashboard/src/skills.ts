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
] as const;

export type SkillName = (typeof SKILLS)[number];

export const TRAINABLE_SKILLS = SKILLS.slice(1);
export const MAX_XP = 13_034_431;
export const TRAINABLE_SKILL_COUNT = TRAINABLE_SKILLS.length;
export const MAX_TOTAL_LEVEL = TRAINABLE_SKILL_COUNT * 99;

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

/** Display palette deterministically per RSN. */
export function colorFor(rsn: string): string {
  // hash → hue
  let h = 0;
  for (let i = 0; i < rsn.length; i++) h = (h * 31 + rsn.charCodeAt(i)) | 0;
  const hue = Math.abs(h) % 360;
  return `hsl(${hue} 70% 60%)`;
}
