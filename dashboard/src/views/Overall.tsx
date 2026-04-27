import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useData, etaToMaxDays, latestSnapshot, skills99Count, totalLevelFromSnapshot } from "../store";
import { MAX_TOTAL_LEVEL, MAX_XP, TRAINABLE_SKILL_COUNT, colorFor } from "../skills";

interface Row {
  rsn: string;
  totalXp: number;
  totalLevel: number;
  skills99: number;
  pctMaxed: number;
  etaDays: number | null;
  etaDate: string;
}

type SortKey = keyof Pick<Row, "totalXp" | "totalLevel" | "skills99" | "pctMaxed" | "etaDays">;

export function Overall() {
  const { players, index } = useData();
  const [sort, setSort] = useState<SortKey>("totalXp");
  const [dir, setDir] = useState<1 | -1>(-1);

  const rows = useMemo<Row[]>(() => {
    if (!index) return [];
    return index.players.map((p) => {
      const pf = players[p.rsn];
      const last = pf ? latestSnapshot(pf) : null;
      const snap = last?.s ?? [];
      const totalXp = snap[0] ?? 0;
      const totalLevel = snap.length ? totalLevelFromSnapshot(snap) : 0;
      const s99 = snap.length ? skills99Count(snap) : 0;
      // Aggregate ETA: longest per-skill ETA among non-maxed skills.
      let worstEta: number | null = null;
      if (pf) {
        for (let i = 1; i < snap.length; i++) {
          if (snap[i] >= MAX_XP) continue;
          const d = etaToMaxDays(pf, i);
          if (d == null) {
            worstEta = null; // any unknown skill ⇒ unknown overall
            break;
          }
          if (worstEta == null || d > worstEta) worstEta = d;
        }
      }
      const etaDate = worstEta == null
        ? "—"
        : new Date(Date.now() + worstEta * 86400_000).toISOString().slice(0, 10);
      return {
        rsn: p.rsn,
        totalXp,
        totalLevel,
        skills99: s99,
        pctMaxed: (s99 / TRAINABLE_SKILL_COUNT) * 100,
        etaDays: worstEta,
        etaDate,
      };
    });
  }, [index, players]);

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

  return (
    <>
      <div className="panel">
        <h2>Overall race</h2>
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Player</th>
              <th onClick={() => setSortKey("totalXp")} className="num">Total XP</th>
              <th onClick={() => setSortKey("totalLevel")} className="num">Total Lvl</th>
              <th onClick={() => setSortKey("skills99")} className="num">99s</th>
              <th onClick={() => setSortKey("pctMaxed")}>% Maxed</th>
              <th onClick={() => setSortKey("etaDays")} className="num">ETA</th>
              <th>Projected max</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r, i) => (
              <tr key={r.rsn}>
                <td className="num">{i + 1}</td>
                <td>
                  <span style={{ color: colorFor(r.rsn) }}>●</span>{" "}
                  <Link to={`/players/${encodeURIComponent(r.rsn)}`}>{r.rsn}</Link>
                </td>
                <td className="num">{r.totalXp.toLocaleString()}</td>
                <td className="num">{r.totalLevel} / {MAX_TOTAL_LEVEL}</td>
                <td className="num">{r.skills99} / {TRAINABLE_SKILL_COUNT}</td>
                <td style={{ minWidth: 140 }}>
                  <div className="bar"><span style={{ width: `${r.pctMaxed}%` }} /></div>
                  <small>{r.pctMaxed.toFixed(1)}%</small>
                </td>
                <td className="num">{r.etaDays == null ? "—" : `${r.etaDays.toFixed(0)}d`}</td>
                <td>{r.etaDate}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
