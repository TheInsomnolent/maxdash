import { MAX_XP, TRAINABLE_SKILLS, type SkillName } from "./skills";

/**
 * Reference XP rates (xp/hr) for every trainable skill at high levels with
 * optimal setups, used to turn "XP remaining" into "hours remaining".
 *
 * - `afk`: low-attention method you can run while doing something else.
 * - `active`: high-effort ("sweaty") method with full attention.
 *
 * Where the source quotes a range, the midpoint is used. Farming rates are
 * *effective* rates: the XP earned per hour of time actually spent doing runs.
 * Hunter's AFK entry is birdhouse runs (~4.5k XP per run, one run roughly
 * every 50 minutes), expressed here as XP per elapsed hour.
 */
export interface SkillXpRate {
  afk: number;
  afkMethod: string;
  active: number;
  activeMethod: string;
}

export type TrainableSkillName = Exclude<SkillName, "Overall">;

export const XP_RATES: Record<TrainableSkillName, SkillXpRate> = {
  Attack: { afk: 130_000, afkMethod: "Gemstone Crab", active: 130_000, activeMethod: "Gemstone Crab" },
  Defence: { afk: 130_000, afkMethod: "Gemstone Crab", active: 450_000, activeMethod: "Black Chinning" },
  Strength: { afk: 130_000, afkMethod: "Gemstone Crab", active: 130_000, activeMethod: "Gemstone Crab" },
  Hitpoints: { afk: 43_000, afkMethod: "Gemstone Crab", active: 350_000, activeMethod: "Black Chinning" },
  Ranged: { afk: 130_000, afkMethod: "Gemstone Crab", active: 950_000, activeMethod: "Black Chinning" },
  Prayer: { afk: 375_000, afkMethod: "Ensouled Dragon Heads", active: 1_350_000, activeMethod: "Superior Dragon Bones" },
  Magic: { afk: 95_000, afkMethod: "Gemstone Crab", active: 375_000, activeMethod: "Barraging Maniacal Monkeys" },
  Cooking: { afk: 290_000, afkMethod: "Normal Karambwans", active: 950_000, activeMethod: "1-tick Karambwans" },
  Woodcutting: { afk: 70_000, afkMethod: "Redwoods", active: 210_000, activeMethod: "Bloodwood Trees" },
  Fletching: { afk: 350_000, afkMethod: "Vale Totems", active: 1_350_000, activeMethod: "Darts" },
  Fishing: { afk: 42_500, afkMethod: "Karambwans", active: 115_000, activeMethod: "3t Barbarian Fishing" },
  Firemaking: { afk: 110_000, afkMethod: "Bonfires", active: 310_000, activeMethod: "Wintertodt" },
  Crafting: { afk: 185_000, afkMethod: "Wyrmscrag Golems", active: 425_000, activeMethod: "Black D'hide Bodies" },
  Smithing: { afk: 275_000, afkMethod: "Platebodies", active: 390_000, activeMethod: "Blast Furnace" },
  Mining: { afk: 27_500, afkMethod: "Shooting Stars", active: 125_000, activeMethod: "3t4g Granite" },
  Herblore: { afk: 70_000, afkMethod: "Mastering Mixology", active: 425_000, activeMethod: "Super Combats" },
  Agility: { afk: 68_000, afkMethod: "Colossal Wyrm Course", active: 92_500, activeMethod: "Hallowed Sepulchre" },
  Thieving: { afk: 250_000, afkMethod: "Port Roberts Stalls", active: 400_000, activeMethod: "Rogues Chest" },
  Slayer: { afk: 30_000, afkMethod: "Bossing", active: 90_000, activeMethod: "Bursting/Barraging" },
  Farming: { afk: 215_000, afkMethod: "Herb Runs (2/day)", active: 1_270_000, activeMethod: "Tree Runs (1/day)" },
  Runecraft: { afk: 38_000, afkMethod: "Zeah Bloods", active: 77_500, activeMethod: "Lava Runes" },
  Hunter: { afk: 5_400, afkMethod: "Birdhouses", active: 210_000, activeMethod: "Black Chins" },
  Construction: { afk: 235_000, afkMethod: "Mahogany Homes", active: 950_000, activeMethod: "Mahogany Tables" },
  Sailing: { afk: 100_000, afkMethod: "Salvaging", active: 215_000, activeMethod: "Gwennith Glide" },
};

export type RateMode = "afk" | "active";

/** Hours left to reach 99 in one skill at the given cadence. */
export function hoursToMaxSkill(skill: TrainableSkillName, xp: number, mode: RateMode): number {
  // Unranked players (xp === -1) are treated as having no XP at all.
  const remaining = MAX_XP - Math.max(0, xp);
  if (remaining <= 0) return 0;
  return remaining / XP_RATES[skill][mode];
}

/**
 * Total hours left for a player to max, given a hiscores snapshot row
 * (index 0 is Overall, indices 1..n follow `TRAINABLE_SKILLS`).
 */
export function hoursToMax(snapshot: readonly number[], mode: RateMode): number {
  return TRAINABLE_SKILLS.reduce(
    (sum, skill, i) => sum + hoursToMaxSkill(skill as TrainableSkillName, snapshot[i + 1] ?? -1, mode),
    0,
  );
}

/** Compact display for an hour count ("0h", "127h", "1,204h"). */
export function formatHours(hours: number): string {
  return `${Math.round(hours).toLocaleString()}h`;
}
