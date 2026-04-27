import { SKILLS } from "./skills.js";

const ENDPOINT =
  "https://secure.runescape.com/m=hiscore_oldschool/index_lite.json";

export interface HiscoresSnapshot {
  /** XP per skill, indexed by SKILLS order (0 = Overall). */
  xp: number[];
  /** Rank per skill, indexed by SKILLS order. -1 = unranked. */
  rank: number[];
  /** Level per skill, as reported by the API (Overall = total level). */
  level: number[];
}

export class HiscoresError extends Error {
  constructor(
    public readonly rsn: string,
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Fetch one player's Hiscores snapshot. Throws HiscoresError on 404 / 5xx. */
export async function fetchHiscores(rsn: string): Promise<HiscoresSnapshot> {
  const url = `${ENDPOINT}?player=${encodeURIComponent(rsn)}`;
  const res = await fetch(url, {
    headers: { "User-Agent": "maxdash/0.1 (github.com/TheInsomnolent/maxdash)" },
  });
  if (!res.ok) {
    throw new HiscoresError(
      rsn,
      res.status,
      `Hiscores returned ${res.status} for "${rsn}"`,
    );
  }
  const body = (await res.json()) as {
    skills: Array<{ id: number; name: string; rank: number; level: number; xp: number }>;
  };

  const xp = new Array<number>(SKILLS.length).fill(-1);
  const rank = new Array<number>(SKILLS.length).fill(-1);
  const level = new Array<number>(SKILLS.length).fill(-1);

  for (const s of body.skills) {
    // The API returns skills in ID order matching SKILLS exactly, but we
    // align by name defensively in case the order ever changes.
    const idx = SKILLS.indexOf(s.name as (typeof SKILLS)[number]);
    if (idx < 0) continue;
    xp[idx] = s.xp;
    rank[idx] = s.rank;
    level[idx] = s.level;
  }
  return { xp, rank, level };
}

/** Sleep helper to throttle between players. */
export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
