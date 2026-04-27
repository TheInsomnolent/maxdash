import { useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  CartesianGrid, Legend, Line, LineChart, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { useUI } from "../App";
import { useData, etaToMaxDays, snapshotsInRange, skillNameToIdx } from "../store";
import { MAX_XP, SKILLS, TRAINABLE_SKILLS, colorFor } from "../skills";

export function SkillRace() {
  const { name } = useParams();
  const nav = useNavigate();
  const { players, index } = useData();
  const range = useUI((s) => s.range);

  const skill = name && SKILLS.includes(name as (typeof SKILLS)[number]) ? name : "Attack";
  const idx = skillNameToIdx(skill);

  const data = useMemo(() => {
    if (!index) return [];
    // Build timeline = union of all sample times across players in range.
    const tsSet = new Set<number>();
    for (const p of index.players) {
      const pf = players[p.rsn];
      if (!pf) continue;
      for (const s of snapshotsInRange(pf, range)) tsSet.add(Date.parse(s.t));
    }
    const ts = [...tsSet].sort((a, b) => a - b);
    return ts.map((t) => {
      const row: Record<string, number | string> = { t, ts: new Date(t).toLocaleString() };
      for (const p of index.players) {
        const pf = players[p.rsn];
        if (!pf) continue;
        // Use last snapshot at-or-before t
        let v: number | undefined;
        for (const s of pf.snapshots) {
          const st = Date.parse(s.t);
          if (st > t) break;
          const x = s.s[idx];
          if (x >= 0) v = Math.min(x, MAX_XP);
        }
        if (v !== undefined) row[p.rsn] = v;
      }
      return row;
    });
  }, [index, players, range, idx]);

  if (!index) return null;

  return (
    <>
      <div className="panel">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem" }}>
          <h2 style={{ margin: 0 }}>Skill race — {skill}</h2>
          <select
            value={skill}
            onChange={(e) => nav(`/skills/${encodeURIComponent(e.target.value)}`)}
          >
            {TRAINABLE_SKILLS.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="panel" style={{ height: 420 }}>
        {data.length < 2 ? (
          <div className="empty">Need at least 2 snapshots in range to draw a chart.</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 10, right: 16, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="#2a3140" strokeDasharray="3 3" />
              <XAxis
                dataKey="t"
                type="number"
                domain={["dataMin", "dataMax"]}
                stroke="#8a94a3"
                tickFormatter={(v) => new Date(v).toLocaleDateString()}
              />
              <YAxis
                stroke="#8a94a3"
                tickFormatter={(v) => (v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : v.toLocaleString())}
                domain={[0, MAX_XP]}
              />
              <Tooltip
                contentStyle={{ background: "#161b22", border: "1px solid #2a3140" }}
                labelFormatter={(v) => new Date(Number(v)).toLocaleString()}
                formatter={(v: number) => v.toLocaleString()}
              />
              <Legend />
              <ReferenceLine y={MAX_XP} stroke="#f0a500" strokeDasharray="4 4" label={{ value: "99 / 13.0M", fill: "#f0a500", position: "right" }} />
              {index.players.map((p) => (
                <Line
                  key={p.rsn}
                  type="monotone"
                  dataKey={p.rsn}
                  stroke={colorFor(p.rsn)}
                  dot={false}
                  isAnimationActive={false}
                  connectNulls
                  strokeWidth={2}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="panel">
        <h2>ETA to 99 — {skill}</h2>
        <table>
          <thead>
            <tr><th>Player</th><th className="num">Current XP</th><th className="num">Days to 99</th><th>Projected</th></tr>
          </thead>
          <tbody>
            {index.players.map((p) => {
              const pf = players[p.rsn];
              const last = pf?.snapshots.at(-1)?.s[idx] ?? -1;
              const eta = pf ? etaToMaxDays(pf, idx) : null;
              return (
                <tr key={p.rsn}>
                  <td><span style={{ color: colorFor(p.rsn) }}>●</span> {p.rsn}</td>
                  <td className="num">{last < 0 ? "unranked" : last.toLocaleString()}</td>
                  <td className="num">{eta == null ? "—" : eta === 0 ? "MAXED" : `${eta.toFixed(0)}d`}</td>
                  <td>{eta == null || eta === 0 ? "—" : new Date(Date.now() + eta * 86400_000).toISOString().slice(0, 10)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
