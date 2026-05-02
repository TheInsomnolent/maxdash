import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { Link } from "react-router-dom";
import { addDays, startOfDay } from "date-fns";
import { useUI } from "../App";
import { useData, filterPlayers, RANGE_OPTIONS } from "../store";
import { colorFor } from "../skills";
import {
  dailyGains,
  hourOfDayDistribution,
  dayOfWeekDistribution,
  fmtXp,
  type DailyGain,
} from "../activity";

const DAY_MS = 86_400_000;
const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function Activity() {
  const { players, index } = useData();
  const range = useUI((s) => s.range);
  const typeFilter = useUI((s) => s.typeFilter);
  const hideInactive = useUI((s) => s.hideInactive);

  const visible = useMemo(
    () => index ? filterPlayers(index.players, typeFilter, hideInactive) : [],
    [index, typeFilter, hideInactive],
  );

  // Range covers from N days ago up to today, snapped to local midnight so
  // daily buckets line up. Cap at 1y so the strip stays readable. We compute
  // the day list with addDays so it stays DST-safe (otherwise startDay +
  // n*DAY_MS drifts off local midnight when DST shifts inside the range).
  const { fromMs, toMs, days } = useMemo(() => {
    const opt = RANGE_OPTIONS.find((r) => r.key === range)!;
    const totalMs = Math.min(opt.ms ?? 365 * DAY_MS, 365 * DAY_MS);
    const totalDays = Math.round(totalMs / DAY_MS);
    const today = startOfDay(new Date());
    const toMs = today.getTime();
    const fromDate = startOfDay(addDays(today, -totalDays));
    const fromMs = fromDate.getTime();
    const days: number[] = [];
    for (let i = 0; i <= totalDays; i++) {
      days.push(startOfDay(addDays(fromDate, i)).getTime());
    }
    return { fromMs, toMs, days };
  }, [range]);
  const dayCount = days.length;

  // Per-player daily series, plus the global max so colors are comparable.
  const { perPlayer, globalMax } = useMemo(() => {
    let max = 0;
    const perPlayer = visible.map((p) => {
      const pf = players[p.rsn];
      const series = pf ? dailyGains(pf, fromMs, toMs) : [];
      for (const d of series) if (d.xp > max) max = d.xp;
      return { rsn: p.rsn, type: p.type, series };
    });
    return { perPlayer, globalMax: max };
  }, [visible, players, fromMs, toMs]);

  // Month boundary markers for the x-axis row. The first cell always gets a
  // tick; subsequent ticks land on the 1st of each month.
  const monthMarkers = useMemo(() => {
    const out: Array<{ idx: number; label: string }> = [];
    for (let i = 0; i < days.length; i++) {
      const d = new Date(days[i]);
      if (i === 0 || d.getDate() === 1) {
        out.push({ idx: i, label: d.toLocaleDateString(undefined, { month: "short" }) });
      }
    }
    return out;
  }, [days]);

  const hours = useMemo(
    () => hourOfDayDistribution(visible.map((p) => players[p.rsn]).filter(Boolean), fromMs, toMs),
    [visible, players, fromMs, toMs],
  );
  const dows = useMemo(
    () => dayOfWeekDistribution(visible.map((p) => players[p.rsn]).filter(Boolean), fromMs, toMs),
    [visible, players, fromMs, toMs],
  );
  const hourMax = Math.max(1, ...hours.map((h) => h.xp));
  const dowMax = Math.max(1, ...dows.map((d) => d.xp));

  return (
    <>
      <div className="panel">
        <h2>Activity heatmap ({range})</h2>
        <p style={{ marginTop: 0, color: "var(--text-dim)", fontSize: "0.9rem" }}>
          Each cell is one day of overall XP gain. Brighter = more XP. Hover for details.
        </p>
        <div className="heatmap-strip-table">
          <div
            className="heatmap-strip-row heatmap-strip-axis"
            style={{ "--days": dayCount } as CSSProperties}
          >
            <div className="heatmap-strip-label" />
            <div className="heatmap-strip-cells axis">
              {monthMarkers.map((m) => (
                <div
                  key={m.idx}
                  className="heatmap-month-tick"
                  style={{ gridColumn: `${m.idx + 1} / span 1` }}
                >
                  {m.label}
                </div>
              ))}
            </div>
          </div>
          {perPlayer.map((p) => (
            <PlayerStrip
              key={p.rsn}
              rsn={p.rsn}
              series={p.series}
              dayCount={dayCount}
              globalMax={globalMax}
              color={colorFor(p.rsn)}
            />
          ))}
        </div>
        <div className="heatmap-legend">
          <span>Less</span>
          {[0, 0.15, 0.35, 0.6, 0.85].map((t, i) => (
            <span
              key={i}
              className="heatmap-legend-cell"
              style={{ background: cellBg(t * globalMax, globalMax, "#ffb43b") }}
              title={t === 0 ? "0" : `${fmtXp(t * globalMax)} xp`}
            />
          ))}
          <span>More — peak {fmtXp(globalMax)} xp/day</span>
        </div>
      </div>

      <div className="panel">
        <h2>When does the group play?</h2>
        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "1.25rem" }}>
          <div>
            <h3 style={{ margin: "0 0 0.4rem", fontSize: "1rem", color: "var(--text-dim)" }}>
              By hour of day (local)
            </h3>
            <div className="bar-chart-h">
              {hours.map((h) => (
                <div
                  key={h.hour}
                  className="bar-col"
                  title={`${h.hour}:00 — ${fmtXp(h.xp)} xp / ${h.intervals} sessions`}
                >
                  <div className="bar-fill" style={{ height: `${(h.xp / hourMax) * 100}%` }} />
                  <div className="bar-label">{h.hour % 3 === 0 ? `${h.hour}` : ""}</div>
                </div>
              ))}
            </div>
          </div>
          <div>
            <h3 style={{ margin: "0 0 0.4rem", fontSize: "1rem", color: "var(--text-dim)" }}>
              By day of week
            </h3>
            <div className="bar-chart-h">
              {dows.map((d) => (
                <div key={d.dow} className="bar-col wide" title={`${DOW_LABELS[d.dow]} — ${fmtXp(d.xp)} xp`}>
                  <div className="bar-fill" style={{ height: `${(d.xp / dowMax) * 100}%` }} />
                  <div className="bar-label">{DOW_LABELS[d.dow]}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function PlayerStrip({
  rsn, series, dayCount, globalMax, color,
}: {
  rsn: string;
  series: DailyGain[];
  dayCount: number;
  globalMax: number;
  color: string;
}) {
  const [hover, setHover] = useState<{ d: DailyGain; idx: number } | null>(null);
  const totalXp = useMemo(() => series.reduce((a, d) => a + d.xp, 0), [series]);
  const activeDays = useMemo(() => series.filter((d) => d.xp > 0).length, [series]);
  const now = Date.now();

  return (
    <div
      className="heatmap-strip-row"
      style={{ "--days": dayCount } as CSSProperties}
    >
      <div className="heatmap-strip-label">
        <Link to={`/players/${encodeURIComponent(rsn)}`} className="heatmap-strip-name" title={rsn}>
          <span className="swatch" style={{ background: color, color }} />
          {rsn}
        </Link>
        <div className="heatmap-strip-totals">
          {fmtXp(totalXp)} xp · {activeDays}d active
        </div>
      </div>
      <div className="heatmap-strip-cells">
        {series.map((d, i) => {
          const future = d.dayMs > now;
          return (
            <div
              key={d.dayMs}
              className={"heatmap-cell" + (future ? " future" : "")}
              style={{
                gridColumn: `${i + 1} / span 1`,
                background: future ? "transparent" : cellBg(d.xp, globalMax, color),
              }}
              onMouseEnter={() => setHover({ d, idx: i })}
              onMouseLeave={() => setHover(null)}
              title={future ? "" : `${new Date(d.dayMs).toLocaleDateString()} — ${fmtXp(d.xp)} xp`}
            />
          );
        })}
        {hover && (
          <div
            className="heatmap-tooltip"
            style={{ left: `${(hover.idx / Math.max(1, dayCount - 1)) * 100}%` }}
          >
            {new Date(hover.d.dayMs).toLocaleDateString()}:{" "}
            <strong>{hover.d.xp.toLocaleString()}</strong> xp
          </div>
        )}
      </div>
    </div>
  );
}

function cellBg(xp: number, max: number, color: string): string {
  if (xp <= 0 || max <= 0) return "#1a0f06";
  // sqrt scaling so small days remain visible despite outlier grind days.
  const t = Math.min(1, Math.sqrt(xp / max));
  const alpha = 0.18 + t * 0.82;
  return blendWithBg(color, alpha);
}

function blendWithBg(hex: string, alpha: number): string {
  const c = hex.replace("#", "");
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  // Panel base is roughly (26, 15, 6).
  const br = 26, bg = 15, bb = 6;
  const mix = (cv: number, bv: number) => Math.round(bv + (cv - bv) * alpha);
  return `rgb(${mix(r, br)}, ${mix(g, bg)}, ${mix(b, bb)})`;
}
