import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchHiscores, HiscoresError, sleep } from "./hiscores.js";
import {
  appendSnapshot,
  readPlayerFile,
  rsnToFile,
  writePlayerFile,
  type PlayerFile,
} from "./store.js";
import { SKILLS } from "./skills.js";
import { backfillPlayer } from "./backfill.js";
import { snapshotCombatAchievements, type CaIndexEntry } from "./ca.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "../../data");

interface PlayerConfig {
  rsn: string;
  type: "main" | "ironman" | "gim";
}

interface PlayersConfig {
  players: Array<PlayerConfig | string>;
}

interface IndexEntry {
  rsn: string;
  type: "main" | "ironman" | "gim";
  file: string;
  totalXp: number;
  totalLevel: number;
  skills99: number;
  lastChecked: string;
  lastChanged: string | null;
  status: "ok" | "unranked" | "error";
  error?: string;
  ca?: CaIndexEntry;
}

interface IndexFile {
  generatedAt: string;
  skills: readonly string[];
  players: IndexEntry[];
}

async function main(): Promise<void> {
  const cfgRaw = await fs.readFile(path.join(DATA_DIR, "players.json"), "utf8");
  const cfg = JSON.parse(cfgRaw) as PlayersConfig;
  const ts = new Date().toISOString();

  const players: PlayerConfig[] = cfg.players.map((p) =>
    typeof p === "string" ? { rsn: p, type: "main" } : p,
  );

  const entries: IndexEntry[] = [];

  for (const { rsn, type } of players) {
    process.stdout.write(`[snapshot] ${rsn} ... `);
    const existing = await readPlayerFile(DATA_DIR, rsn);
    let pf: PlayerFile = existing ?? {
      rsn,
      firstSeen: ts,
      snapshots: [],
    };

    // First-ever sighting of this RSN: try to backfill historical data from
    // WOM + Temple before taking the live snapshot. Failures here must not
    // block the live snapshot.
    if (!existing) {
      try {
        const r = await backfillPlayer(DATA_DIR, rsn);
        console.log(
          `bootstrap wom=${r.womCount} temple=${r.templeCount} (+${r.added}) ... `,
        );
        pf = (await readPlayerFile(DATA_DIR, rsn)) ?? pf;
      } catch (err) {
        console.log(
          `bootstrap failed (${err instanceof Error ? err.message : String(err)}) ... `,
        );
      }
    }

    try {
      const snap = await fetchHiscores(rsn);
      const appended = appendSnapshot(pf, ts, snap);
      await writePlayerFile(DATA_DIR, pf);

      const overallXp = snap.xp[0] >= 0 ? snap.xp[0] : 0;
      const overallLevel = snap.level[0] >= 0 ? snap.level[0] : 0;
      const skills99 = snap.level
        .slice(1)
        .filter((lvl) => lvl >= 99).length;

      entries.push({
        rsn,
        type,
        file: rsnToFile(rsn),
        totalXp: overallXp,
        totalLevel: overallLevel,
        skills99,
        lastChecked: ts,
        lastChanged: appended
          ? ts
          : (pf.snapshots.at(-1)?.t ?? null),
        status: snap.xp.every((v) => v < 0) ? "unranked" : "ok",
      });
      console.log(appended ? "appended" : "no change");
    } catch (err) {
      const msg =
        err instanceof HiscoresError
          ? `${err.status}`
          : err instanceof Error
            ? err.message
            : String(err);
      console.log(`error (${msg})`);
      // Still persist the player file (creates an empty stub on first run).
      await writePlayerFile(DATA_DIR, pf);
      entries.push({
        rsn,
        type,
        file: rsnToFile(rsn),
        totalXp: pf.snapshots.at(-1)?.s[0] ?? 0,
        totalLevel: 0,
        skills99: 0,
        lastChecked: ts,
        lastChanged: pf.snapshots.at(-1)?.t ?? null,
        status: "error",
        error: msg,
      });
    }

    // Be polite to the Hiscores endpoint.
    await sleep(500);

    // Combat Achievements come from RuneProfile, which is only populated for
    // players running the RuneProfile plugin. A missing profile is expected,
    // not an error.
    process.stdout.write(`[ca] ${rsn} ... `);
    const ca = await snapshotCombatAchievements(DATA_DIR, rsn, ts);
    const entry = entries.at(-1);
    if (entry) entry.ca = ca;
    await sleep(500);
  }

  const index: IndexFile = {
    generatedAt: ts,
    skills: SKILLS,
    players: entries,
  };
  await fs.writeFile(
    path.join(DATA_DIR, "index.json"),
    JSON.stringify(index, null, 2) + "\n",
    "utf8",
  );

  const errors = entries.filter((e) => e.status === "error");
  if (errors.length) {
    console.warn(
      `[snapshot] ${errors.length} player(s) errored: ${errors
        .map((e) => `${e.rsn} (${e.error})`)
        .join(", ")}`,
    );
  }
  const caErrors = entries.filter((e) => e.ca?.status === "error");
  if (caErrors.length) {
    console.warn(
      `[snapshot] ${caErrors.length} player(s) had Combat Achievement errors: ${caErrors
        .map((e) => `${e.rsn} (${e.ca?.error})`)
        .join(", ")}`,
    );
  }
  const unlinked = entries.filter((e) => e.ca?.status === "unlinked");
  if (unlinked.length) {
    console.log(
      `[snapshot] ${unlinked.length} player(s) not linked to RuneProfile: ${unlinked
        .map((e) => e.rsn)
        .join(", ")}`,
    );
  }
  console.log(`[snapshot] done. wrote ${entries.length} players at ${ts}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
