import { SKILLS, TRAINABLE_SKILLS, type SkillName } from "./skills";

/**
 * Tears of Guthix awards XP into the player's lowest-XP skill. Some skills
 * (notably Sailing) are gated behind quests / not yet released for some
 * accounts, so eligibility is user-configurable. The default leaves Sailing
 * out so the tool matches what most accounts actually experience.
 */
const QUEST_LOCKED_DEFAULT_OFF: readonly SkillName[] = ["Sailing"];

export const DEFAULT_ELIGIBLE_SKILLS: readonly SkillName[] = TRAINABLE_SKILLS.filter(
  (s) => !QUEST_LOCKED_DEFAULT_OFF.includes(s),
);

const STORAGE_KEY = "maxdash:tears:eligible";

export function loadEligibleSkills(): Set<SkillName> {
  if (typeof window === "undefined") return new Set(DEFAULT_ELIGIBLE_SKILLS);
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set(DEFAULT_ELIGIBLE_SKILLS);
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set(DEFAULT_ELIGIBLE_SKILLS);
    const valid = parsed.filter(
      (x): x is SkillName => typeof x === "string" && TRAINABLE_SKILLS.includes(x as SkillName),
    );
    return new Set(valid);
  } catch {
    return new Set(DEFAULT_ELIGIBLE_SKILLS);
  }
}

export function saveEligibleSkills(set: ReadonlySet<SkillName>): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...set]));
}

export interface RankedSkill {
  skill: SkillName;
  xp: number;
}

export interface TearsReport {
  /** The skill the next Tears reward would land in. Null if no eligible skills. */
  lowest: RankedSkill | null;
  /** All eligible skills sorted ascending by current XP. */
  ranked: RankedSkill[];
  /**
   * XP gain in `lowest` before Tears flips to the next-lowest skill — i.e.
   * `secondLowest.xp - lowest.xp`. Null when there's no second-lowest.
   */
  gapToNext: number | null;
  /** Skill that would take over if `lowest` overtakes it. */
  nextSkill: SkillName | null;
}

/** Build a Tears report for a single snapshot (full SKILLS-length XP array). */
export function tearsReportForPlayer(
  snapshotXp: readonly number[],
  eligible: ReadonlySet<SkillName>,
): TearsReport {
  const ranked: RankedSkill[] = [];
  for (let i = 1; i < SKILLS.length; i++) {
    const skill = SKILLS[i];
    if (!eligible.has(skill)) continue;
    const xp = snapshotXp[i];
    // Treat unranked as 0 — that's what Tears actually sees.
    ranked.push({ skill, xp: xp < 0 ? 0 : xp });
  }
  ranked.sort((a, b) => a.xp - b.xp || a.skill.localeCompare(b.skill));
  const lowest = ranked[0] ?? null;
  const second = ranked[1] ?? null;
  return {
    lowest,
    ranked,
    gapToNext: lowest && second ? second.xp - lowest.xp : null,
    nextSkill: second?.skill ?? null,
  };
}

export interface TopUpRow {
  skill: SkillName;
  currentXp: number;
  xpNeeded: number;
}

export type RedirectResult =
  | { kind: "ineligible"; reason: string }
  | { kind: "alreadyLowest"; targetXp: number }
  | { kind: "topUps"; targetXp: number; rows: TopUpRow[]; totalXpNeeded: number };

/**
 * Compute the per-skill XP top-ups required in every eligible skill that's
 * currently at or below `targetSkill`'s XP, such that the target becomes the
 * strict minimum (and thus the Tears reward target). The `+1` ensures strict
 * inequality even when XP values tie.
 */
export function topUpsToRedirect(
  snapshotXp: readonly number[],
  eligible: ReadonlySet<SkillName>,
  targetSkill: SkillName,
): RedirectResult {
  if (!eligible.has(targetSkill)) {
    return { kind: "ineligible", reason: `${targetSkill} is not in the eligible set.` };
  }
  const targetIdx = SKILLS.indexOf(targetSkill);
  if (targetIdx < 1) return { kind: "ineligible", reason: `Unknown skill ${targetSkill}.` };
  const rawTargetXp = snapshotXp[targetIdx];
  const targetXp = rawTargetXp < 0 ? 0 : rawTargetXp;

  const rows: TopUpRow[] = [];
  for (let i = 1; i < SKILLS.length; i++) {
    const skill = SKILLS[i];
    if (skill === targetSkill) continue;
    if (!eligible.has(skill)) continue;
    const raw = snapshotXp[i];
    const xp = raw < 0 ? 0 : raw;
    if (xp <= targetXp) {
      rows.push({ skill, currentXp: xp, xpNeeded: targetXp - xp + 1 });
    }
  }
  if (rows.length === 0) {
    return { kind: "alreadyLowest", targetXp };
  }
  rows.sort((a, b) => a.xpNeeded - b.xpNeeded || a.skill.localeCompare(b.skill));
  const totalXpNeeded = rows.reduce((sum, r) => sum + r.xpNeeded, 0);
  return { kind: "topUps", targetXp, rows, totalXpNeeded };
}
