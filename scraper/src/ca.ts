import { fetchCombatAchievements, RuneProfileError } from "./runeprofile.js";
import {
  applyCaFailure,
  applyCaSnapshot,
  readCaFile,
  rsnToCaFile,
  writeCaFile,
  type CaFile,
  type CaStatus,
} from "./ca-store.js";

/** Combat Achievement summary embedded in each `index.json` player entry. */
export interface CaIndexEntry {
  /** Path of the CA file relative to `data/`. */
  file: string;
  status: CaStatus;
  totalPoints: number;
  tierReached: string | null;
  completed: number;
  total: number;
  /** When the stored CA data last changed. */
  updatedAt: string;
  error?: string;
}

/**
 * Fetch + persist one player's Combat Achievements, returning the index entry.
 * Never throws for RuneProfile or stored-file problems: a player without a
 * linked RuneProfile account is recorded as `unlinked` so the dashboard can
 * prompt them to install the plugin, and an unreadable stored file is treated
 * as absent rather than aborting the whole snapshot run.
 */
export async function snapshotCombatAchievements(
  dataDir: string,
  rsn: string,
  ts: string,
): Promise<CaIndexEntry> {
  let existing: CaFile | null = null;
  try {
    existing = await readCaFile(dataDir, rsn);
  } catch (err) {
    console.warn(
      `\n[ca] ignoring unreadable ${rsnToCaFile(rsn)}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  try {
    const ca = await fetchCombatAchievements(rsn);
    // A 200 with no tasks means RuneProfile hiccuped rather than that the
    // player genuinely has none — never let it overwrite good stored data.
    if (ca.tasks.length === 0) {
      throw new Error("RuneProfile returned no Combat Achievement tasks");
    }
    const { file, changed } = applyCaSnapshot(existing, rsn, ts, ca);
    if (changed) await writeCaFile(dataDir, file);
    const done = file.tasks.filter((t) => t.completed).length;
    console.log(
      `${file.totalPoints} pts, ${done}/${file.tasks.length} tasks (${changed ? "updated" : "no change"})`,
    );
    return {
      file: rsnToCaFile(rsn),
      status: "ok",
      totalPoints: file.totalPoints,
      tierReached: file.tierReached,
      completed: done,
      total: file.tasks.length,
      updatedAt: file.updatedAt,
    };
  } catch (err) {
    const unlinked = err instanceof RuneProfileError && err.notFound;
    const msg = err instanceof Error ? err.message : String(err);
    const { file, changed } = applyCaFailure(
      existing,
      rsn,
      ts,
      unlinked ? "unlinked" : "error",
      msg,
    );
    if (changed) await writeCaFile(dataDir, file);
    console.log(unlinked ? "not linked to RuneProfile" : `error (${msg})`);
    return {
      file: rsnToCaFile(rsn),
      status: file.status,
      totalPoints: file.totalPoints,
      tierReached: file.tierReached,
      completed: file.tasks.filter((t) => t.completed).length,
      total: file.tasks.length,
      updatedAt: file.updatedAt,
      error: msg,
    };
  }
}
