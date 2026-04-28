import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  CartesianGrid, Legend, Line, LineChart, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { useUI } from "../App";
import { useData, snapshotsInRange, skillNameToIdx, filterPlayers, RANGE_OPTIONS } from "../store";
import { MAX_XP, MAX_TOTAL_XP, SKILLS, TRAINABLE_SKILLS, TRAINABLE_SKILL_COUNT, MAX_TOTAL_LEVEL, colorFor, xpToLevel } from "../skills";
import { SkillIcon } from "../components/SkillIcon";

const SKILL_OPTIONS = ["Overall", ...TRAINABLE_SKILLS];

type FitModel = "simple" | "snowball" | "method" | "smart";
const FIT_MODELS: Array<{ key: FitModel; label: string; title: string }> = [
  { key: "simple", label: "Simple", title: "Linear regression over the visible range" },
  { key: "snowball", label: "Snowball", title: "Quadratic fit — captures accelerating gains" },
  { key: "method", label: "Method", title: "Piecewise linear — fits the most recent training pace" },
  { key: "smart", label: "Smart", title: "EMA-weighted slope — recent samples count more (default)" },
];

interface Projection {
  /** Sampled curve, anchored at the player's last observed point. */
  samples: Array<{ x: number; y: number }>;
  /** Earliest x covered by the projection (= the player's last observation). */
  startX: number;
  /** Latest x covered by the projection (cap intercept or extrapolation end). */
  endX: number;
  /** Evaluate the fitted curve at any x within [startX, endX]. */
  predict: (x: number) => number;
}

/**
 * Build a projection curve from a set of in-range (x=ms, y) samples using the
 * chosen fit model. Returns null when there isn't enough data, the player has
 * already hit the cap, or the model degenerates. Sampled points are clamped to
 * [0, cap]; the start sample is forced to the player's last observed value so
 * the dashed projection visually anchors to the solid history line.
 */
function fitProjection(
  pts: Array<{ x: number; y: number }>,
  model: FitModel,
  cap: number,
  extrapEnd: number,
): Projection | null {
  if (pts.length < 2) return null;
  const last = pts[pts.length - 1];
  if (last.y >= cap) return null;

  let predict: (x: number) => number;
  let curved = false;

  if (model === "simple") {
    const fit = ols(pts);
    if (!fit) return null;
    predict = (x) => fit.slope * x + fit.intercept;
  } else if (model === "method") {
    // Fit OLS to the most recent third of the window (min 2 points) so the
    // line tracks the player's current training pace rather than mixing in
    // older / different methods.
    const k = Math.max(2, Math.ceil(pts.length / 3));
    const fit = ols(pts.slice(-k));
    if (!fit) return null;
    predict = (x) => fit.slope * x + fit.intercept;
  } else if (model === "smart") {
    // Time-weighted average rate, anchored at the last observed point.
    // Each per-snapshot segment contributes its dy weighted by exp(-age/τ),
    // where age is the segment midpoint distance from `last.x` and τ is a
    // half-life proportional to the visible window (min 3d, max 60d).
    // This avoids the failure mode of a sample-count-based EMA, where a
    // long tail of hourly "no XP gained" snapshots collapses the slope to 0
    // even though the player was actively training a few days earlier.
    const span = Math.max(1, last.x - pts[0].x);
    const halflife = Math.max(3 * 86400_000, Math.min(60 * 86400_000, span / 4));
    const decay = Math.LN2 / halflife;
    let num = 0, den = 0;
    for (let i = 1; i < pts.length; i++) {
      const dx = pts[i].x - pts[i - 1].x;
      if (dx <= 0) continue;
      const dy = pts[i].y - pts[i - 1].y;
      const age = last.x - (pts[i].x + pts[i - 1].x) / 2;
      const w = Math.exp(-decay * age);
      num += dy * w;
      den += dx * w;
    }
    if (den <= 0) return null;
    const slope = num / den;
    predict = (x) => last.y + slope * (x - last.x);
  } else {
    // snowball — quadratic OLS, x normalized to [0,1] for numerical stability.
    curved = true;
    const x0 = pts[0].x;
    const span = Math.max(1, last.x - x0);
    let S0 = 0, S1 = 0, S2 = 0, S3 = 0, S4 = 0, Sy = 0, Sxy = 0, Sxxy = 0;
    for (const q of pts) {
      const u = (q.x - x0) / span;
      const u2 = u * u;
      S0 += 1; S1 += u; S2 += u2; S3 += u2 * u; S4 += u2 * u2;
      Sy += q.y; Sxy += u * q.y; Sxxy += u2 * q.y;
    }
    const aug: number[][] = [
      [S0, S1, S2, Sy],
      [S1, S2, S3, Sxy],
      [S2, S3, S4, Sxxy],
    ];
    if (!gauss3(aug)) return null;
    const c2 = aug[2][3] / aug[2][2];
    const c1 = (aug[1][3] - aug[1][2] * c2) / aug[1][1];
    const c0 = (aug[0][3] - aug[0][1] * c1 - aug[0][2] * c2) / aug[0][0];
    predict = (x) => {
      const u = (x - x0) / span;
      return c0 + c1 * u + c2 * u * u;
    };
  }

  // Find earliest x > last.x where the curve hits the cap, via bisection.
  let capX = Infinity;
  if (predict(extrapEnd) >= cap) {
    let lo = last.x, hi = extrapEnd;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (predict(mid) >= cap) hi = mid; else lo = mid;
    }
    capX = hi;
  }
  const endT = Math.min(extrapEnd, capX);
  if (endT <= last.x) return null;

  // Sample the curve. Linear models only need two points; quadratic needs more.
  const N = curved ? 32 : 2;
  const samples: Array<{ x: number; y: number }> = [];
  const clampedPredict = (x: number) => Math.min(cap, Math.max(0, predict(x)));
  for (let i = 0; i < N; i++) {
    const t = last.x + ((endT - last.x) * i) / (N - 1);
    samples.push({ x: t, y: clampedPredict(t) });
  }
  // Anchor the first sample to the actual last observation so the dashed line
  // visually meets the solid history line exactly.
  samples[0] = { x: last.x, y: last.y };
  return { samples, startX: last.x, endX: endT, predict: clampedPredict };
}

function ols(pts: Array<{ x: number; y: number }>): { slope: number; intercept: number } | null {
  const n = pts.length;
  if (n < 2) return null;
  const meanX = pts.reduce((a, q) => a + q.x, 0) / n;
  const meanY = pts.reduce((a, q) => a + q.y, 0) / n;
  let num = 0, den = 0;
  for (const q of pts) { num += (q.x - meanX) * (q.y - meanY); den += (q.x - meanX) ** 2; }
  if (den === 0) return null;
  const slope = num / den;
  return { slope, intercept: meanY - slope * meanX };
}

/** In-place Gaussian elimination on a 3x4 augmented matrix. Returns false on singular. */
function gauss3(m: number[][]): boolean {
  for (let i = 0; i < 3; i++) {
    let pivot = i;
    for (let k = i + 1; k < 3; k++) if (Math.abs(m[k][i]) > Math.abs(m[pivot][i])) pivot = k;
    [m[i], m[pivot]] = [m[pivot], m[i]];
    if (Math.abs(m[i][i]) < 1e-12) return false;
    for (let k = i + 1; k < 3; k++) {
      const f = m[k][i] / m[i][i];
      for (let j = i; j < 4; j++) m[k][j] -= f * m[i][j];
    }
  }
  return true;
}

/**
 * Find every x in [lo, hi] where a(x) - b(x) changes sign, by walking N coarse
 * samples and bisecting each sign-change bracket. Handles both linear (≤1
 * crossing) and quadratic (≤2 crossings) projection pairs.
 */
function findCrossings(
  a: (x: number) => number,
  b: (x: number) => number,
  lo: number,
  hi: number,
): number[] {
  if (hi <= lo) return [];
  const N = 64;
  const out: number[] = [];
  const f = (x: number) => a(x) - b(x);
  let prevX = lo;
  let prevF = f(lo);
  for (let i = 1; i <= N; i++) {
    const x = lo + ((hi - lo) * i) / N;
    const fx = f(x);
    if (prevF === 0) out.push(prevX);
    else if ((prevF < 0 && fx > 0) || (prevF > 0 && fx < 0)) {
      // Bisect [prevX, x] for the root.
      let l = prevX, r = x, fl = prevF;
      for (let k = 0; k < 50; k++) {
        const m = (l + r) / 2;
        const fm = f(m);
        if (fm === 0) { l = r = m; break; }
        if ((fl < 0 && fm < 0) || (fl > 0 && fm > 0)) { l = m; fl = fm; } else { r = m; }
      }
      out.push((l + r) / 2);
    }
    prevX = x; prevF = fx;
  }
  return out;
}

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
  const [fitModel, setFitModel] = useState<FitModel>("smart");
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

    // Per-player projection over the in-range snapshots using the active fit
    // model. Extrapolate forward by exactly one period; "all" range caps at 1y.
    const rangeMs = RANGE_OPTIONS.find((r) => r.key === range)!.ms;
    const extrapMs = rangeMs ?? 365 * 24 * 3600_000;
    const now = Date.now();
    const extrapEnd = now + extrapMs;
    const projections: Array<{ rsn: string }> = [];
    const fits: Array<{ rsn: string; proj: Projection }> = [];
    for (const p of visible) {
      const pf = players[p.rsn];
      if (!pf) continue;
      const pts = snapshotsInRange(pf, range)
        .map((s) => ({ x: Date.parse(s.t), y: valueFromSnapshot(s) }))
        .filter((q): q is { x: number; y: number } => q.y !== undefined);
      const proj = fitProjection(pts, fitModel, cap, extrapEnd);
      if (!proj) continue;
      const key = `${p.rsn}__pred`;
      for (const sample of proj.samples) {
        const row = rowByT.get(sample.x) ?? { t: sample.x, ts: new Date(sample.x).toLocaleString() };
        row[key] = sample.y;
        rowByT.set(sample.x, row);
      }
      projections.push({ rsn: p.rsn });
      fits.push({ rsn: p.rsn, proj });
    }

    // Inject a synthetic row at every pairwise projection crossing so the
    // tooltip can fire on the exact "overtake" date. At each crossing x, we
    // record EVERY active projection's value so the tooltip lists both lines.
    for (let i = 0; i < fits.length; i++) {
      for (let j = i + 1; j < fits.length; j++) {
        const a = fits[i], b = fits[j];
        const lo = Math.max(a.proj.startX, b.proj.startX);
        const hi = Math.min(a.proj.endX, b.proj.endX);
        if (hi <= lo) continue;
        const crossings = findCrossings(a.proj.predict, b.proj.predict, lo, hi);
        for (const x of crossings) {
          const row = rowByT.get(x) ?? { t: x, ts: new Date(x).toLocaleString() };
          for (const f of fits) {
            if (x >= f.proj.startX && x <= f.proj.endX) {
              row[`${f.rsn}__pred`] = f.proj.predict(x);
            }
          }
          rowByT.set(x, row);
        }
      }
    }

    const out = [...rowByT.values()].sort((a, b) => (a.t as number) - (b.t as number));
    return { data: out, projections };
  }, [index, players, range, idx, typeFilter, hideInactive, yMode, isOverall, cap, fitModel]);

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
            <div className="range-bar" title="Projection model">
              {FIT_MODELS.map((m) => (
                <button
                  key={m.key}
                  className={fitModel === m.key ? "active" : ""}
                  title={m.title}
                  onClick={() => setFitModel(m.key)}
                >{m.label}</button>
              ))}
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
                  type={fitModel === "snowball" ? "monotone" : "linear"}
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
