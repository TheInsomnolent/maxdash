import { useMemo, useState } from "react";
import {
  Bar, CartesianGrid, ComposedChart, Legend, Line,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { useUI } from "../App";
import { useData, filterPlayers } from "../store";
import { colorFor, skillColor } from "../skills";
import { fmtXp } from "../activity";
import {
  barKey, weekOptions, weeklyRace, weekRangeLabel,
  type WeeklyMode, type WeekKey,
} from "../weekly";
import { AccountBadge, type AccountType } from "./AccountBadge";
import { SkillIcon } from "./SkillIcon";

/**
 * Weekly race combo chart: a cumulative line per MVP over the Mon → Sun (AEST)
 * week, plus one stacked column per player per day breaking the day's gain down
 * by skill. Only the three best players of the week are shown, and XP past the
 * level-99 cap never counts (see `weekly.ts`).
 */
export function WeeklyRace({ mode }: { mode: WeeklyMode }) {
  const { players, index } = useData();
  const typeFilter = useUI((s) => s.typeFilter);
  const hideInactive = useUI((s) => s.hideInactive);
  const [weekKey, setWeekKey] = useState<WeekKey>("this");

  const weeks = useMemo(() => weekOptions(), []);
  const week = weeks.find((w) => w.key === weekKey) ?? weeks[0];

  const typeByRsn = useMemo(() => {
    const m = new Map<string, AccountType>();
    for (const p of index?.players ?? []) m.set(p.rsn, p.type);
    return m;
  }, [index]);

  const race = useMemo(() => {
    if (!index) return null;
    const pfs = filterPlayers(index.players, typeFilter, hideInactive)
      .map((p) => players[p.rsn])
      .filter(Boolean);
    return weeklyRace(pfs, week, mode);
  }, [index, players, typeFilter, hideInactive, week, mode]);

  const fmt = (v: number) =>
    mode === "level" ? `${Math.round(v)} lvl${Math.round(v) === 1 ? "" : "s"}` : `${Math.round(v).toLocaleString()} xp`;

  return (
    <div className="panel">
      <div className="weekly-head">
        <h2 style={{ margin: 0 }}>
          Weekly race — {mode === "level" ? "levels" : "XP"} gained
        </h2>
        <span className="weekly-range">{weekRangeLabel(week)}</span>
        <select
          value={weekKey}
          onChange={(e) => setWeekKey(e.target.value as WeekKey)}
          aria-label="Week"
        >
          {weeks.map((w) => (
            <option key={w.key} value={w.key}>{w.label}</option>
          ))}
        </select>
      </div>
      {!race || race.leaders.length === 0 ? (
        <div className="empty">
          No {mode === "level" ? "levels" : "XP"} gained in this week yet.
        </div>
      ) : (
        <>
          <div style={{ height: 420 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={race.rows} margin={{ top: 10, right: 16, bottom: 0, left: 8 }}>
                <CartesianGrid stroke="#3a2614" strokeDasharray="3 3" />
                <XAxis dataKey="label" stroke="#b8a684" />
                <YAxis
                  stroke="#b8a684"
                  domain={[0, race.max]}
                  allowDecimals={false}
                  tickFormatter={(v: number) => (mode === "level" ? String(Math.round(v)) : fmtXp(v))}
                />
                <Tooltip
                  cursor={{ fill: "rgba(255, 180, 59, 0.08)" }}
                  content={(props: {
                    active?: boolean;
                    label?: string | number;
                    payload?: Array<{ dataKey?: string | number; value?: number }>;
                  }) => (
                    <WeeklyTooltip
                      active={props.active}
                      label={props.label}
                      payload={props.payload}
                      leaders={race.leaders.map((l) => l.rsn)}
                      fmt={fmt}
                    />
                  )}
                />
                <Legend
                  wrapperStyle={{ color: "#f0e2c0" }}
                  payload={race.leaders.map((l) => ({
                    value: l.rsn,
                    type: "line" as const,
                    id: l.rsn,
                    color: colorFor(l.rsn),
                  }))}
                />
                {race.leaders.map((l) =>
                  race.skills.map((s) => (
                    <Bar
                      key={barKey(l.rsn, s)}
                      dataKey={barKey(l.rsn, s)}
                      stackId={l.rsn}
                      fill={skillColor(s)}
                      stroke={colorFor(l.rsn)}
                      strokeWidth={1}
                      isAnimationActive={false}
                    />
                  )),
                )}
                {race.leaders.map((l) => (
                  <Line
                    key={l.rsn}
                    type="monotone"
                    dataKey={l.rsn}
                    name={l.rsn}
                    stroke={colorFor(l.rsn)}
                    strokeWidth={2.5}
                    dot={{ r: 3 }}
                    connectNulls={false}
                    isAnimationActive={false}
                  />
                ))}
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          <div className="weekly-legend">
            {race.skills.map((s) => (
              <span key={s} className="weekly-legend-item">
                <span className="swatch" style={{ background: skillColor(s), color: skillColor(s) }} />
                <SkillIcon name={s} size={14} /> {s}
              </span>
            ))}
          </div>

          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Player</th>
                <th className="num">{mode === "level" ? "Levels" : "XP"} this week</th>
                <th className="num">Best day</th>
              </tr>
            </thead>
            <tbody>
              {race.leaders.map((l, i) => {
                const best = Math.max(...l.dayTotals);
                return (
                  <tr key={l.rsn}>
                    <td className="num">{i + 1}</td>
                    <td>
                      <span className="swatch" style={{ background: colorFor(l.rsn), color: colorFor(l.rsn) }} />
                      <AccountBadge type={typeByRsn.get(l.rsn) ?? "main"} /> {l.rsn}
                    </td>
                    <td className="num">{fmt(l.total)}</td>
                    <td className="num">{fmt(best)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

/**
 * Tooltip grouped by player: cumulative total for the day followed by that
 * day's per-skill breakdown.
 */
function WeeklyTooltip({
  active, label, payload, leaders, fmt,
}: {
  active?: boolean;
  label?: string | number;
  payload?: Array<{ dataKey?: string | number; value?: number }>;
  leaders: string[];
  fmt: (v: number) => string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const byKey = new Map<string, number>();
  for (const p of payload) {
    if (typeof p.dataKey !== "string" || typeof p.value !== "number") continue;
    byKey.set(p.dataKey, p.value);
  }
  const blocks = leaders
    .map((rsn) => {
      const skills = [...byKey.entries()]
        .filter(([k]) => k.startsWith(`${rsn}\u0000`))
        .map(([k, v]) => ({ skill: k.slice(rsn.length + 1), value: v }))
        .filter((s) => s.value > 0)
        .sort((a, b) => b.value - a.value);
      const cumulative = byKey.get(rsn);
      return { rsn, skills, cumulative };
    })
    .filter((b) => b.skills.length > 0 || typeof b.cumulative === "number");
  if (blocks.length === 0) return null;
  return (
    <div style={{ background: "#2b1f12", border: "2px solid #8a6b3d", color: "#f0e2c0", padding: "6px 10px" }}>
      <div style={{ color: "#ffb43b", marginBottom: 4 }}>{label}</div>
      {blocks.map((b) => (
        <div key={b.rsn} style={{ marginBottom: 4 }}>
          <div style={{ color: colorFor(b.rsn), fontWeight: 700 }}>
            {b.rsn}
            {typeof b.cumulative === "number" ? ` — ${fmt(b.cumulative)} total` : ""}
          </div>
          {b.skills.map((s) => (
            <div key={s.skill} style={{ paddingLeft: 8 }}>
              <span className="swatch" style={{ background: skillColor(s.skill), color: skillColor(s.skill) }} />
              {s.skill}: {fmt(s.value)}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
