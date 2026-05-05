import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Area, CartesianGrid, ComposedChart, Legend, Line, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
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
  // Players the user has clicked off in the legend. Everyone is visible by default.
  const [hiddenRsns, setHiddenRsns] = useState<Set<string>>(() => new Set());
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

  // Roster of every player the current filter set considers — used to render
  // the legend so toggled-off players are still listed and re-clickable.
  const allPlayers = useMemo(
    () => index ? filterPlayers(index.players, typeFilter, hideInactive) : [],
    [index, typeFilter, hideInactive],
  );
  // Players actually drawn on the chart this render.
  const visiblePlayers = useMemo(
    () => allPlayers.filter((p) => !hiddenRsns.has(p.rsn)),
    [allPlayers, hiddenRsns],
  );

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
    // the columns needed by every series (history, smooth, p10/p50/p90).
    // Use null for absent values so Recharts skips them cleanly (vs. undefined
    // which can confuse `connectNulls`).
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
      // Daily-interpolated history line + smoothed trendline for every visible
      // player. The smoothed series is rendered subtly underneath the raw
      // history so it reads as a "trend" rather than a competing line.
      for (const h of fc.history) rowAt(h.dayMs)[p.rsn] = h.y;
      for (const s of fc.smooth) rowAt(s.dayMs)[`${p.rsn}__smooth`] = s.y;
      // Median + fan. Anchor the first forecast row at the last observed point
      // so the dashed line meets the solid history line.
      if (fc.forecast.length > 0) {
        const anchor = rowAt(fc.lastDayMs);
        anchor[`${p.rsn}__p50`] = fc.lastY;
        anchor[`${p.rsn}__p05`] = fc.lastY;
        anchor[`${p.rsn}__p20`] = fc.lastY;
        anchor[`${p.rsn}__p35`] = fc.lastY;
        anchor[`${p.rsn}__p65`] = fc.lastY;
        anchor[`${p.rsn}__p80`] = fc.lastY;
        anchor[`${p.rsn}__p95`] = fc.lastY;
        for (const f of fc.forecast) {
          const row = rowAt(f.dayMs);
          row[`${p.rsn}__p05`] = f.p05;
          row[`${p.rsn}__p20`] = f.p20;
          row[`${p.rsn}__p35`] = f.p35;
          row[`${p.rsn}__p50`] = f.p50;
          row[`${p.rsn}__p65`] = f.p65;
          row[`${p.rsn}__p80`] = f.p80;
          row[`${p.rsn}__p95`] = f.p95;
        }
      }
    }

    const out = [...rowByT.values()].sort((a, b) => (a.t as number) - (b.t as number));
    return { data: out, forecasts };
  }, [index, players, range, idx, typeFilter, hideInactive, yMode, isOverall, cap, visiblePlayers]);

  if (!index) return null;

  // Per-band opacity scales down as more players are visible so overlapping
  // bands don't smother the lines underneath. Three bands stack to ~3x the
  // base opacity at the median, giving a darker core that fades outward.
  const bandOpacity = visiblePlayers.length > 0
    ? Math.max(0.04, 0.13 - 0.012 * visiblePlayers.length)
    : 0.10;
  const FAN_BANDS: Array<{ lo: string; hi: string }> = [
    { lo: "__p05", hi: "__p95" },
    { lo: "__p20", hi: "__p80" },
    { lo: "__p35", hi: "__p65" },
  ];

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
                // Custom content so we can suppress the forecast quantile
                // bands and the smoothing line — otherwise the tooltip
                // balloons to one row per band per visible player.
                content={(props: {
                  active?: boolean;
                  label?: number | string;
                  payload?: Array<{ dataKey?: string | number; name?: string; value?: number; color?: string }>;
                }) => {
                  if (!props.active || !props.payload || props.payload.length === 0) return null;
                  // Keep the main per-player history line and the median
                  // forecast line (__p50). Drop fan bands (__fan…) and the
                  // 7-day smoothing line (__smooth). Fan Areas use a
                  // function dataKey, so we match on `name` too.
                  const rows = props.payload.filter((p) => {
                    const name = typeof p.name === "string" ? p.name : "";
                    const key = typeof p.dataKey === "string" ? p.dataKey : "";
                    const tag = name.includes("__") ? name : key;
                    if (!tag.includes("__")) return true;
                    if (!tag.endsWith("__p50")) return false;
                    // Only show the forecast row when it actually has a
                    // value at this x — otherwise we'd render a stale "—"
                    // for every player on historical samples.
                    return typeof p.value === "number" && Number.isFinite(p.value);
                  });
                  if (rows.length === 0) return null;
                  const labelText = props.label != null ? new Date(Number(props.label)).toLocaleString() : "";
                  return (
                    <div style={{ background: "#2b1f12", border: "2px solid #8a6b3d", color: "#f0e2c0", padding: "6px 10px" }}>
                      <div style={{ color: "#ffb43b", marginBottom: 4 }}>{labelText}</div>
                      {rows.map((r) => {
                        const v = typeof r.value === "number" ? r.value : NaN;
                        const name = typeof r.name === "string" ? r.name : "";
                        const isForecast = name.endsWith("__p50");
                        const rsn = isForecast ? name.slice(0, -"__p50".length) : (name || String(r.dataKey));
                        const display = Number.isFinite(v)
                          ? (yMode === "level"
                              ? (isOverall ? `total ${Math.round(v)}` : `level ${Math.round(v)}`)
                              : `${Math.round(v).toLocaleString()} xp`)
                          : "—";
                        return (
                          <div key={String(r.dataKey) + name} style={{ color: r.color }}>
                            {rsn} : {display}{isForecast ? " (forecast)" : ""}
                          </div>
                        );
                      })}
                    </div>
                  );
                }}
              />
              <Legend
                wrapperStyle={{ color: "#f0e2c0", cursor: "pointer" }}
                onClick={(e: { value?: string }) => {
                  const v = e.value;
                  if (!v) return;
                  setHiddenRsns((prev) => {
                    const next = new Set(prev);
                    if (next.has(v)) next.delete(v);
                    else next.add(v);
                    return next;
                  });
                }}
                payload={allPlayers.map((p) => ({
                  value: p.rsn,
                  type: "line",
                  id: p.rsn,
                  // Inactive (hidden) entries get a desaturated swatch so the
                  // user can see at a glance which series are toggled off.
                  color: hiddenRsns.has(p.rsn) ? "#6b5a3d" : colorFor(p.rsn),
                }))}
              />
              <ReferenceLine y={cap} stroke="#ffb43b" strokeDasharray="4 4" label={{ value: capLabel, fill: "#ffb43b", position: "right" }} />

              {/* Variance fans — three nested quantile bands per visible player
                  (p05/p95, p20/p80, p35/p65). Rendered first so they sit
                  behind the lines, and stacked at a low per-band opacity so
                  the median region naturally appears darker. The dataKey
                  accessor returns a [low, high] tuple so Recharts paints a
                  true band rather than stacking from 0. */}
              {visiblePlayers.map((p) => {
                const fc = forecasts.get(p.rsn);
                if (!fc || fc.forecast.length === 0) return null;
                return FAN_BANDS.map((band) => {
                  const loKey = `${p.rsn}${band.lo}`;
                  const hiKey = `${p.rsn}${band.hi}`;
                  return (
                    <Area
                      key={`${p.rsn}__fan${band.lo}`}
                      type="monotone"
                      dataKey={(d: Record<string, number | null>) => {
                        const lo = d[loKey];
                        const hi = d[hiKey];
                        return lo == null || hi == null ? null : [lo, hi];
                      }}
                      name={`${p.rsn}__fan${band.lo}`}
                      stroke="none"
                      fill={colorFor(p.rsn)}
                      fillOpacity={bandOpacity}
                      isAnimationActive={false}
                      connectNulls
                      legendType="none"
                      activeDot={false}
                    />
                  );
                });
              })}

              {/* Smoothed 7-day trendline — every visible player. Drawn before
                  the raw history so the solid line sits on top. */}
              {visiblePlayers.map((p) => (
                <Line
                  key={`${p.rsn}__smooth`}
                  type="monotone"
                  dataKey={`${p.rsn}__smooth`}
                  stroke={colorFor(p.rsn)}
                  strokeOpacity={0.5}
                  strokeWidth={1}
                  dot={false}
                  isAnimationActive={false}
                  connectNulls
                  legendType="none"
                />
              ))}

              {/* History lines — every visible player. */}
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
                  legendType="none"
                />
              ))}

              {/* Median forecast line — every visible non-maxed player. */}
              {visiblePlayers.map((p) => {
                const fc = forecasts.get(p.rsn);
                if (!fc || fc.forecast.length === 0) return null;
                return (
                  <Line
                    key={`${p.rsn}__p50`}
                    type="monotone"
                    dataKey={`${p.rsn}__p50`}
                    stroke={colorFor(p.rsn)}
                    strokeDasharray="4 4"
                    strokeOpacity={0.85}
                    dot={false}
                    isAnimationActive={false}
                    connectNulls
                    strokeWidth={2}
                    legendType="none"
                  />
                );
              })}
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>
    </>
  );
}
