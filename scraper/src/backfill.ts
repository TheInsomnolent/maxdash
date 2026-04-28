import { SKILLS } from "./skills.js";
import { sleep } from "./hiscores.js";
import {
  readPlayerFile,
  rsnToFile,
  writePlayerFile,
  type PlayerFile,
} from "./store.js";
import {
  fetchWomSnapshots,
  registerWomPlayer,
  type BackfillPoint,
} from "./sources/wom.js";
import { fetchTempleDatapoints } from "./sources/temple.js";

export interface BackfillOptions {
  /** Max pages of Temple datapoints to walk backwards. Default 20. */
  templePages?: number;
  /** Skip Temple fetch entirely. */
  skipTemple?: boolean;
  /** Skip WOM fetch entirely. */
  skipWom?: boolean;
}

export interface BackfillResult {
  rsn: string;
  womCount: number;
  templeCount: number;
  before: number;
  after: number;
  added: number;
  earliest: string | null;
}

/** Bucket a timestamp to minute precision for cross-source dedup. */
function dedupKey(iso: string): string {
  // Trim seconds + ms: "2025-04-01T12:34:56.789Z" -> "2025-04-01T12:34"
  // Falls back to first 16 chars which is YYYY-MM-DDTHH:MM regardless of zone.
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 16);
  return d.toISOString().slice(0, 16);
}

/**
 * Merge a set of incoming points into a player file. Existing snapshots always
 * win on timestamp conflict (minute precision). Points are sorted ascending by
 * timestamp. Adjacent duplicates with identical XP arrays are dropped to keep
 * the same invariant `appendSnapshot` enforces for the live job.
 */
export function mergeIntoPlayerFile(
  pf: PlayerFile,
  womPoints: BackfillPoint[],
  templePoints: BackfillPoint[],
): number {
  const seen = new Map<string, BackfillPoint>();
  // Priority: existing > WOM > Temple. Insert in that order; first writer wins.
  for (const p of pf.snapshots) {
    seen.set(dedupKey(p.t), p);
  }
  for (const p of womPoints) {
    const k = dedupKey(p.t);
    if (!seen.has(k)) seen.set(k, p);
  }
  for (const p of templePoints) {
    const k = dedupKey(p.t);
    if (!seen.has(k)) seen.set(k, p);
  }

  const merged = [...seen.values()].sort((a, b) =>
    a.t < b.t ? -1 : a.t > b.t ? 1 : 0,
  );

  // Drop adjacent identical-XP entries (same invariant as appendSnapshot).
  const collapsed: PlayerFile["snapshots"] = [];
  for (const p of merged) {
    const prev = collapsed.at(-1);
    const same =
      prev &&
      prev.s.length === p.s.length &&
      prev.s.every((v, i) => v === p.s[i]);
    if (!same) collapsed.push({ t: p.t, s: p.s });
  }

  const added = collapsed.length - pf.snapshots.length;
  pf.snapshots = collapsed;
  if (collapsed.length > 0) {
    const first = collapsed[0].t;
    if (first < pf.firstSeen) pf.firstSeen = first;
  }
  return added;
}

/**
 * Backfill a single player from WOM (primary) and TempleOSRS (supplement) and
 * persist the merged file.
 */
export async function backfillPlayer(
  dataDir: string,
  rsn: string,
  opts: BackfillOptions = {},
): Promise<BackfillResult> {
  const ts = new Date().toISOString();
  let pf: PlayerFile = (await readPlayerFile(dataDir, rsn)) ?? {
    rsn,
    firstSeen: ts,
    snapshots: [],
  };
  const before = pf.snapshots.length;

  let womPoints: BackfillPoint[] = [];
  if (!opts.skipWom) {
    try {
      await registerWomPlayer(rsn);
      await sleep(500);
      womPoints = await fetchWomSnapshots(rsn);
    } catch (err) {
      console.warn(
        `[backfill] ${rsn}: WOM error: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    await sleep(500);
  }

  let templePoints: BackfillPoint[] = [];
  if (!opts.skipTemple) {
    try {
      templePoints = await fetchTempleDatapoints(rsn, opts.templePages ?? 20);
    } catch (err) {
      console.warn(
        `[backfill] ${rsn}: Temple error: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  // Filter out garbage points (wrong length / all -1).
  const sane = (p: BackfillPoint) =>
    p.s.length === SKILLS.length && p.s[0] >= 0;
  womPoints = womPoints.filter(sane);
  templePoints = templePoints.filter(sane);

  const added = mergeIntoPlayerFile(pf, womPoints, templePoints);
  await writePlayerFile(dataDir, pf);

  return {
    rsn,
    womCount: womPoints.length,
    templeCount: templePoints.length,
    before,
    after: pf.snapshots.length,
    added,
    earliest: pf.snapshots[0]?.t ?? null,
  };
}

// Re-export so callers don't have to know about subpaths.
export { rsnToFile };
