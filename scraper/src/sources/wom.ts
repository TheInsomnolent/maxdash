import { SKILLS, WOM_SKILL_KEYS } from "../skills.js";

const BASE = "https://api.wiseoldman.net/v2";
const UA = "maxdash/0.1 (github.com/TheInsomnolent/maxdash)";

export interface BackfillPoint {
  /** ISO timestamp. */
  t: string;
  /** XP per skill, indexed by SKILLS order. */
  s: number[];
}

interface WomSkill {
  metric: string;
  experience: number;
}

interface WomSnapshot {
  createdAt: string;
  importedAt: string | null;
  data: { skills: Record<string, WomSkill> };
}

/**
 * Register / update a player on Wise Old Man. On first registration this
 * triggers WOM's automatic CML history import. Errors that mean "already
 * tracked" or "on cooldown" are tolerated as success.
 */
export async function registerWomPlayer(rsn: string): Promise<void> {
  const res = await fetch(`${BASE}/players/${encodeURIComponent(rsn)}`, {
    method: "POST",
    headers: { "User-Agent": UA },
  });
  if (res.ok) return;
  // 400 = invalid username / not on hiscores; 429 = update cooldown.
  // 500 sometimes returned for already-recently-updated players. Treat as
  // non-fatal — we still try to read existing snapshots.
  if (res.status === 400 || res.status === 429 || res.status === 500) return;
  throw new Error(
    `WOM register ${rsn}: HTTP ${res.status} ${await res.text().catch(() => "")}`,
  );
}

/**
 * Fetch all available historical snapshots for a player. Returns an empty
 * array if the player isn't tracked on WOM.
 */
export async function fetchWomSnapshots(rsn: string): Promise<BackfillPoint[]> {
  // Wide window: OSRS launched 2013-02-22; future date covers everything up to now.
  const url =
    `${BASE}/players/${encodeURIComponent(rsn)}/snapshots` +
    `?startDate=2013-01-01T00:00:00.000Z&endDate=2100-01-01T00:00:00.000Z`;
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (res.status === 404) return [];
  if (!res.ok) {
    throw new Error(`WOM snapshots ${rsn}: HTTP ${res.status}`);
  }
  const body = (await res.json()) as WomSnapshot[];
  const out: BackfillPoint[] = [];
  for (const snap of body) {
    const s = new Array<number>(SKILLS.length).fill(-1);
    let any = false;
    for (let i = 0; i < WOM_SKILL_KEYS.length; i++) {
      const sk = snap.data?.skills?.[WOM_SKILL_KEYS[i]];
      if (sk && typeof sk.experience === "number") {
        s[i] = sk.experience;
        any = true;
      }
    }
    if (any) out.push({ t: snap.createdAt, s });
  }
  return out;
}
