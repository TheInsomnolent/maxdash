import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  CartesianGrid, Legend, Line, LineChart, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { useUI } from "../App";
import { useData, etaToMaxDays, snapshotsInRange, skillNameToIdx, filterPlayers } from "../store";
import { MAX_XP, SKILLS, TRAINABLE_SKILLS, TRAINABLE_SKILL_COUNT, MAX_TOTAL_LEVEL, colorFor, xpToLevel } from "../skills";
import { SkillIcon } from "../components/SkillIcon";
import { AccountBadge } from "../components/AccountBadge";
import { PlayerImage } from "../components/PlayerImage";

const SKILL_OPTIONS = ["Overall", ...TRAINABLE_SKILLS];

export function SkillRace() {
  const { name } = useParams();
  const nav = useNavigate();
  const { players, index } = useData();
  const range = useUI((s) => s.range);
  const typeFilter = useUI((s) => s.typeFilter);
  const hideInactive = useUI((s) => s.hideInactive);

  const skill = name && SKILLS.includes(name as (typeof SKILLS)[number]) ? name : "Overall";
  const idx = skillNameToIdx(skill);
  const isOverall = idx === 0;
  const [yMode, setYMode] = useState<"xp" | "level">("xp");
  const [yMin, setYMin] = useState<"zero" | "auto">("zero");
  const cap = isOverall
    ? (yMode === "level" ? MAX_TOTAL_LEVEL : MAX_XP * TRAINABLE_SKILL_COUNT)
    : (yMode === "level" ? 99 : MAX_XP);
  const capLabel = isOverall
    ? (yMode === "level" ? `MAX / ${MAX_TOTAL_LEVEL}` : `MAX / ${(MAX_XP * TRAINABLE_SKILL_COUNT / 1_000_000).toFixed(0)}M`)
    : (yMode === "level" ? "99" : "99 / 13.0M");

  /** Convert a snapshot's raw skill array into the y-axis value for the active mode. */
  const valueFromSnapshot = (s: { s: number[] }): number | undefined => {
    if (yMode === "xp") {
      const x = s.s[idx];
      return x >= 0 ? Math.min(x, cap) : undefined;
    }
    // Level mode
    if (isOverall) {
      let total = 0;
      let any = false;
      for (let i = 1; i < SKILLS.length; i++) {
        const x = s.s[i];
        if (x >= 0) { total += xpToLevel(x); any = true; }
        else total += 1; // unranked skills count as level 1, matching the in-game total
      }
      return any ? total : undefined;
    }
    const x = s.s[idx];
    return x >= 0 ? xpToLevel(x) : undefined;
  };

  const data = useMemo(() => {
    if (!index) return [];
    const visible = filterPlayers(index.players, typeFilter, hideInactive);
    // Build timeline = union of all sample times across players in range.
    const tsSet = new Set<number>();
    for (const p of visible) {
      const pf = players[p.rsn];
      if (!pf) continue;
      for (const s of snapshotsInRange(pf, range)) tsSet.add(Date.parse(s.t));
    }
    const ts = [...tsSet].sort((a, b) => a - b);
    return ts.map((t) => {
      const row: Record<string, number | string> = { t, ts: new Date(t).toLocaleString() };
      for (const p of visible) {
        const pf = players[p.rsn];
        if (!pf) continue;
        // Use last snapshot at-or-before t
        let v: number | undefined;
        for (const s of pf.snapshots) {
          const st = Date.parse(s.t);
          if (st > t) break;
          const computed = valueFromSnapshot(s);
          if (computed !== undefined) v = computed;
        }
        if (v !== undefined) row[p.rsn] = v;
      }
      return row;
    });
  }, [index, players, range, idx, typeFilter, hideInactive, yMode, isOverall, cap]);

  if (!index) return null;
  const visiblePlayers = filterPlayers(index.players, typeFilter, hideInactive);

  return (
    <>
      <div className="panel">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem" }}>
          <h2 style={{ margin: 0 }}>
            <SkillIcon name={skill} size={22} /> Skill race — {skill}
          </h2>
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
            <div className="range-bar" title="Y-axis units">
              <button
                className={yMode === "xp" ? "active" : ""}
                onClick={() => setYMode("xp")}
              >XP</button>
              <button
                className={yMode === "level" ? "active" : ""}
                onClick={() => setYMode("level")}
              >Level</button>
            </div>
            <div className="range-bar" title="Y-axis minimum">
              <button
                className={yMin === "zero" ? "active" : ""}
                onClick={() => setYMin("zero")}
              >Y: 0</button>
              <button
                className={yMin === "auto" ? "active" : ""}
                onClick={() => setYMin("auto")}
              >Y: auto</button>
            </div>
            <select
              value={skill}
              onChange={(e) => nav(`/skills/${encodeURIComponent(e.target.value)}`)}
            >
              {SKILL_OPTIONS.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="panel" style={{ height: 420 }}>
        {data.length < 2 ? (
          <div className="empty">Need at least 2 snapshots in range to draw a chart.</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 10, right: 96, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="#3a2614" strokeDasharray="3 3" />
              <XAxis
                dataKey="t"
                type="number"
                domain={["dataMin", "dataMax"]}
                stroke="#b8a684"
                tickFormatter={(v) => new Date(v).toLocaleDateString()}
              />
              <YAxis
                stroke="#b8a684"
                tickFormatter={(v) => {
                  if (yMode === "level") return String(Math.round(v));
                  return v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : v.toLocaleString();
                }}
                domain={[
                  yMin === "auto"
                    ? ("dataMin" as const)
                    : (yMode === "level" ? (isOverall ? TRAINABLE_SKILL_COUNT : 1) : 0),
                  yMin === "auto" ? ("dataMax" as const) : cap,
                ]}
                allowDecimals={false}
              />
              <Tooltip
                contentStyle={{ background: "#2b1f12", border: "2px solid #8a6b3d", color: "#f0e2c0" }}
                labelStyle={{ color: "#ffb43b" }}
                labelFormatter={(v) => new Date(Number(v)).toLocaleString()}
                formatter={(v: number) => yMode === "level"
                  ? (isOverall ? `total ${Math.round(v)}` : `level ${Math.round(v)}`)
                  : `${v.toLocaleString()} xp`}
              />
              <Legend wrapperStyle={{ color: "#f0e2c0" }} />
              <ReferenceLine y={cap} stroke="#ffb43b" strokeDasharray="4 4" label={{ value: capLabel, fill: "#ffb43b", position: "right" }} />
              {visiblePlayers.map((p) => (
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
        <h2><SkillIcon name={skill} size={20} /> ETA to {isOverall ? "max total XP" : "99"} — {skill}</h2>
        <table>
          <thead>
            <tr><th>Player</th><th className="num">Current XP</th><th className="num">Days to 99</th><th>Projected</th></tr>
          </thead>
          <tbody>
            {visiblePlayers.map((p) => {
              const pf = players[p.rsn];
              const last = pf?.snapshots.at(-1)?.s[idx] ?? -1;
              const eta = pf ? etaToMaxDays(pf, idx) : null;
              return (
                <tr key={p.rsn}>
                  <td>
                    <PlayerImage rsn={p.rsn} size={24} />{" "}
                    <span className="swatch" style={{ background: colorFor(p.rsn), color: colorFor(p.rsn) }} />
                    <AccountBadge type={p.type} />{" "}
                    {p.rsn}
                  </td>
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
