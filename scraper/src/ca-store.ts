import { promises as fs } from "node:fs";
import path from "node:path";
import type { CaTask, CaTierSummary, RuneProfileCa } from "./runeprofile.js";

export type CaStatus = "ok" | "unlinked" | "error";

export interface CaHistoryPoint {
  /** ISO timestamp. */
  t: string;
  /** Total Combat Achievement points at this time. */
  points: number;
  /** Completed task count per tier, in tier id order (Easy → Grandmaster). */
  completed: number[];
}

export interface CaFile {
  rsn: string;
  status: CaStatus;
  /** When the stored task/tier data last actually changed. */
  updatedAt: string;
  error?: string;
  totalPoints: number;
  tierReached: string | null;
  tiers: CaTierSummary[];
  tasks: CaTask[];
  history: CaHistoryPoint[];
}

/** Directory (relative to the data dir) holding per-player CA files. */
export const CA_DIR = "ca";

export function rsnToCaFile(rsn: string): string {
  return `${CA_DIR}/${rsn.trim().toLowerCase().replace(/\s+/g, "_")}.json`;
}

export async function readCaFile(
  dataDir: string,
  rsn: string,
): Promise<CaFile | null> {
  try {
    const raw = await fs.readFile(path.join(dataDir, rsnToCaFile(rsn)), "utf8");
    return JSON.parse(raw) as CaFile;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

export async function writeCaFile(dataDir: string, cf: CaFile): Promise<void> {
  const file = path.join(dataDir, rsnToCaFile(cf.rsn));
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(cf) + "\n", "utf8");
}

function completedPerTier(ca: RuneProfileCa): number[] {
  return [...ca.tiers]
    .sort((a, b) => a.id - b.id)
    .map((t) => t.completed);
}

function sameHistoryPoint(a: CaHistoryPoint, points: number, completed: number[]) {
  return (
    a.points === points &&
    a.completed.length === completed.length &&
    a.completed.every((v, i) => v === completed[i])
  );
}

/**
 * Merge a freshly fetched CA payload into the stored file.
 *
 * History gets a new datapoint only when the points total or per-tier
 * completion actually moved, so an idle player adds nothing. Returns whether
 * anything changed — callers skip the write when it didn't, keeping the
 * hourly snapshot commits clean.
 */
export function applyCaSnapshot(
  existing: CaFile | null,
  rsn: string,
  ts: string,
  ca: RuneProfileCa,
): { file: CaFile; changed: boolean } {
  const completed = completedPerTier(ca);
  const history = existing?.history ? [...existing.history] : [];
  const last = history.at(-1);
  const movedHistory = !last || !sameHistoryPoint(last, ca.totalPoints, completed);
  if (movedHistory) history.push({ t: ts, points: ca.totalPoints, completed });

  const file: CaFile = {
    rsn,
    status: "ok",
    updatedAt: existing?.updatedAt ?? ts,
    totalPoints: ca.totalPoints,
    tierReached: ca.tierReached,
    tiers: ca.tiers,
    tasks: ca.tasks,
    history,
  };

  const changed =
    movedHistory ||
    !existing ||
    existing.status !== "ok" ||
    existing.error !== undefined ||
    existing.tierReached !== file.tierReached ||
    JSON.stringify(existing.tasks) !== JSON.stringify(file.tasks) ||
    JSON.stringify(existing.tiers) !== JSON.stringify(file.tiers);

  if (changed) file.updatedAt = ts;
  return { file, changed };
}

/**
 * Record a non-OK fetch. Any previously stored tasks are preserved so the
 * dashboard can still render stale data for a player who has since unlinked.
 */
export function applyCaFailure(
  existing: CaFile | null,
  rsn: string,
  ts: string,
  status: Exclude<CaStatus, "ok">,
  error: string,
): { file: CaFile; changed: boolean } {
  const file: CaFile = {
    rsn,
    status,
    updatedAt: existing?.updatedAt ?? ts,
    error,
    totalPoints: existing?.totalPoints ?? 0,
    tierReached: existing?.tierReached ?? null,
    tiers: existing?.tiers ?? [],
    tasks: existing?.tasks ?? [],
    history: existing?.history ?? [],
  };
  const changed =
    !existing || existing.status !== status || existing.error !== error;
  if (changed) file.updatedAt = ts;
  return { file, changed };
}
