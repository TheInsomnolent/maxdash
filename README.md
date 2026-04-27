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

## Notes

- Per-skill cap: **13,034,431 XP / level 99**.
- All-99 total level: **2,277** (23 × 99).
- Race baseline = first snapshot (no historical backfill).
