import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Area, CartesianGrid, ComposedChart, Legend, Line, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { useUI } from "../App";
import { useData, latestSnapshot, snapshotsInRange, skillNameToIdx, filterPlayers, cappedTotalXpFromSnapshot, RANGE_OPTIONS } from "../store";
import { MAX_XP, MAX_TOTAL_XP, SKILLS, TRAINABLE_SKILLS, TRAINABLE_SKILL_COUNT, MAX_TOTAL_LEVEL, colorFor, xpToLevel } from "../skills";
import { SkillIcon } from "../components/SkillIcon";
import { buildForecast, MAX_HORIZON_DAYS, type ForecastResult } from "../forecast";
import { XP_RATES, formatHours, type TrainableSkillName } from "../xprates";
import {
  formatDays, methodProjection, projectionSeries,
  remainingXpForOverall, remainingXpForSkill,
} from "../projection";

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
  // Whether each skill's XP contribution is capped at level 99 (13,034,431).
  // Enabled by default so "maxing" progress isn't skewed by post-99 XP.
  const [capXp, setCapXp] = useState(true);
  // Players the user has clicked off in the legend. Everyone is visible by default.
  const [hiddenRsns, setHiddenRsns] = useState<Set<string>>(() => new Set());
  // Method projection inputs — kept as strings so the fields can be emptied.
  const [projRsn, setProjRsn] = useState("");
  const [projRate, setProjRate] = useState("");
  const [projHoursPerDay, setProjHoursPerDay] = useState("");
  const cap = isOverall
    ? (yMode === "level" ? MAX_TOTAL_LEVEL : (capXp ? MAX_TOTAL_XP : Infinity))
    : (yMode === "level" ? 99 : (capXp ? MAX_XP : Infinity));
  const capLabel = isOverall
    ? (yMode === "level" ? `MAX / ${MAX_TOTAL_LEVEL}` : `MAX / ${(MAX_TOTAL_XP / 1_000_000).toFixed(0)}M`)
    : (yMode === "level" ? "99" : "99 / 13.0M");

  /** Convert a snapshot's raw skill array into the y-axis value for the active mode. */
  const valueFromSnapshot = (s: { s: number[] }): number | undefined => {
    if (yMode === "xp") {
      if (isOverall) {
        if (!capXp) {
          const x = s.s[0];
          return x >= 0 ? x : undefined;
        }
        // Sum each skill's XP capped at level 99 individually — a single
        // skill trained well past 99 shouldn't inflate progress towards
        // "maxed" (see #15). Reuses the same helper as the Overall table
        // and the method-projection anchor below, so the three stay in sync.
        const any = s.s.slice(1).some((x) => x >= 0);
        return any ? cappedTotalXpFromSnapshot(s.s) : undefined;
      }
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

  // Forecast/projection horizon = currently selected range length, capped at 1y.
  const horizonDays = useMemo(() => {
    const rangeMs = RANGE_OPTIONS.find((r) => r.key === range)!.ms;
    return Math.min(
      MAX_HORIZON_DAYS,
      Math.max(1, Math.round((rangeMs ?? MAX_HORIZON_DAYS * DAY_MS) / DAY_MS)),
    );
  }, [range]);

  // Method projection — a flat XP rate for one player, optionally converted to
  // calendar time via an hours-per-day grind.
  const projection = useMemo(() => {
    if (!index || !projRsn) return null;
    const pf = players[projRsn];
    const snap = pf ? latestSnapshot(pf) : null;
    if (!snap) return null;
    const remainingXp = isOverall ? remainingXpForOverall(snap.s) : remainingXpForSkill(snap.s[idx]);
    const summary = methodProjection(
      remainingXp,
      Number(projRate),
      Number(projHoursPerDay),
      Date.parse(snap.t),
    );
    if (!summary) return null;
    // For Overall, anchor the projection at the capped total (each skill's XP
    // capped at 99) so it lines up with remainingXp and the plotted history —
    // otherwise post-99 XP in any one skill would offset the starting point.
    const currentXp = isOverall ? cappedTotalXpFromSnapshot(snap.s) : Math.max(0, snap.s[idx]);
    return { ...summary, currentXp };
  }, [index, players, projRsn, projRate, projHoursPerDay, idx, isOverall]);

  // The projected line can only be drawn where a flat XP rate maps onto the
  // y-axis: total level can't be derived from a lump of untargeted XP.
  const canDrawProjection = yMode === "xp" || !isOverall;
  const methodRsn = projection && projection.daysToMax !== null && canDrawProjection && !hiddenRsns.has(projRsn)
    ? projRsn
    : null;
  /** Reference rates for the selected skill, offered as one-click presets. */
  const referenceRate = isOverall ? null : XP_RATES[skill as TrainableSkillName];

  const { data, forecasts } = useMemo(() => {
    if (!index) return {
      data: [] as Array<Record<string, number | string | null>>,
      forecasts: new Map<string, ForecastResult>(),
    };

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
      // so the dashed line meets the solid history line. Skipped for the player
      // being projected — their fit line is replaced by the method line.
      if (fc.forecast.length > 0 && p.rsn !== methodRsn) {
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

    // Method projection line — a straight climb from the projected player's
    // last observed day at their effective (rate × hours/day) pace.
    if (methodRsn && projection && projection.daysToMax !== null) {
      const fc = forecasts.get(methodRsn);
      if (fc) {
        const toY = (xp: number) =>
          yMode === "level" ? xpToLevel(xp) : Math.min(xp, cap);
        const series = projectionSeries(
          fc.lastDayMs,
          projection.currentXp,
          projection.remainingXp,
          projection.xpPerDay,
          horizonDays,
          toY,
        );
        for (const pt of series) rowAt(pt.dayMs)[`${methodRsn}__method`] = pt.y;
      }
    }

    const out = [...rowByT.values()].sort((a, b) => (a.t as number) - (b.t as number));
    return { data: out, forecasts };
  }, [
    index, players, range, idx, typeFilter, hideInactive, yMode, isOverall, cap, capXp,
    visiblePlayers, horizonDays, methodRsn, projection,
  ]);

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
            <div
              className="range-bar"
              title="Cap each skill's XP contribution at level 99 (13,034,431) — off shows raw XP and switches the Y-axis max to auto"
            >
              <button
                className={capXp ? "active" : ""}
                onClick={() => setCapXp(true)}
              >Capped</button>
              <button
                className={!capXp ? "active" : ""}
                onClick={() => setCapXp(false)}
              >Uncapped</button>
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
                  yMin === "auto" || !Number.isFinite(cap) ? ("dataMax" as const) : cap,
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
                    if (!tag.endsWith("__p50") && !tag.endsWith("__method")) return false;
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
                        const isProjection = name.endsWith("__method");
                        const rsn = isForecast ? name.slice(0, -"__p50".length)
                          : isProjection ? name.slice(0, -"__method".length)
                          : (name || String(r.dataKey));
                        const display = Number.isFinite(v)
                          ? (yMode === "level"
                              ? (isOverall ? `total ${Math.round(v)}` : `level ${Math.round(v)}`)
                              : `${Math.round(v).toLocaleString()} xp`)
                          : "—";
                        return (
                          <div key={String(r.dataKey) + name} style={{ color: r.color }}>
                            {rsn} : {display}{isForecast ? " (forecast)" : isProjection ? " (projection)" : ""}
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
              {Number.isFinite(cap) && (
                <ReferenceLine y={cap} stroke="#ffb43b" strokeDasharray="4 4" label={{ value: capLabel, fill: "#ffb43b", position: "right" }} />
              )}

              {/* Variance fans — three nested quantile bands per visible player
                  (p05/p95, p20/p80, p35/p65). Rendered first so they sit
                  behind the lines, and stacked at a low per-band opacity so
                  the median region naturally appears darker. The dataKey
                  accessor returns a [low, high] tuple so Recharts paints a
                  true band rather than stacking from 0. */}
              {visiblePlayers.map((p) => {
                const fc = forecasts.get(p.rsn);
                if (p.rsn === methodRsn) return null;
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

              {/* Median forecast line — every visible non-maxed player, except
                  the one whose fit line is replaced by a method projection. */}
              {visiblePlayers.map((p) => {
                const fc = forecasts.get(p.rsn);
                if (p.rsn === methodRsn) return null;
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

              {/* Method projection line — flat effective rate for one player. */}
              {methodRsn && (
                <Line
                  key={`${methodRsn}__method`}
                  type="linear"
                  dataKey={`${methodRsn}__method`}
                  stroke={colorFor(methodRsn)}
                  strokeDasharray="8 3"
                  dot={false}
                  isAnimationActive={false}
                  connectNulls
                  strokeWidth={2}
                  legendType="none"
                />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="panel">
        <h3 style={{ margin: "0 0 0.25rem" }}>Method projection</h3>
        <p style={{ margin: 0, color: "var(--text-dim)", fontSize: "0.9rem" }}>
          Pick a player and an XP/hr rate to see how many hours of grinding are left.
          Add hours per day to swap their forecast fit line for one matching that
          effective rate, and get a day count{isOverall ? " to max" : " until 99"}.
        </p>

        <div className="goal-form">
          <select value={projRsn} onChange={(e) => setProjRsn(e.target.value)}>
            <option value="">Select player…</option>
            {allPlayers.map((p) => (
              <option key={p.rsn} value={p.rsn}>{p.rsn}</option>
            ))}
          </select>
          <input
            type="number"
            min={0}
            step={1000}
            value={projRate}
            onChange={(e) => setProjRate(e.target.value)}
            placeholder="XP per hour"
            style={{ width: 140 }}
          />
          <input
            type="number"
            min={0}
            step={0.5}
            value={projHoursPerDay}
            onChange={(e) => setProjHoursPerDay(e.target.value)}
            placeholder="Hours per day (optional)"
            style={{ width: 190 }}
          />
          {referenceRate && (
            <>
              <button
                className="btn"
                onClick={() => setProjRate(String(referenceRate.afk))}
                title={`AFK: ${referenceRate.afkMethod}`}
              >AFK {Math.round(referenceRate.afk / 1000).toLocaleString()}k</button>
              <button
                className="btn"
                onClick={() => setProjRate(String(referenceRate.active))}
                title={`Active: ${referenceRate.activeMethod}`}
              >Active {Math.round(referenceRate.active / 1000).toLocaleString()}k</button>
            </>
          )}
          {(projRsn || projRate || projHoursPerDay) && (
            <button
              className="btn"
              onClick={() => { setProjRsn(""); setProjRate(""); setProjHoursPerDay(""); }}
            >Clear</button>
          )}
        </div>

        {projection && (
          <>
            <div className="kpis" style={{ marginTop: "0.75rem" }}>
              <div className="kpi">
                <div className="label">XP remaining</div>
                <div className="value">
                  {projection.remainingXp >= 1_000_000
                    ? `${(projection.remainingXp / 1_000_000).toFixed(1)}M`
                    : projection.remainingXp.toLocaleString()}
                </div>
              </div>
              <div className="kpi">
                <div className="label">Hours {isOverall ? "to max" : "to 99"}</div>
                <div className="value">{formatHours(projection.hoursToMax)}</div>
              </div>
              {projection.daysToMax !== null && (
                <div className="kpi">
                  <div className="label">Days {isOverall ? "to max" : "to 99"}</div>
                  <div className="value">{formatDays(projection.daysToMax)}</div>
                </div>
              )}
              {projection.etaMs !== null && (
                <div className="kpi">
                  <div className="label">Projected finish</div>
                  <div className="value" style={{ fontSize: "1.15rem" }}>
                    {new Date(projection.etaMs).toLocaleDateString()}
                  </div>
                </div>
              )}
            </div>
            {projection.daysToMax !== null && !canDrawProjection && (
              <p style={{ margin: "0.5rem 0 0", color: "var(--text-dim)", fontSize: "0.85rem" }}>
                Switch the y-axis to XP to see the projected line for Overall.
              </p>
            )}
            {methodRsn && projection.daysToMax !== null && projection.daysToMax > horizonDays && (
              <p style={{ margin: "0.5rem 0 0", color: "var(--text-dim)", fontSize: "0.85rem" }}>
                The projected line stops at the end of the chart horizon ({horizonDays} days) —
                pick a longer range to follow it all the way.
              </p>
            )}
            {projection.daysToMax !== null && hiddenRsns.has(projRsn) && (
              <p style={{ margin: "0.5rem 0 0", color: "var(--text-dim)", fontSize: "0.85rem" }}>
                {projRsn} is hidden — click them in the legend to see the projected line.
              </p>
            )}
          </>
        )}
      </div>
    </>
  );
}
