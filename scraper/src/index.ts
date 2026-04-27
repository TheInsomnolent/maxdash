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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "../../data");

interface PlayersConfig {
  players: string[];
}

interface IndexEntry {
  rsn: string;
  file: string;
  totalXp: number;
  totalLevel: number;
  skills99: number;
  lastChecked: string;
  lastChanged: string | null;
  status: "ok" | "unranked" | "error";
  error?: string;
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

  const entries: IndexEntry[] = [];

  for (const rsn of cfg.players) {
    process.stdout.write(`[snapshot] ${rsn} ... `);
    let pf: PlayerFile = (await readPlayerFile(DATA_DIR, rsn)) ?? {
      rsn,
      firstSeen: ts,
      snapshots: [],
    };

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
  console.log(`[snapshot] done. wrote ${entries.length} players at ${ts}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
