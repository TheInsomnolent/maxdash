import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { snapshotCombatAchievements, type CaIndexEntry } from "./ca.js";
import { sleep } from "./hiscores.js";

/**
 * Refresh Combat Achievement data only, without touching the Hiscores.
 *
 *   npm run ca                      # every player in data/players.json
 *   npm run ca -- --player "Rsn"    # one player
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "../../data");

interface PlayersConfig {
  players: Array<{ rsn: string; type?: string } | string>;
}

function argValue(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

async function main(): Promise<void> {
  const only = argValue("--player");
  const cfg = JSON.parse(
    await fs.readFile(path.join(DATA_DIR, "players.json"), "utf8"),
  ) as PlayersConfig;
  const all = cfg.players.map((p) => (typeof p === "string" ? p : p.rsn));
  const rsns = only ? [only] : all;

  const results = new Map<string, CaIndexEntry>();
  for (const rsn of rsns) {
    process.stdout.write(`[ca] ${rsn} ... `);
    results.set(rsn, await snapshotCombatAchievements(DATA_DIR, rsn, new Date().toISOString()));
    await sleep(500);
  }

  // Patch the CA summary back into index.json so the dashboard's account
  // picker stays in sync without waiting for the next full snapshot.
  const indexPath = path.join(DATA_DIR, "index.json");
  try {
    const idx = JSON.parse(await fs.readFile(indexPath, "utf8")) as {
      players: Array<{ rsn: string; ca?: CaIndexEntry }>;
    };
    let patched = 0;
    for (const entry of idx.players) {
      const ca = results.get(entry.rsn);
      if (!ca) continue;
      entry.ca = ca;
      patched++;
    }
    await fs.writeFile(indexPath, JSON.stringify(idx, null, 2) + "\n", "utf8");
    console.log(`[ca] patched ${patched} index.json entries`);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    console.log("[ca] no index.json yet — run `npm run snapshot` first");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
