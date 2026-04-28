// Canonical OSRS skill list in the order returned by the official Hiscores
// `index_lite` endpoints. Index 0 is the synthetic "Overall" aggregate.
// Reference: https://oldschool.runescape.wiki/w/Application_programming_interface
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

/**
 * Skill metric keys used by the Wise Old Man API, indexed in the same order as
 * `SKILLS`. Lowercased; note WOM uses `runecrafting` rather than `runecraft`.
 */
export const WOM_SKILL_KEYS: readonly string[] = [
  "overall",
  "attack",
  "defence",
  "strength",
  "hitpoints",
  "ranged",
  "prayer",
  "magic",
  "cooking",
  "woodcutting",
  "fletching",
  "fishing",
  "firemaking",
  "crafting",
  "smithing",
  "mining",
  "herblore",
  "agility",
  "thieving",
  "slayer",
  "farming",
  "runecrafting",
  "hunter",
  "construction",
];

/** XP cap per skill (level 99). */
export const MAX_XP = 13_034_431;
/** Number of trainable skills (excludes the synthetic "Overall"). */
export const TRAINABLE_SKILL_COUNT = SKILLS.length - 1;
/** Sum of every trainable skill at 99. */
export const MAX_TOTAL_LEVEL = TRAINABLE_SKILL_COUNT * 99; // 2277

/**
 * Cumulative XP required for each level 1..99 (and 100 for the cap boundary).
 * Computed once at module load using the standard OSRS formula.
 */
export const XP_TABLE: number[] = (() => {
  const table: number[] = [0]; // level 1 = 0 xp
  let points = 0;
  for (let lvl = 1; lvl < 99; lvl++) {
    points += Math.floor(lvl + 300 * Math.pow(2, lvl / 7));
    table.push(Math.floor(points / 4));
  }
  return table;
})();

/** Convert XP to a level in the 1..99 range (capped at 99). */
export function xpToLevel(xp: number): number {
  if (xp <= 0) return 1;
  if (xp >= MAX_XP) return 99;
  // binary search for largest level whose threshold <= xp
  let lo = 1;
  let hi = 99;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if (XP_TABLE[mid - 1] <= xp) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}
