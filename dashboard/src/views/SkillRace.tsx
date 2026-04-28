import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  CartesianGrid, Legend, Line, LineChart, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { useUI } from "../App";
import { useData, snapshotsInRange, skillNameToIdx, filterPlayers, RANGE_OPTIONS } from "../store";
import { MAX_XP, SKILLS, TRAINABLE_SKILLS, TRAINABLE_SKILL_COUNT, MAX_TOTAL_LEVEL, colorFor, xpToLevel } from "../skills";
import { SkillIcon } from "../components/SkillIcon";

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

  const { data, projections } = useMemo(() => {
    if (!index) return { data: [] as Array<Record<string, number | string>>, projections: [] as Array<{ rsn: string }> };
    const visible = filterPlayers(index.players, typeFilter, hideInactive);
    // Build timeline = union of all sample times across players in range.
    const tsSet = new Set<number>();
    for (const p of visible) {
      const pf = players[p.rsn];
      if (!pf) continue;
      for (const s of snapshotsInRange(pf, range)) tsSet.add(Date.parse(s.t));
    }
    const ts = [...tsSet].sort((a, b) => a - b);
    const rowByT = new Map<number, Record<string, number | string>>();
    for (const t of ts) {
      rowByT.set(t, { t, ts: new Date(t).toLocaleString() });
    }
    for (const p of visible) {
      const pf = players[p.rsn];
      if (!pf) continue;
      // Use last snapshot at-or-before each timeline t.
      let v: number | undefined;
      let cursor = 0;
      const snaps = pf.snapshots;
      for (const t of ts) {
        while (cursor < snaps.length && Date.parse(snaps[cursor].t) <= t) {
          const computed = valueFromSnapshot(snaps[cursor]);
          if (computed !== undefined) v = computed;
          cursor++;
        }
        if (v !== undefined) rowByT.get(t)![p.rsn] = v;
      }
    }

    // Per-player linear-regression projection over the in-range snapshots.
    // Extrapolate forward by exactly one period; "all" range caps at 1 year.
    const rangeMs = RANGE_OPTIONS.find((r) => r.key === range)!.ms;
    const extrapMs = rangeMs ?? 365 * 24 * 3600_000;
    const now = Date.now();
    const extrapEnd = now + extrapMs;
    const projections: Array<{ rsn: string }> = [];
    for (const p of visible) {
      const pf = players[p.rsn];
      if (!pf) continue;
      const pts = snapshotsInRange(pf, range)
        .map((s) => ({ x: Date.parse(s.t), y: valueFromSnapshot(s) }))
        .filter((q): q is { x: number; y: number } => q.y !== undefined);
      if (pts.length < 2) continue;
      const n = pts.length;
      const meanX = pts.reduce((a, q) => a + q.x, 0) / n;
      const meanY = pts.reduce((a, q) => a + q.y, 0) / n;
      let num = 0, den = 0;
      for (const q of pts) {
        num += (q.x - meanX) * (q.y - meanY);
        den += (q.x - meanX) ** 2;
      }
      if (den === 0) continue;
      const slope = num / den; // y per ms
      const intercept = meanY - slope * meanX;
      const last = pts[pts.length - 1];
      if (last.y >= cap) continue; // already at / over the cap
      // Where (if anywhere) does the regression cross the cap?
      const capX = slope > 0 ? (cap - intercept) / slope : Infinity;
      const endT = Math.min(extrapEnd, capX);
      if (endT <= last.x) continue; // intercept is in the past — no useful projection
      const endY = Math.min(cap, slope * endT + intercept);
      const key = `${p.rsn}__pred`;
      const startRow = rowByT.get(last.x) ?? { t: last.x, ts: new Date(last.x).toLocaleString() };
      startRow[key] = last.y;
      rowByT.set(last.x, startRow);
      const endRow = rowByT.get(endT) ?? { t: endT, ts: new Date(endT).toLocaleString() };
      endRow[key] = endY;
      rowByT.set(endT, endRow);
      projections.push({ rsn: p.rsn });
    }

    const out = [...rowByT.values()].sort((a, b) => (a.t as number) - (b.t as number));
    return { data: out, projections };
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
                formatter={(v: number, name: string) => {
                  const display = yMode === "level"
                    ? (isOverall ? `total ${Math.round(v)}` : `level ${Math.round(v)}`)
                    : `${v.toLocaleString()} xp`;
                  if (name.endsWith("__pred")) {
                    return [display + " (projected)", name.slice(0, -"__pred".length)];
                  }
                  return [display, name];
                }}
              />
              <Legend
                wrapperStyle={{ color: "#f0e2c0" }}
                payload={visiblePlayers.map((p) => ({
                  value: p.rsn,
                  type: "line",
                  id: p.rsn,
                  color: colorFor(p.rsn),
                }))}
              />
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
              {projections.map((pr) => (
                <Line
                  key={`${pr.rsn}__pred`}
                  type="linear"
                  dataKey={`${pr.rsn}__pred`}
                  stroke={colorFor(pr.rsn)}
                  strokeDasharray="4 4"
                  strokeOpacity={0.7}
                  dot={false}
                  isAnimationActive={false}
                  connectNulls
                  strokeWidth={2}
                  legendType="none"
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </>
  );
}
