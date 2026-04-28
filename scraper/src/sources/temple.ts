import { SKILLS } from "../skills.js";
import type { BackfillPoint } from "./wom.js";

const BASE = "https://templeosrs.com/api/player_datapoints.php";
const UA = "maxdash/0.1 (github.com/TheInsomnolent/maxdash)";

/** One year in seconds — the per-page window we walk backwards. */
const PAGE_WINDOW_SECONDS = 365 * 24 * 3600;

interface TempleResponse {
  data?: Record<string, Record<string, number>> | unknown[];
  error?: string;
}

/**
 * Convert a Temple datestamp ("YYYY-MM-DD HH:MM:SS", UTC server time) to ISO.
 */
function templeDateToIso(d: string): string {
  // Replace space with 'T' and append 'Z' to mark UTC.
  return d.trim().replace(" ", "T") + "Z";
}

function parseTemplePage(
  body: TempleResponse,
): { points: BackfillPoint[]; oldest: string | null } {
  const data = body.data;
  if (!data || Array.isArray(data)) return { points: [], oldest: null };
  const points: BackfillPoint[] = [];
  let oldest: string | null = null;
  for (const [date, skills] of Object.entries(data)) {
    if (!skills || typeof skills !== "object") continue;
    const s = new Array<number>(SKILLS.length).fill(-1);
    let any = false;
    for (let i = 0; i < SKILLS.length; i++) {
      const v = (skills as Record<string, number>)[SKILLS[i]];
      if (typeof v === "number") {
        s[i] = v;
        any = true;
      }
    }
    if (!any) continue;
    points.push({ t: templeDateToIso(date), s });
    if (oldest === null || date < oldest) oldest = date;
  }
  return { points, oldest };
}

/**
 * Fetch historical datapoints from TempleOSRS. Walks backward in ~1-year
 * windows until a page returns no new data or `maxPages` is reached.
 */
export async function fetchTempleDatapoints(
  rsn: string,
  maxPages = 20,
): Promise<BackfillPoint[]> {
  const all: BackfillPoint[] = [];
  let cursor: string | null = null; // Temple-format date string
  for (let page = 0; page < maxPages; page++) {
    const params = new URLSearchParams({
      player: rsn,
      time: String(PAGE_WINDOW_SECONDS),
    });
    if (cursor) params.set("date", cursor);
    const res = await fetch(`${BASE}?${params.toString()}`, {
      headers: { "User-Agent": UA },
    });
    if (!res.ok) {
      if (page === 0) return [];
      break;
    }
    const body = (await res.json().catch(() => ({}))) as TempleResponse;
    const { points, oldest } = parseTemplePage(body);
    if (points.length === 0 || oldest === null) break;
    all.push(...points);
    if (cursor !== null && oldest === cursor) break; // no progress
    cursor = oldest;
    // Polite throttle between Temple pages.
    await new Promise((r) => setTimeout(r, 500));
  }
  return all;
}
