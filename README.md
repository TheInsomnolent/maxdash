# maxdash

OSRS group max race tracker. Hourly GitHub Action scrapes the OSRS Hiscores for a list of RSNs and commits JSON snapshots into `data/`. A Vite + React dashboard, deployed to GitHub Pages, visualizes the race.

## Layout

- `scraper/` — Node TS script that fetches Hiscores and appends snapshots.
- `data/` — committed snapshot store. `players.json` (RSN list), `index.json` (latest meta), `<rsn>.json` (per-player rolling history).
- `dashboard/` — Vite + React + TS dashboard (Recharts).
- `.github/workflows/` — hourly snapshot cron + Pages deploy.

## Local

```sh
npm install
npm run snapshot   # one fetch cycle, writes data/*.json
npm run dev        # dashboard at http://localhost:5173/maxdash/
```

## Historical backfill

`npm run snapshot` only records data from the moment we first see a player. To
seed older history we pull from two third-party trackers and merge their
datapoints into our `data/<rsn>.json` files:

- **Wise Old Man** (`/v2/players/:rsn/snapshots`) — primary. We `POST /players/:rsn`
  first so WOM imports any available CML history before we read snapshots.
- **TempleOSRS** (`/api/player_datapoints.php`) — supplemental. Walked backwards
  in ~1-year pages (capped at 20 by default).

Datapoints from all sources are deduped by minute-precision timestamp;
existing live snapshots always win on conflict, so re-running is idempotent.

```sh
npm run backfill                          # all players in data/players.json
npm run backfill -- --player Insomnolennt # one player only
npm run backfill -- --temple-pages 5      # shallower Temple walk
npm run backfill -- --skip-temple         # WOM only
```

The hourly snapshot job also runs a one-shot backfill the first time it sees
a brand-new RSN, so adding a player to `data/players.json` is enough.

## Notes

- Per-skill cap: **13,034,431 XP / level 99**.
- All-99 total level: **2,277** (23 × 99).
- Race baseline = first snapshot (no historical backfill).
