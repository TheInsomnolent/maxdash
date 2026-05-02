import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Area, CartesianGrid, ComposedChart, Legend, Line, ReferenceLine,
  ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis,
} from "recharts";
import { useUI } from "../App";
import { useData, snapshotsInRange, skillNameToIdx, filterPlayers, RANGE_OPTIONS } from "../store";
import { MAX_XP, MAX_TOTAL_XP, SKILLS, TRAINABLE_SKILLS, TRAINABLE_SKILL_COUNT, MAX_TOTAL_LEVEL, colorFor, xpToLevel } from "../skills";
import { SkillIcon } from "../components/SkillIcon";
import { buildForecast, MAX_HORIZON_DAYS, type ForecastResult } from "../forecast";

const SKILL_OPTIONS = ["Overall", ...TRAINABLE_SKILLS];
const DAY_MS = 86_400_000;

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
  const [focusedRsn, setFocusedRsn] = useState<string | null>(null);
  const cap = isOverall
    ? (yMode === "level" ? MAX_TOTAL_LEVEL : MAX_TOTAL_XP)
    : (yMode === "level" ? 99 : MAX_XP);
  const capLabel = isOverall
    ? (yMode === "level" ? `MAX / ${MAX_TOTAL_LEVEL}` : `MAX / ${(MAX_TOTAL_XP / 1_000_000).toFixed(0)}M`)
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

  // Resolve which player gets the "detailed" treatment (fan + scatter + smoothed
  // trendline). Manual focus wins; otherwise auto-focus when only one player is
  // visible so a solo view doesn't lose the variance fan.
  const visiblePlayers = useMemo(
    () => index ? filterPlayers(index.players, typeFilter, hideInactive) : [],
    [index, typeFilter, hideInactive],
  );
  const effectiveFocus = useMemo(() => {
    if (focusedRsn && visiblePlayers.some((p) => p.rsn === focusedRsn)) return focusedRsn;
    if (visiblePlayers.length === 1) return visiblePlayers[0].rsn;
    return null;
  }, [focusedRsn, visiblePlayers]);

  const { data, forecasts } = useMemo(() => {
    if (!index) return {
      data: [] as Array<Record<string, number | string | null>>,
      forecasts: new Map<string, ForecastResult>(),
    };

    // Forecast horizon = currently selected range length, capped at 1y.
    const rangeMs = RANGE_OPTIONS.find((r) => r.key === range)!.ms;
    const horizonDays = Math.min(
      MAX_HORIZON_DAYS,
      Math.max(1, Math.round((rangeMs ?? MAX_HORIZON_DAYS * DAY_MS) / DAY_MS)),
    );

    const forecasts = new Map<string, ForecastResult>();
    for (const p of visiblePlayers) {
      const pf = players[p.rsn];
      if (!pf) continue;
      const samples = snapshotsInRange(pf, range).map((s) => ({
        t: Date.parse(s.t),
        y: valueFromSnapshot(s),
      }));
      const fc = buildForecast(p.rsn, samples, cap, horizonDays);
      if (fc) forecasts.set(p.rsn, fc);
    }

    // Build the row-keyed timeline. Keys are timestamps (ms); each row holds
    // the columns needed by every series (history, smooth, p10/p50/p90,
    // observed scatter). Use null for absent values so Recharts skips them
    // cleanly (vs. undefined which can confuse `connectNulls`).
    const rowByT = new Map<number, Record<string, number | string | null>>();
    const rowAt = (t: number) => {
      let row = rowByT.get(t);
      if (!row) {
        row = { t, ts: new Date(t).toLocaleString() };
        rowByT.set(t, row);
      }
      return row;
    };

    for (const p of visiblePlayers) {
      const fc = forecasts.get(p.rsn);
      if (!fc) {
        // No forecast (sparse data, or maxed and we still want the history line)
        // — fall back to plotting raw snapshots so the solid line still draws.
        const pf = players[p.rsn];
        if (!pf) continue;
        for (const s of snapshotsInRange(pf, range)) {
          const v = valueFromSnapshot(s);
          if (v === undefined) continue;
          rowAt(Date.parse(s.t))[p.rsn] = v;
        }
        continue;
      }
      // Daily-interpolated history line.
      for (const h of fc.history) rowAt(h.dayMs)[p.rsn] = h.y;
      // Smoothed trendline + observed scatter for the focused player only.
      if (p.rsn === effectiveFocus) {
        for (const s of fc.smooth) rowAt(s.dayMs)[`${p.rsn}__smooth`] = s.y;
        for (const o of fc.observed) rowAt(o.dayMs)[`${p.rsn}__obs`] = o.y;
      }
      // Median + fan (fan only on focus). Anchor the first forecast row at the
      // last observed point so the dashed line meets the solid history line.
      if (fc.forecast.length > 0) {
        const anchor = rowAt(fc.lastDayMs);
        anchor[`${p.rsn}__p50`] = fc.lastY;
        if (p.rsn === effectiveFocus) {
          anchor[`${p.rsn}__p10`] = fc.lastY;
          anchor[`${p.rsn}__p90`] = fc.lastY;
        }
        for (const f of fc.forecast) {
          const row = rowAt(f.dayMs);
          row[`${p.rsn}__p50`] = f.p50;
          if (p.rsn === effectiveFocus) {
            row[`${p.rsn}__p10`] = f.p10;
            row[`${p.rsn}__p90`] = f.p90;
          }
        }
      }
    }

    const out = [...rowByT.values()].sort((a, b) => (a.t as number) - (b.t as number));
    return { data: out, forecasts };
  }, [index, players, range, idx, typeFilter, hideInactive, yMode, isOverall, cap, visiblePlayers, effectiveFocus]);

  if (!index) return null;

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
            {effectiveFocus && (
              <div className="range-bar" title="Focused player">
                <button
                  className="active"
                  onClick={() => setFocusedRsn(null)}
                  title="Clear focus"
                >FOCUS: {effectiveFocus} ✕</button>
              </div>
            )}
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
            <ComposedChart data={data} margin={{ top: 10, right: 96, bottom: 0, left: 0 }}>
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
                formatter={(v: number, key: string) => {
                  const display = yMode === "level"
                    ? (isOverall ? `total ${Math.round(v)}` : `level ${Math.round(v)}`)
                    : `${Math.round(v).toLocaleString()} xp`;
                  if (key.endsWith("__p50")) return [display + " (forecast P50)", key.slice(0, -"__p50".length)];
                  if (key.endsWith("__p10")) return [display + " (forecast P10)", key.slice(0, -"__p10".length)];
                  if (key.endsWith("__p90")) return [display + " (forecast P90)", key.slice(0, -"__p90".length)];
                  if (key.endsWith("__smooth")) return [display + " (7-day avg)", key.slice(0, -"__smooth".length)];
                  if (key.endsWith("__obs")) return [display + " (observed)", key.slice(0, -"__obs".length)];
                  return [display, key];
                }}
              />
              <Legend
                wrapperStyle={{ color: "#f0e2c0", cursor: "pointer" }}
                onClick={(e: { value?: string }) => {
                  const v = e.value;
                  if (!v) return;
                  setFocusedRsn((prev) => prev === v ? null : v);
                }}
                payload={visiblePlayers.map((p) => ({
                  value: p.rsn,
                  type: "line",
                  id: p.rsn,
                  color: colorFor(p.rsn),
                }))}
              />
              <ReferenceLine y={cap} stroke="#ffb43b" strokeDasharray="4 4" label={{ value: capLabel, fill: "#ffb43b", position: "right" }} />

              {/* Variance fan — only for the focused player. Rendered first
                  so it sits behind the lines. Uses a [low, high] tuple
                  accessor so Recharts paints a true band (not stacked from 0). */}
              {effectiveFocus && forecasts.get(effectiveFocus)?.forecast.length ? (
                <Area
                  key={`${effectiveFocus}__fan`}
                  type="monotone"
                  dataKey={(d: Record<string, number | null>) => {
                    const lo = d[`${effectiveFocus}__p10`];
                    const hi = d[`${effectiveFocus}__p90`];
                    return lo == null || hi == null ? null : [lo, hi];
                  }}
                  name={`${effectiveFocus}__fan`}
                  stroke="none"
                  fill={colorFor(effectiveFocus)}
                  fillOpacity={0.2}
                  isAnimationActive={false}
                  connectNulls
                  legendType="none"
                  activeDot={false}
                />
              ) : null}

              {/* History lines — every visible player. Dim non-focused when a
                  focus is set so the focused fan stays readable. */}
              {visiblePlayers.map((p) => {
                const dimmed = effectiveFocus !== null && p.rsn !== effectiveFocus;
                return (
                  <Line
                    key={p.rsn}
                    type="monotone"
                    dataKey={p.rsn}
                    stroke={colorFor(p.rsn)}
                    strokeOpacity={dimmed ? 0.35 : 1}
                    dot={false}
                    isAnimationActive={false}
                    connectNulls
                    strokeWidth={2}
                  />
                );
              })}

              {/* Smoothed 7-day trendline — focused player only. */}
              {effectiveFocus && (
                <Line
                  key={`${effectiveFocus}__smooth`}
                  type="monotone"
                  dataKey={`${effectiveFocus}__smooth`}
                  stroke={colorFor(effectiveFocus)}
                  strokeOpacity={0.55}
                  strokeWidth={1}
                  dot={false}
                  isAnimationActive={false}
                  connectNulls
                  legendType="none"
                />
              )}

              {/* Median forecast line — every non-maxed visible player. */}
              {visiblePlayers.map((p) => {
                const fc = forecasts.get(p.rsn);
                if (!fc || fc.forecast.length === 0) return null;
                const dimmed = effectiveFocus !== null && p.rsn !== effectiveFocus;
                return (
                  <Line
                    key={`${p.rsn}__p50`}
                    type="monotone"
                    dataKey={`${p.rsn}__p50`}
                    stroke={colorFor(p.rsn)}
                    strokeDasharray="4 4"
                    strokeOpacity={dimmed ? 0.35 : 0.85}
                    dot={false}
                    isAnimationActive={false}
                    connectNulls
                    strokeWidth={2}
                    legendType="none"
                  />
                );
              })}

              {/* Raw observed daily points — focused player only. */}
              {effectiveFocus && (
                <Scatter
                  key={`${effectiveFocus}__obs`}
                  dataKey={`${effectiveFocus}__obs`}
                  fill={colorFor(effectiveFocus)}
                  isAnimationActive={false}
                  legendType="none"
                  shape="circle"
                />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>
    </>
  );
}
