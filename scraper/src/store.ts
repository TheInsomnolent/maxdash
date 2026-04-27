import { promises as fs } from "node:fs";
import path from "node:path";
import type { HiscoresSnapshot } from "./hiscores.js";

export interface PlayerFile {
  rsn: string;
  firstSeen: string;
  /** Compact snapshots. `t` = ISO timestamp, `s` = XP per skill (SKILLS order). */
  snapshots: Array<{ t: string; s: number[] }>;
}

/** Sanitize an RSN into a filesystem-safe filename (lowercase, _ for spaces). */
export function rsnToFile(rsn: string): string {
  return rsn.trim().toLowerCase().replace(/\s+/g, "_") + ".json";
}

export async function readPlayerFile(
  dataDir: string,
  rsn: string,
): Promise<PlayerFile | null> {
  const file = path.join(dataDir, rsnToFile(rsn));
  try {
    const raw = await fs.readFile(file, "utf8");
    return JSON.parse(raw) as PlayerFile;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

export async function writePlayerFile(
  dataDir: string,
  pf: PlayerFile,
): Promise<void> {
  const file = path.join(dataDir, rsnToFile(pf.rsn));
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(file, JSON.stringify(pf) + "\n", "utf8");
}

/**
 * Append a snapshot, deduplicating against the previous one if XP is identical
 * across every skill (idle hour). Returns true if a new entry was appended.
 */
export function appendSnapshot(
  pf: PlayerFile,
  ts: string,
  snap: HiscoresSnapshot,
): boolean {
  const last = pf.snapshots.at(-1);
  const same =
    last &&
    last.s.length === snap.xp.length &&
    last.s.every((v, i) => v === snap.xp[i]);
  if (same) return false;
  pf.snapshots.push({ t: ts, s: snap.xp });
  return true;
}
