import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { backfillPlayer } from "./backfill.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "../../data");

interface PlayerConfig {
  rsn: string;
  type?: "main" | "ironman" | "gim";
}

interface PlayersConfig {
  players: Array<PlayerConfig | string>;
}

interface CliArgs {
  player: string | null;
  templePages: number;
  skipTemple: boolean;
  skipWom: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    player: null,
    templePages: 20,
    skipTemple: false,
    skipWom: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--player") {
      args.player = argv[++i] ?? null;
    } else if (a.startsWith("--player=")) {
      args.player = a.slice("--player=".length);
    } else if (a === "--temple-pages") {
      args.templePages = Number(argv[++i] ?? "20");
    } else if (a.startsWith("--temple-pages=")) {
      args.templePages = Number(a.slice("--temple-pages=".length));
    } else if (a === "--skip-temple") {
      args.skipTemple = true;
    } else if (a === "--skip-wom") {
      args.skipWom = true;
    } else if (a === "--help" || a === "-h") {
      console.log(
        "Usage: npm run backfill -- [--player <rsn>] [--temple-pages N] [--skip-temple] [--skip-wom]",
      );
      process.exit(0);
    } else {
      console.warn(`[backfill] unknown arg: ${a}`);
    }
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const cfgRaw = await fs.readFile(path.join(DATA_DIR, "players.json"), "utf8");
  const cfg = JSON.parse(cfgRaw) as PlayersConfig;
  let players: PlayerConfig[] = cfg.players.map((p) =>
    typeof p === "string" ? { rsn: p } : p,
  );
  if (args.player) {
    const want = args.player.toLowerCase();
    players = players.filter((p) => p.rsn.toLowerCase() === want);
    if (players.length === 0) {
      console.error(`[backfill] no player matching "${args.player}"`);
      process.exit(1);
    }
  }

  for (const { rsn } of players) {
    process.stdout.write(`[backfill] ${rsn} ... `);
    try {
      const r = await backfillPlayer(DATA_DIR, rsn, {
        templePages: args.templePages,
        skipTemple: args.skipTemple,
        skipWom: args.skipWom,
      });
      console.log(
        `wom=${r.womCount} temple=${r.templeCount} ${r.before}->${r.after} (+${r.added})` +
          (r.earliest ? ` earliest=${r.earliest}` : ""),
      );
    } catch (err) {
      console.log(
        `error (${err instanceof Error ? err.message : String(err)})`,
      );
    }
  }
  console.log(`[backfill] done.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
