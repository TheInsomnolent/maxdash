import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  useData,
  latestSnapshot,
  skills99Count,
  totalLevelFromSnapshot,
  filterPlayers,
  activeHoursInRange,
  cappedXpGainInRange,
  cappedTotalXpFromSnapshot,
  levelGainInRange,
} from "../store";
import {
  MAX_TOTAL_LEVEL,
  TRAINABLE_SKILL_COUNT,
  colorFor,
} from "../skills";
import { AccountBadge, type AccountType } from "../components/AccountBadge";
import { PlayerImage } from "../components/PlayerImage";
import { WeeklyRace } from "../components/WeeklyRace";
import { useUI } from "../App";

interface Row {
  rsn: string;
  type: AccountType;
  totalXp: number;
  totalLevel: number;
  skills99: number;
  pctMaxed: number;
  hoursActive: number;
  xpGained: number;
}

type SortKey = keyof Pick<
  Row,
  "totalXp" | "totalLevel" | "skills99" | "pctMaxed" | "hoursActive" | "xpGained"
>;

interface BoardRow {
  rsn: string;
  type: AccountType;
  value: number;
}

export function Overall() {
  const { players, index } = useData();
  const range = useUI((s) => s.range);
  const typeFilter = useUI((s) => s.typeFilter);
  const hideInactive = useUI((s) => s.hideInactive);
  const [sort, setSort] = useState<SortKey>("totalXp");
  const [dir, setDir] = useState<1 | -1>(-1);

  const rows = useMemo<Row[]>(() => {
    if (!index) return [];
    return filterPlayers(index.players, typeFilter, hideInactive).map((p) => {
      const pf = players[p.rsn];
      const last = pf ? latestSnapshot(pf) : null;
      const snap = last?.s ?? [];
      const totalXp = snap.length ? cappedTotalXpFromSnapshot(snap) : 0;
      const totalLevel = snap.length ? totalLevelFromSnapshot(snap) : 0;
      const s99 = snap.length ? skills99Count(snap) : 0;
      const hoursActive = pf ? activeHoursInRange(pf, range) : 0;
      const xpGained = pf ? cappedXpGainInRange(pf, 0, range) : 0;
      return {
        rsn: p.rsn,
        type: p.type,
        totalXp,
        totalLevel,
        skills99: s99,
        pctMaxed: (s99 / TRAINABLE_SKILL_COUNT) * 100,
        hoursActive,
        xpGained,
      };
    });
  }, [index, players, typeFilter, hideInactive, range]);

  const sorted = useMemo(() => {
    return [...rows].sort((a, b) => {
      const av = a[sort] ?? Number.POSITIVE_INFINITY;
      const bv = b[sort] ?? Number.POSITIVE_INFINITY;
      if (av === bv) return 0;
      return (av < bv ? -1 : 1) * dir;
    });
  }, [rows, sort, dir]);

  const setSortKey = (k: SortKey) => {
    if (k === sort) setDir((d) => (d === 1 ? -1 : 1));
    else { setSort(k); setDir(-1); }
  };

  const xpBoard = useMemo<BoardRow[]>(() => {
    if (!index) return [];
    return filterPlayers(index.players, typeFilter, hideInactive)
      .map((p) => ({
        rsn: p.rsn,
        type: p.type,
        value: players[p.rsn] ? cappedXpGainInRange(players[p.rsn], 0, range) : 0,
      }))
      .sort((a, b) => b.value - a.value);
  }, [index, players, range, typeFilter, hideInactive]);

  const lvlBoard = useMemo<BoardRow[]>(() => {
    if (!index) return [];
    return filterPlayers(index.players, typeFilter, hideInactive)
      .map((p) => ({
        rsn: p.rsn,
        type: p.type,
        value: players[p.rsn] ? levelGainInRange(players[p.rsn], 0, range) : 0,
      }))
      .sort((a, b) => b.value - a.value);
  }, [index, players, range, typeFilter, hideInactive]);

  /**
   * Funny awards — every metric is scoped to the currently selected time range.
   * An award is "Not awarded" when no visible player has any qualifying activity
   * in the range (e.g. no XP gained in the relevant skills, or no active hours).
   */
  const awards = useMemo(() => {
    if (!index) return [];
    const visible = filterPlayers(index.players, typeFilter, hideInactive);
    type Entry = { rsn: string; type: AccountType; value: number };
    // Skill index sets (matches order in skills.ts).
    const COMBAT = [1, 2, 3, 4, 5, 6, 7, 19]; // attack, def, str, hp, ranged, prayer, magic, slayer
    const NON_COMBAT: number[] = [];
    for (let i = 1; i <= 23; i++) if (!COMBAT.includes(i)) NON_COMBAT.push(i);
    const SUICIDE = [21, 17, 18, 23]; // runecraft, agility, thieving, construction
    const GATHER = [15, 11, 9]; // mining, fishing, woodcutting
    const IRON_DEF = [13, 16, 10, 6]; // crafting, herblore, fletching, prayer
    const FARM_HUNT = [20, 22]; // farming, hunter

    // Pick the entry with the largest (or smallest) positive value.
    // Returns null if no visible player has a positive value.
    const pick = (entries: Entry[], pickMax: boolean): Entry | null => {
      const positive = entries.filter((e) => e.value > 0);
      if (!positive.length) return null;
      return positive.reduce((best, e) =>
        pickMax ? (e.value > best.value ? e : best) : (e.value < best.value ? e : best),
      );
    };

    const rangeXpPerHour = (skillIdxs: number[]): Entry[] =>
      visible
        .map((p) => {
          const pf = players[p.rsn];
          if (!pf) return null;
          const hrs = activeHoursInRange(pf, range);
          if (hrs <= 0) return null;
          let xp = 0;
          for (const i of skillIdxs) xp += cappedXpGainInRange(pf, i, range);
          if (xp <= 0) return null;
          return { rsn: p.rsn, type: p.type, value: xp / hrs };
        })
        .filter((e): e is Entry => e !== null);

    const rangeXpTotal = (skillIdxs: number[]): Entry[] =>
      visible.map((p) => {
        const pf = players[p.rsn];
        let xp = 0;
        if (pf) for (const i of skillIdxs) xp += cappedXpGainInRange(pf, i, range);
        return { rsn: p.rsn, type: p.type, value: xp };
      });

    const hoursEntries: Entry[] = visible.map((p) => ({
      rsn: p.rsn,
      type: p.type,
      value: players[p.rsn] ? activeHoursInRange(players[p.rsn], range) : 0,
    }));

    const items: Array<{ title: string; blurb: string; winner: Entry | null; format: (n: number) => string }> = [
      {
        title: "Unsweatiest Player",
        blurb: `Lowest overall XP per active hour (${range})`,
        winner: pick(rangeXpPerHour([0]), false),
        format: (n) => `${Math.round(n).toLocaleString()} xp/hr`,
      },
      {
        title: "Please Touch Grass",
        blurb: `Most hours played (${range})`,
        winner: pick(hoursEntries, true),
        format: (n) => `${n.toFixed(1)}h`,
      },
      {
        title: "Pacifist",
        blurb: `Most non-combat XP (${range})`,
        winner: pick(rangeXpTotal(NON_COMBAT), true),
        format: (n) => `${n.toLocaleString()} xp`,
      },
      {
        title: "Suicide Watch",
        blurb: `Most Runecraft + Agility + Thieving + Construction XP (${range})`,
        winner: pick(rangeXpTotal(SUICIDE), true),
        format: (n) => `${n.toLocaleString()} xp`,
      },
      {
        title: "Your Employer Has Been Notified",
        blurb: `Most Mining + Fishing + Woodcutting XP (${range})`,
        winner: pick(rangeXpTotal(GATHER), true),
        format: (n) => `${n.toLocaleString()} xp`,
      },
      {
        title: "Iron Deficiency",
        blurb: `Most Crafting + Herblore + Fletching + Prayer XP (${range})`,
        winner: pick(rangeXpTotal(IRON_DEF), true),
        format: (n) => `${n.toLocaleString()} xp`,
      },
      {
        title: "Do You Even Play The Game?",
        blurb: `Highest Farming + Hunter XP per active hour (${range})`,
        winner: pick(rangeXpPerHour(FARM_HUNT), true),
        format: (n) => `${Math.round(n).toLocaleString()} xp/hr`,
      },
    ];
    return items;
  }, [index, players, range, typeFilter, hideInactive]);

  const efficiency = useMemo(() => {
    if (!index) return [];
    return filterPlayers(index.players, typeFilter, hideInactive)
      .map((p) => {
        const pf = players[p.rsn];
        if (!pf) return { rsn: p.rsn, type: p.type, xpPerActiveHr: 0 };
        const hrs = activeHoursInRange(pf, range);
        const xp = cappedXpGainInRange(pf, 0, range);
        return {
          rsn: p.rsn,
          type: p.type,
          xpPerActiveHr: hrs > 0 ? xp / hrs : 0,
        };
      })
      .sort((a, b) => b.xpPerActiveHr - a.xpPerActiveHr);
  }, [index, players, range, typeFilter, hideInactive]);

  return (
    <>
      <div className="panel">
        <h2>Overall race ({range})</h2>
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Player</th>
              <th onClick={() => setSortKey("totalXp")} className="num" title="XP towards maxing — XP past level 99 in a skill is excluded">Total XP</th>
              <th onClick={() => setSortKey("totalLevel")} className="num">Total Lvl</th>
              <th onClick={() => setSortKey("skills99")} className="num">99s</th>
              <th onClick={() => setSortKey("pctMaxed")}>% Maxed</th>
              <th onClick={() => setSortKey("xpGained")} className="num" title="XP towards maxing — XP past level 99 in a skill is excluded">XP gained</th>
              <th onClick={() => setSortKey("hoursActive")} className="num">Hours played</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r, i) => (
              <tr key={r.rsn}>
                <td className="num">{i + 1}</td>
                <td>
                  <span className="swatch" style={{ background: colorFor(r.rsn), color: colorFor(r.rsn) }} />
                  <AccountBadge type={r.type} />{" "}
                  <Link to={`/players/${encodeURIComponent(r.rsn)}`}>{r.rsn}</Link>
                </td>
                <td className="num">{r.totalXp.toLocaleString()}</td>
                <td className="num">{r.totalLevel} / {MAX_TOTAL_LEVEL}</td>
                <td className="num">{r.skills99} / {TRAINABLE_SKILL_COUNT}</td>
                <td style={{ minWidth: 140 }}>
                  <div className="bar"><span style={{ width: `${r.pctMaxed}%` }} /></div>
                  <small>{r.pctMaxed.toFixed(1)}%</small>
                </td>
                <td className="num">{r.xpGained.toLocaleString()}</td>
                <td className="num">{r.hoursActive.toFixed(1)}h</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Board title={`MVP — XP gained (${range})`} rows={xpBoard} suffix=" xp" />
      <WeeklyRace mode="xp" />
      <Board title={`MVP — Levels gained (${range})`} rows={lvlBoard} suffix=" lvls" />
      <WeeklyRace mode="level" />

      <div className="panel">
        <h2>Awards</h2>
        <div className="awards">
          {awards.map((a) => (
            <div key={a.title} className="award">
              {a.winner ? (
                <PlayerImage rsn={a.winner.rsn} size={96} className="award-hero" />
              ) : (
                <img
                  src={`${import.meta.env.BASE_URL}images/Default.png`}
                  alt=""
                  className="award-hero empty"
                  width={96}
                  height={96}
                />
              )}
              <div className="award-body">
                <div className="award-title">{a.title}</div>
                <div className="award-blurb">{a.blurb}</div>
                {a.winner ? (
                  <>
                    <div className="award-winner">
                      <span
                        className="swatch"
                        style={{ background: colorFor(a.winner.rsn), color: colorFor(a.winner.rsn) }}
                      />
                      <AccountBadge type={a.winner.type} />{" "}
                      <span style={{ color: colorFor(a.winner.rsn), fontWeight: 700 }}>
                        {a.winner.rsn}
                      </span>
                    </div>
                    <div className="award-value">{a.format(a.winner.value)}</div>
                  </>
                ) : (
                  <div className="award-empty">Not awarded</div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="panel">
        <h2>Efficiency — XP per active hour ({range})</h2>
        <table>
          <thead><tr><th>#</th><th>Player</th><th className="num">XP / active hr</th></tr></thead>
          <tbody>
            {efficiency.map((r, i) => (
              <tr key={r.rsn}>
                <td className="num">{i + 1}</td>
                <td>
                  <span className="swatch" style={{ background: colorFor(r.rsn), color: colorFor(r.rsn) }} />
                  <AccountBadge type={r.type} />{" "}
                  {r.rsn}
                </td>
                <td className="num">{Math.round(r.xpPerActiveHr).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Board({ title, rows, suffix }: { title: string; rows: BoardRow[]; suffix: string }) {
  const podium = rows.slice(0, 3);
  return (
    <div className="panel">
      <h2>{title}</h2>
      {rows.every((r) => r.value === 0) ? (
        <div className="empty">No movement in this range yet.</div>
      ) : (
        <div className="podium">
          {[1, 0, 2].map((order) => {
            const r = podium[order];
            if (!r) return <div key={order} />;
            return (
              <div key={r.rsn} className={"step" + (order === 0 ? " first" : "")}>
                <div className="medal">
                  {order === 0 ? "\uD83E\uDD47" : order === 1 ? "\uD83E\uDD48" : "\uD83E\uDD49"}
                </div>
                <PlayerImage rsn={r.rsn} size={order === 0 ? 168 : 128} className="hero" />
                <div className="who" style={{ color: colorFor(r.rsn) }}>
                  <span className="swatch" style={{ background: colorFor(r.rsn), color: colorFor(r.rsn) }} />
                  <AccountBadge type={r.type} />{" "}
                  {r.rsn}
                </div>
                <div className="what">{r.value.toLocaleString()}{suffix}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

