/**
 * Method definitions for skill XP/hr models. Each method has a list of
 * level-gated tiers; the model assumes the player switches to the highest tier
 * they qualify for. xpPerHour values are sourced from the OSRS wiki training
 * pages and are deliberately rounded to whole-thousand sustained averages —
 * not theoretical peaks. Each skill can declare any number of strategies with
 * arbitrary names (e.g. Mining → AFK / Sweaty; Crafting → Profitable /
 * Quickest / Balanced).
 *
 * Sources:
 *   Mining       — https://oldschool.runescape.wiki/w/Pay-to-play_Mining_training
 *   Crafting     — https://oldschool.runescape.wiki/w/Pay-to-play_Crafting_training
 *   Agility      — https://oldschool.runescape.wiki/w/Agility_training
 *   Construction — https://oldschool.runescape.wiki/w/Construction_training
 *   Cooking      — https://oldschool.runescape.wiki/w/Pay-to-play_Cooking_training
 */

export interface MethodTier {
  /** Inclusive minimum level required to use this tier. */
  minLvl: number;
  /** Sustained XP per hour while the player is in this tier. */
  xpPerHour: number;
  /** Short label e.g. "MLM" or "3t granite" — shown in tooltips. */
  label: string;
}

export interface SkillMethod {
  /** Human-friendly strategy name ("AFK", "Profitable", "Quickest", …). */
  name: string;
  /** One-liner describing the path. */
  description: string;
  /** Optional override color for the line; falls back to a hashed palette. */
  color?: string;
  /** Tiers in ascending minLvl order. */
  tiers: MethodTier[];
}

/** Methods keyed by skill name. Skills not yet modelled simply omit entries. */
export const SKILL_METHODS: Record<string, SkillMethod[]> = {
  Mining: [
    {
      name: "AFK",
      color: "#4fc3f7",
      description: "Tin/copper → AFK iron rocks → Motherlode Mine the rest of the way.",
      tiers: [
        { minLvl: 1, xpPerHour: 10_000, label: "Copper / tin (Varrock east)" },
        { minLvl: 15, xpPerHour: 18_000, label: "AFK iron rocks (Al Kharid)" },
        { minLvl: 30, xpPerHour: 35_000, label: "Motherlode Mine (lower)" },
        { minLvl: 72, xpPerHour: 55_000, label: "Motherlode Mine (upper)" },
      ],
    },
    {
      name: "Sweaty",
      color: "#e57373",
      description: "Powermine copper → 3-tick iron → 3-tick granite at Bandit Camp.",
      tiers: [
        { minLvl: 1, xpPerHour: 22_000, label: "Powermine copper" },
        { minLvl: 15, xpPerHour: 90_000, label: "3-tick iron (Quarry)" },
        { minLvl: 75, xpPerHour: 115_000, label: "3-tick granite (Bandit Camp)" },
      ],
    },
  ],

  Crafting: [
    {
      name: "Profitable",
      color: "#81c784",
      description: "Drift nets → dragonstone jewellery → superglass make → cut amethyst.",
      tiers: [
        { minLvl: 5, xpPerHour: 21_000, label: "Gold rings & necklaces" },
        { minLvl: 26, xpPerHour: 60_000, label: "Drift nets (Fossil Island)" },
        { minLvl: 55, xpPerHour: 140_000, label: "Dragonstone jewellery" },
        { minLvl: 61, xpPerHour: 130_000, label: "Superglass Make (giant seaweed)" },
        { minLvl: 83, xpPerHour: 165_000, label: "Cut amethyst" },
      ],
    },
    {
      name: "Quickest",
      color: "#ffb74d",
      description: "Leather → cut gems → battlestaves → black d'hide bodies.",
      tiers: [
        { minLvl: 1, xpPerHour: 200_000, label: "Leather items" },
        { minLvl: 20, xpPerHour: 139_000, label: "Cut sapphires" },
        { minLvl: 27, xpPerHour: 180_000, label: "Cut emeralds" },
        { minLvl: 34, xpPerHour: 220_000, label: "Cut rubies" },
        { minLvl: 43, xpPerHour: 298_000, label: "Cut diamonds" },
        { minLvl: 66, xpPerHour: 336_000, label: "Air battlestaves" },
        { minLvl: 77, xpPerHour: 400_000, label: "Red d'hide bodies" },
        { minLvl: 84, xpPerHour: 460_000, label: "Black d'hide bodies (tick manip)" },
      ],
    },
    {
      name: "Balanced",
      color: "#ba68c8",
      description: "Molten glass → unpowered orbs → goblin lamps → low-focus superglass.",
      tiers: [
        { minLvl: 1, xpPerHour: 30_000, label: "Molten glass items" },
        { minLvl: 46, xpPerHour: 52_500, label: "Unpowered orbs" },
        { minLvl: 52, xpPerHour: 90_000, label: "Goblin lamps (Dorgesh-Kaan)" },
        { minLvl: 61, xpPerHour: 90_000, label: "Low-focus Superglass Make" },
      ],
    },
  ],

  Agility: [
    {
      name: "AFK",
      color: "#4fc3f7",
      description: "Rooftop courses end-to-end — long loops, minimal clicks.",
      tiers: [
        { minLvl: 1, xpPerHour: 7_000, label: "Draynor rooftop" },
        { minLvl: 20, xpPerHour: 11_000, label: "Al Kharid rooftop" },
        { minLvl: 30, xpPerHour: 15_000, label: "Varrock rooftop" },
        { minLvl: 40, xpPerHour: 22_000, label: "Canifis rooftop" },
        { minLvl: 60, xpPerHour: 50_000, label: "Seers' Village rooftop" },
        { minLvl: 80, xpPerHour: 55_000, label: "Rellekka rooftop" },
        { minLvl: 90, xpPerHour: 62_000, label: "Ardougne rooftop" },
      ],
    },
    {
      name: "Quickest",
      color: "#ffb74d",
      description: "Push into Hallowed Sepulchre as soon as floors unlock; loop all available.",
      tiers: [
        { minLvl: 1, xpPerHour: 8_000, label: "Gnome Stronghold course" },
        { minLvl: 20, xpPerHour: 11_000, label: "Al Kharid rooftop" },
        { minLvl: 40, xpPerHour: 22_000, label: "Canifis rooftop" },
        { minLvl: 52, xpPerHour: 45_000, label: "Hallowed Sepulchre F1" },
        { minLvl: 62, xpPerHour: 60_000, label: "Hallowed Sepulchre F1–2" },
        { minLvl: 72, xpPerHour: 80_000, label: "Hallowed Sepulchre F1–3" },
        { minLvl: 82, xpPerHour: 100_000, label: "Hallowed Sepulchre F1–4" },
        { minLvl: 92, xpPerHour: 130_000, label: "Hallowed Sepulchre F1–5" },
      ],
    },
    {
      name: "Marks",
      color: "#81c784",
      description: "Maximise Marks of Grace / Hallowed Marks for graceful & cosmetics.",
      tiers: [
        { minLvl: 1, xpPerHour: 7_000, label: "Draynor rooftop (marks)" },
        { minLvl: 30, xpPerHour: 15_000, label: "Varrock rooftop (marks)" },
        { minLvl: 52, xpPerHour: 30_000, label: "Wilderness Agility course" },
        { minLvl: 60, xpPerHour: 45_000, label: "Seers' rooftop (marks)" },
        { minLvl: 72, xpPerHour: 70_000, label: "Hallowed Sepulchre F1–3" },
        { minLvl: 92, xpPerHour: 110_000, label: "Hallowed Sepulchre F1–5" },
      ],
    },
  ],

  Construction: [
    {
      name: "Cheapest",
      color: "#81c784",
      description: "Mahogany Homes contracts — low gp/xp, decent rates, plank sack friendly.",
      tiers: [
        { minLvl: 1, xpPerHour: 18_000, label: "Mahogany Homes (novice)" },
        { minLvl: 20, xpPerHour: 35_000, label: "Mahogany Homes (adept)" },
        { minLvl: 50, xpPerHour: 55_000, label: "Mahogany Homes (expert)" },
        { minLvl: 70, xpPerHour: 80_000, label: "Mahogany Homes (expert, oak/teak)" },
      ],
    },
    {
      name: "Quickest",
      color: "#ffb74d",
      description: "Plank-sack furniture spam with butler — most expensive, fastest.",
      tiers: [
        { minLvl: 1, xpPerHour: 25_000, label: "Crude wooden chairs" },
        { minLvl: 17, xpPerHour: 50_000, label: "Oak chairs" },
        { minLvl: 33, xpPerHour: 130_000, label: "Oak larders" },
        { minLvl: 52, xpPerHour: 340_000, label: "Mahogany tables (butler)" },
        { minLvl: 74, xpPerHour: 600_000, label: "Mahogany benches" },
        { minLvl: 84, xpPerHour: 900_000, label: "Gnome benches (MM2)" },
      ],
    },
    {
      name: "Balanced",
      color: "#ba68c8",
      description: "Oak larders → mahogany tables; profitable mythical capes endgame.",
      tiers: [
        { minLvl: 1, xpPerHour: 25_000, label: "Crude wooden chairs" },
        { minLvl: 33, xpPerHour: 120_000, label: "Oak larders" },
        { minLvl: 52, xpPerHour: 320_000, label: "Mahogany tables (butler)" },
        { minLvl: 60, xpPerHour: 400_000, label: "Mythical capes (cheap, profit)" },
      ],
    },
  ],

  Cooking: [
    {
      name: "Profitable",
      color: "#81c784",
      description: "Hosidius range fish progression: lobster → monkfish → shark → anglerfish.",
      tiers: [
        { minLvl: 1, xpPerHour: 40_000, label: "Shrimp / sardine / trout" },
        { minLvl: 30, xpPerHour: 120_000, label: "Tuna" },
        { minLvl: 40, xpPerHour: 160_000, label: "Lobster" },
        { minLvl: 62, xpPerHour: 200_000, label: "Monkfish (Hosidius)" },
        { minLvl: 80, xpPerHour: 290_000, label: "Shark (Hosidius)" },
        { minLvl: 84, xpPerHour: 320_000, label: "Anglerfish (Hosidius)" },
      ],
    },
    {
      name: "Quickest",
      color: "#ffb74d",
      description: "Wines, then 1-tick karambwans at the Rogues' Den.",
      tiers: [
        { minLvl: 1, xpPerHour: 60_000, label: "Trout / salmon" },
        { minLvl: 35, xpPerHour: 480_000, label: "Jugs of wine" },
        { minLvl: 70, xpPerHour: 740_000, label: "1-tick karambwan" },
        { minLvl: 80, xpPerHour: 810_000, label: "1-tick karambwan" },
        { minLvl: 90, xpPerHour: 880_000, label: "1-tick karambwan" },
      ],
    },
    {
      name: "AFK",
      color: "#4fc3f7",
      description: "Cooked karambwans at Hosidius range — 0% burn with diary, very chill.",
      tiers: [
        { minLvl: 1, xpPerHour: 40_000, label: "Shrimp / sardine / trout" },
        { minLvl: 30, xpPerHour: 160_000, label: "Karambwan (Hosidius, AFK)" },
        { minLvl: 50, xpPerHour: 200_000, label: "Karambwan (Hosidius, AFK)" },
        { minLvl: 70, xpPerHour: 250_000, label: "Karambwan (Hosidius, AFK)" },
      ],
    },
  ],
};
