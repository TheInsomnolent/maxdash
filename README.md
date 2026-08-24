# maxdash

OSRS group max race tracker. Hourly GitHub Action scrapes the OSRS Hiscores for a list of RSNs and commits JSON snapshots into `data/`. A Vite + React dashboard, deployed to GitHub Pages, visualizes the race.

## Layout

- `scraper/` — Node TS script that fetches Hiscores + RuneProfile and appends snapshots.
- `data/` — committed snapshot store. `players.json` (RSN list), `index.json` (latest meta), `<rsn>.json` (per-player rolling history), `ca/<rsn>.json` (per-player Combat Achievements), `combat-achievements.csv` (static task completion rates).
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

## Combat Achievements

Each snapshot cycle also pulls Combat Achievements from RuneProfile:

- `GET /v1/accounts/:rsn/combat-achievements` — per-tier completion counts.
- `GET /v1/accounts/:rsn/combat-achievements/tasks` — every task plus the
  player's points total and reward tier reached.

Results land in `data/ca/<rsn>.json` (latest task list, tier summary and a
deduped `history` of points over time). The file is only rewritten when
something actually changed, so idle hours add no commit noise. A summary is
mirrored onto each `index.json` player entry so the dashboard's account picker
knows who has data without downloading every task list.

Players who have never uploaded a RuneProfile profile come back `404`; they're
recorded with `status: "unlinked"` and the dashboard prompts them to install the
plugin via the [RuneProfile guide](https://runeprofile.com/info/guide) instead
of rendering an empty board.

```sh
npm run ca                      # refresh CA data only (all players)
npm run ca -- --player "Rsn"    # one player
```

### Task completion rates

The RuneProfile API doesn't expose how many players have completed each task,
which is what the dashboard uses to order the "easiest path" to-do list. That
data is a manual wiki export kept in `data/combat-achievements.csv` and compiled
into `dashboard/src/data/caCompletion.ts`:

```sh
npm run ca:completion
```

When RuneProfile reports a task that isn't in the CSV, the dashboard shows a
warning banner naming the missing tasks and ranks them last (0.1% below the
lowest known rate, same as tasks the wiki reports as `N/A`) — that's the cue to
refresh the CSV and re-run the script.

### To-do list views

The tab's to-do list has two modes (remembered per browser):

- **Flat** — every outstanding task easiest-first, with a reward-tier goal row
  spliced in where the running points total crosses each threshold.
- **Smart grouping** — the same plan pivoted into collapsible
  reward tier → monster → task blocks. Tier blocks run in unlock order,
  monsters within a block are ordered by their hardest task in that block
  (least-hard first), and tasks within a monster run easiest-first.

## Notes

- Per-skill cap: **13,034,431 XP / level 99**.
- All-99 total level: **2,277** (23 × 99).
- Race baseline = first snapshot (no historical backfill).
- Combat Achievement reward tiers unlock on **points**, not on finishing the
  matching task tier: Easy 41, Medium 161, Hard 419, Elite 1075, Master 1940,
  Grandmaster 2672. A task is worth its tier id in points (Easy = 1 … GM = 6).
