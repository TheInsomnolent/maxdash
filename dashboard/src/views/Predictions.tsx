import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Area, AreaChart, CartesianGrid, Legend, Line, LineChart, ReferenceArea, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { useData } from "../store";
import { MAX_XP, SKILLS, TRAINABLE_SKILLS, colorFor, xpForLevel, xpToLevel } from "../skills";
import { SkillIcon } from "../components/SkillIcon";
import { PlayerImage } from "../components/PlayerImage";
import { AccountBadge } from "../components/AccountBadge";
import { SKILL_METHODS } from "../predictions/methods";
import {
  methodProjection,
  regressForSkill,
  regressionEtaTs,
  simulateMethod,
  toDaysFromNow,
} from "../predictions/calc";

const REGRESSION_COLOR = "#f7d76b";

/** Format an hour count compactly: 0.5h, 12h, 3.4d, 2.1w, 1.5y. */
function formatHours(h: number): string {
  const n = Math.abs(h);
  if (n < 1) return `${(h).toFixed(1)}h`;
  if (n < 48) return `${Math.round(h)}h`;
  const d = h / 24;
  if (Math.abs(d) < 14) return `${d.toFixed(1)}d`;
  const w = d / 7;
  if (Math.abs(w) < 12) return `${w.toFixed(1)}w`;
  const y = d / 365;
  return `${y.toFixed(2)}y`;
}

/** Resolve a stable color for a strategy line, preferring the method's own color. */
function colorForMethod(skill: string, name: string): string {
  if (name === "Regression") return REGRESSION_COLOR;
  const m = (SKILL_METHODS[skill] ?? []).find((x) => x.name === name);
  if (m?.color) return m.color;
  // Hash → palette fallback so unknown strategies still get a deterministic hue.
  const palette = ["#4fc3f7", "#e57373", "#81c784", "#ffb74d", "#ba68c8", "#aed581", "#f06292"];
  let h = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return palette[Math.abs(h) % palette.length];
}

export function Predictions() {
  const { rsn } = useParams();
  const nav = useNavigate();
  const { players, index } = useData();

  if (!index) return null;
  const current = rsn && players[rsn] ? rsn : index.players[0]?.rsn;
  if (!current) return <div className="empty">No players.</div>;
  const pf = players[current];
  const meta = index.players.find((p) => p.rsn === current)!;

  return (
    <>
      <div className="panel">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem" }}>
          <h2 style={{ margin: 0, display: "inline-flex", alignItems: "center", gap: "0.5rem" }}>
            <PlayerImage rsn={current} size={32} />
            <span className="swatch" style={{ background: colorFor(current), color: colorFor(current) }} />
            <AccountBadge type={meta.type} />
            Predictions — {current}
          </h2>
          <select value={current} onChange={(e) => nav(`/predictions/${encodeURIComponent(e.target.value)}`)}>
            {index.players.map((p) => (
              <option key={p.rsn} value={p.rsn}>{p.rsn}</option>
            ))}
          </select>
        </div>
      </div>

      <TotalProjection rsn={current} />
      <SkillsGrid rsn={current} />
    </>
  );
}

/**
 * Stacked area of historical XP per skill, with a linear-regression projection
 * for each skill extending into the future. Each skill's projection is capped
 * at MAX_XP so the stack converges to the player's true ceiling (not infinity).
 */
function TotalProjection({ rsn }: { rsn: string }) {
  const { players } = useData();
  const pf = players[rsn];

  const data = useMemo(() => {
    if (!pf || pf.snapshots.length === 0) return [];
    // Historical samples — one row per snapshot, one numeric key per skill.
    const rows: Array<Record<string, number | string>> = pf.snapshots.map((s) => {
      const row: Record<string, number | string> = { t: Date.parse(s.t) };
      for (let i = 1; i < SKILLS.length; i++) {
        const v = s.s[i];
        row[SKILLS[i]] = v < 0 ? 0 : Math.min(v, MAX_XP);
      }
      return row;
    });
    // Future projection per skill via regression. We pick a horizon equal to
    // the longest per-skill ETA (capped at 5 years) so the chart shows every
    // skill cresting MAX_XP if possible.
    const now = Date.now();
    const projections: Array<{ skill: string; etaTs: number | null; lastXp: number; slope: number }> = [];
    let horizonTs = now;
    for (let i = 1; i < SKILLS.length; i++) {
      const reg = regressForSkill(pf, i, 14);
      if (!reg) {
        const last = pf.snapshots.at(-1)?.s[i] ?? 0;
        projections.push({ skill: SKILLS[i], etaTs: null, lastXp: last < 0 ? 0 : last, slope: 0 });
        continue;
      }
      const etaTs = regressionEtaTs(reg, MAX_XP);
      projections.push({ skill: SKILLS[i], etaTs, lastXp: reg.lastXp, slope: reg.slope });
      if (etaTs && etaTs > horizonTs) horizonTs = Math.min(etaTs, now + 365 * 86400_000);
    }
    if (horizonTs <= now) return rows;
    // Sample the future at 24 evenly-spaced points for smoothness.
    const STEPS = 24;
    const dt = (horizonTs - now) / STEPS;
    for (let k = 1; k <= STEPS; k++) {
      const t = now + k * dt;
      const row: Record<string, number | string> = { t };
      for (const p of projections) {
        if (p.slope <= 0) {
          row[p.skill] = p.lastXp;
        } else {
          const proj = p.lastXp + p.slope * (t - now);
          row[p.skill] = Math.min(MAX_XP, proj);
        }
      }
      rows.push(row);
    }
    return rows;
  }, [pf]);

  if (!data.length) {
    return (
      <div className="panel">
        <h2>Total XP projection</h2>
        <div className="empty">Need at least one snapshot.</div>
      </div>
    );
  }

  // Capture x-axis bounds so the ReferenceArea covers the entire future band.
  const nowTs = Date.now();
  const lastTs = (data[data.length - 1] as { t: number } | undefined)?.t ?? nowTs;

  return (
    <div className="panel" style={{ height: 420 }}>
      <h2>Total XP projection (stacked, linear regression)</h2>
      <div style={{ color: "var(--text-dim)", fontSize: "0.85rem", marginTop: "-0.25rem", marginBottom: "0.5rem" }}>
        <span style={{ display: "inline-block", width: 12, height: 12, background: "#8a6b3d", marginRight: 6, verticalAlign: "middle" }} />
        Solid = actual XP to date
        <span style={{ marginLeft: "1rem", display: "inline-block", width: 12, height: 12, background: "repeating-linear-gradient(45deg, #8a6b3d 0 3px, #2b1f12 3px 6px)", marginRight: 6, verticalAlign: "middle" }} />
        Hatched = projected (linear regression)
      </div>
      <ResponsiveContainer width="100%" height="85%">
        <AreaChart data={data} margin={{ top: 10, right: 24, bottom: 0, left: 0 }}>
          <defs>
            <pattern id="future-hatch" patternUnits="userSpaceOnUse" width="8" height="8" patternTransform="rotate(45)">
              <rect width="8" height="8" fill="#000" fillOpacity="0.35" />
              <line x1="0" y1="0" x2="0" y2="8" stroke="#000" strokeOpacity="0.55" strokeWidth="3" />
            </pattern>
          </defs>
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
            tickFormatter={(v) => (v >= 1_000_000 ? `${(v / 1_000_000).toFixed(0)}M` : v.toLocaleString())}
          />
          <Tooltip
            contentStyle={{ background: "#2b1f12", border: "2px solid #8a6b3d", color: "#f0e2c0" }}
            labelStyle={{ color: "#ffb43b" }}
            labelFormatter={(v) => {
              const ts = Number(v);
              const tag = ts > nowTs ? " (projected)" : "";
              return new Date(ts).toLocaleDateString() + tag;
            }}
            formatter={(v: number, n: string) => [`${v.toLocaleString()} xp`, n]}
          />
          {TRAINABLE_SKILLS.map((s, i) => (
            <Area
              key={s}
              type="monotone"
              dataKey={s}
              stackId="1"
              stroke={colorFor(`__skill__${i}`)}
              fill={colorFor(`__skill__${i}`)}
              fillOpacity={0.55}
              isAnimationActive={false}
            />
          ))}
          {/* Overlay a hatched dark band over the projected future region so
              it's instantly distinguishable from historical XP. */}
          {lastTs > nowTs && (
            <ReferenceArea
              x1={nowTs}
              x2={lastTs}
              fill="url(#future-hatch)"
              fillOpacity={1}
              stroke="none"
              ifOverflow="hidden"
            />
          )}
          <ReferenceLine
            x={nowTs}
            stroke="#ffb43b"
            strokeWidth={2}
            label={{ value: "today", fill: "#ffb43b", position: "insideTopRight" }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Grid of per-skill prediction charts. */
function SkillsGrid({ rsn }: { rsn: string }) {
  const { players } = useData();
  const pf = players[rsn];
  const [selected, setSelected] = useState<string>("Mining");

  const skill = selected;
  const idx = SKILLS.indexOf(skill as (typeof SKILLS)[number]);
  const lastSnap = pf?.snapshots.at(-1);
  const xp = lastSnap?.s[idx] ?? -1;
  const lvl = xp >= 0 ? xpToLevel(xp) : 1;
  const methods = SKILL_METHODS[skill] ?? [];

  /**
   * Build a unified Recharts-friendly dataset. Each row has a `d` (days from
   * now) and one numeric key per visible series. Because each series can have
   * different sample timestamps, we build a sorted union of all `d` values and
   * fill each series via linear interpolation between its own anchors.
   */
  const { data, series } = useMemo(() => {
    if (!pf || xp < 0 || xp >= MAX_XP) return { data: [], series: [] as string[] };
    const startTs = lastSnap ? Date.parse(lastSnap.t) : Date.now();
    type Sample = { t: number; xp: number };
    const seriesMap: Record<string, Sample[]> = {};

    const reg = regressForSkill(pf, idx, 14);
    if (reg) {
      const etaTs = regressionEtaTs(reg, MAX_XP);
      if (etaTs) {
        seriesMap.Regression = [
          { t: startTs, xp },
          { t: etaTs, xp: MAX_XP },
        ];
      }
    }
    for (const m of methods) {
      const proj = methodProjection(pf, idx, m);
      if (proj) seriesMap[m.name] = proj;
    }
    const seriesNames = Object.keys(seriesMap);
    if (!seriesNames.length) return { data: [], series: [] as string[] };

    // Union of all sample times (sorted), then linear-interpolate each series.
    const tsSet = new Set<number>();
    for (const name of seriesNames) for (const s of seriesMap[name]) tsSet.add(s.t);
    const ts = [...tsSet].sort((a, b) => a - b);

    const interp = (samples: Sample[], t: number): number | null => {
      if (t < samples[0].t || t > samples[samples.length - 1].t) return null;
      for (let i = 1; i < samples.length; i++) {
        if (t <= samples[i].t) {
          const a = samples[i - 1];
          const b = samples[i];
          if (b.t === a.t) return b.xp;
          return a.xp + ((b.xp - a.xp) * (t - a.t)) / (b.t - a.t);
        }
      }
      return samples[samples.length - 1].xp;
    };

    const rows = ts.map((t) => {
      const row: Record<string, number> = { h: (t - Date.now()) / 3_600_000 };
      for (const name of seriesNames) {
        const v = interp(seriesMap[name], t);
        if (v != null) row[name] = v;
      }
      return row;
    });
    return { data: rows, series: seriesNames };
  }, [pf, idx, xp, lastSnap, methods]);

  return (
    <div className="panel">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem", marginBottom: "0.5rem" }}>
        <h2 style={{ margin: 0, display: "inline-flex", alignItems: "center", gap: "0.5rem" }}>
          <SkillIcon name={skill} size={22} /> {skill} — to 99
        </h2>
        <select value={skill} onChange={(e) => setSelected(e.target.value)}>
          {TRAINABLE_SKILLS.map((s) => (
            <option key={s} value={s}>
              {s}{SKILL_METHODS[s] ? "" : " (regression only)"}
            </option>
          ))}
        </select>
      </div>

      <div style={{ color: "var(--text-dim)", fontSize: "0.9rem", marginBottom: "0.5rem" }}>
        Current: <strong style={{ color: "var(--accent)" }}>level {lvl}</strong>
        {xp >= 0 && <> — {xp.toLocaleString()} xp</>}
        {xp >= MAX_XP && " — already maxed"}
      </div>

      {data.length === 0 || xp >= MAX_XP ? (
        <div className="empty">
          {xp >= MAX_XP ? "Skill is maxed." : "No prediction available — need at least 2 snapshots over the last 14 days."}
        </div>
      ) : (
        <div style={{ height: 360 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 10, right: 24, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="#3a2614" strokeDasharray="3 3" />
              <XAxis
                dataKey="h"
                type="number"
                stroke="#b8a684"
                domain={["dataMin", "dataMax"]}
                tickFormatter={(v) => formatHours(v)}
                label={{ value: "hours from now", fill: "#b8a684", position: "insideBottom", offset: -2 }}
              />
              <YAxis
                stroke="#b8a684"
                domain={[xpForLevel(Math.max(1, lvl - 1)), MAX_XP]}
                tickFormatter={(v) => (v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : v.toLocaleString())}
              />
              <Tooltip
                contentStyle={{ background: "#2b1f12", border: "2px solid #8a6b3d", color: "#f0e2c0" }}
                labelStyle={{ color: "#ffb43b" }}
                labelFormatter={(v) => `+${formatHours(Number(v))}`}
                formatter={(v: number, n: string) => [`${Math.round(v).toLocaleString()} xp`, n]}
              />
              <Legend wrapperStyle={{ color: "#f0e2c0" }} />
              <ReferenceLine y={MAX_XP} stroke="#ffb43b" strokeDasharray="4 4" label={{ value: "99 / 13.0M", fill: "#ffb43b", position: "right" }} />
              {series.map((name) => (
                <Line
                  key={name}
                  type="monotone"
                  dataKey={name}
                  stroke={colorForMethod(skill, name)}
                  strokeWidth={2}
                  strokeDasharray={name === "Regression" ? "5 4" : undefined}
                  dot={false}
                  isAnimationActive={false}
                  connectNulls
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      <MethodsLegend skill={skill} lvl={lvl} />
    </div>
  );
}

function MethodsLegend({ skill, lvl }: { skill: string; lvl: number }) {
  const methods = SKILL_METHODS[skill];
  if (!methods?.length) {
    return (
      <div style={{ marginTop: "0.75rem", color: "var(--text-dim)", fontSize: "0.9rem" }}>
        Wiki training methods for <strong>{skill}</strong> aren't modelled yet — only the linear regression of recent activity is shown.
      </div>
    );
  }
  return (
    <div style={{ marginTop: "0.75rem", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "0.6rem" }}>
      {methods.map((m) => {
        const active = [...m.tiers].reverse().find((t) => t.minLvl <= lvl);
        return (
          <div key={m.name} style={{
            padding: "0.5rem 0.75rem",
            background: "#2a1a0d",
            border: "2px solid var(--border-2)",
            borderRadius: 3,
            boxShadow: "inset 0 0 0 1px #000",
          }}>
            <div style={{
              fontFamily: "RuneScape, serif",
              fontWeight: 700,
              color: colorForMethod(skill, m.name),
              fontSize: "1.05rem",
            }}>
              {m.name}
              {active && (
                <span style={{ color: "var(--text-dim)", marginLeft: "0.5rem", fontSize: "0.85rem", fontWeight: "normal" }}>
                  current: {active.label} • {active.xpPerHour.toLocaleString()} xp/hr
                </span>
              )}
            </div>
            <div style={{ fontSize: "0.85rem", color: "var(--text-dim)", marginTop: "0.2rem" }}>
              {m.description}
            </div>
            <ul style={{ margin: "0.4rem 0 0 0", paddingLeft: "1.1rem", fontSize: "0.85rem" }}>
              {m.tiers.map((t) => (
                <li key={t.minLvl} style={{ opacity: t.minLvl <= lvl ? 1 : 0.55 }}>
                  Lv {t.minLvl}+: {t.label} — {t.xpPerHour.toLocaleString()} xp/hr
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

// Suppress unused warning when neither helper is referenced (for tree-shake).
void simulateMethod;
void toDaysFromNow;
