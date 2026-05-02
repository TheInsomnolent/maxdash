import { useMemo } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart,
  ResponsiveContainer, Tooltip, Legend,
} from "recharts";
import { useUI } from "../App";
import {
  useData, filterPlayers, latestSnapshot, snapshotsInRange,
  xpGainInRange, totalLevelFromSnapshot, skills99Count, activeHoursInRange,
} from "../store";
import {
  MAX_XP, SKILLS, TRAINABLE_SKILLS, MAX_TOTAL_LEVEL,
  TRAINABLE_SKILL_COUNT, colorFor, xpToLevel,
} from "../skills";
import { AccountBadge } from "../components/AccountBadge";
import { SkillIcon } from "../components/SkillIcon";
import { fmtXp } from "../activity";

const MAX_COMPARE = 4;
const PARAM_KEY = "p";

type RadarMode = "level" | "rangeXp" | "rangeXpPct";

interface RadarRow {
  skill: string;
  skillIdx: number;
  /** One value per RSN; key = rsn. */
  [rsn: string]: string | number;
}

export function Compare() {
  const { players, index } = useData();
  const range = useUI((s) => s.range);
  const typeFilter = useUI((s) => s.typeFilter);
  const hideInactive = useUI((s) => s.hideInactive);
  const [search, setSearch] = useSearchParams();
  const nav = useNavigate();

  const rosterAll = index?.players ?? [];
  const visible = useMemo(
    () => index ? filterPlayers(index.players, typeFilter, hideInactive) : [],
    [index, typeFilter, hideInactive],
  );

  // Selected RSNs come from the URL (?p=foo&p=bar) so the comparison is
  // shareable. Default: top 2 visible players by total XP.
  const selected = useMemo(() => {
    const ps = search.getAll(PARAM_KEY).filter((rsn) =>
      rosterAll.some((p) => p.rsn === rsn),
    );
    if (ps.length > 0) return ps.slice(0, MAX_COMPARE);
    const byTotal = [...visible]
      .sort((a, b) => b.totalXp - a.totalXp)
      .slice(0, 2)
      .map((p) => p.rsn);
    return byTotal;
  }, [search, rosterAll, visible]);

  const [mode, setMode] = useModeParam(search, setSearch);

  const setSelected = (next: string[]) => {
    const sp = new URLSearchParams(search);
    sp.delete(PARAM_KEY);
    for (const r of next.slice(0, MAX_COMPARE)) sp.append(PARAM_KEY, r);
    nav({ search: sp.toString() }, { replace: true });
  };

  const togglePlayer = (rsn: string) => {
    const has = selected.includes(rsn);
    if (has) setSelected(selected.filter((r) => r !== rsn));
    else if (selected.length < MAX_COMPARE) setSelected([...selected, rsn]);
  };

  const radarData = useMemo<RadarRow[]>(() => {
    if (selected.length === 0) return [];
    // Per-player precompute so we don't recompute inside the per-skill loop.
    const perPlayer = selected.map((rsn) => {
      const pf = players[rsn];
      if (!pf) return { rsn, snap: [] as number[], rangeGains: [] as number[], rangeTotal: 0 };
      const last = latestSnapshot(pf);
      const snap = last?.s ?? [];
      const rangeGains: number[] = new Array(snap.length).fill(0);
      let rangeTotal = 0;
      for (let i = 1; i < snap.length; i++) {
        const g = xpGainInRange(pf, i, range);
        rangeGains[i] = g;
        rangeTotal += g;
      }
      return { rsn, snap, rangeGains, rangeTotal };
    });

    return TRAINABLE_SKILLS.map((s, i) => {
      const skillIdx = i + 1;
      const row: RadarRow = { skill: s, skillIdx };
      for (const pp of perPlayer) {
        if (mode === "level") {
          const xp = pp.snap[skillIdx];
          row[pp.rsn] = xp >= 0 ? xpToLevel(xp) : 1;
        } else if (mode === "rangeXp") {
          row[pp.rsn] = pp.rangeGains[skillIdx] ?? 0;
        } else {
          // rangeXpPct: each player's XP composition (% of their range total).
          row[pp.rsn] = pp.rangeTotal > 0
            ? (pp.rangeGains[skillIdx] / pp.rangeTotal) * 100
            : 0;
        }
      }
      return row;
    });
  }, [selected, players, range, mode]);

  // Per-player KPIs.
  const kpis = useMemo(() => {
    return selected.map((rsn) => {
      const pf = players[rsn];
      if (!pf) return null;
      const last = latestSnapshot(pf);
      const snap = last?.s ?? [];
      const totalXp = snap[0] ?? 0;
      const totalLevel = snap.length ? totalLevelFromSnapshot(snap) : 0;
      const s99 = snap.length ? skills99Count(snap) : 0;
      const xpGain = xpGainInRange(pf, 0, range);
      const hrs = activeHoursInRange(pf, range);
      const inR = snapshotsInRange(pf, range);
      const days = inR.length >= 2
        ? Math.max(1, (Date.parse(inR.at(-1)!.t) - Date.parse(inR[0].t)) / 86400_000)
        : 1;
      return {
        rsn,
        totalXp, totalLevel, s99,
        xpGain, hrs,
        xpPerDay: xpGain / days,
        xpPerHour: hrs > 0 ? xpGain / hrs : 0,
      };
    }).filter((x): x is NonNullable<typeof x> => x !== null);
  }, [selected, players, range]);

  if (!index) return null;

  return (
    <>
      <div className="panel">
        <h2>Compare players</h2>
        <p style={{ marginTop: 0, color: "var(--text-dim)", fontSize: "0.9rem" }}>
          Pick up to {MAX_COMPARE} players for a side-by-side breakdown. The
          selection is encoded in the URL so it can be shared.
        </p>
        <div className="compare-picker">
          {rosterAll.map((p) => {
            const sel = selected.includes(p.rsn);
            const disabled = !sel && selected.length >= MAX_COMPARE;
            return (
              <button
                key={p.rsn}
                className={"compare-chip" + (sel ? " selected" : "") + (disabled ? " disabled" : "")}
                disabled={disabled}
                onClick={() => togglePlayer(p.rsn)}
                style={sel ? { borderColor: colorFor(p.rsn), boxShadow: `0 0 6px ${colorFor(p.rsn)}` } : undefined}
              >
                <span className="swatch" style={{ background: colorFor(p.rsn), color: colorFor(p.rsn) }} />
                <AccountBadge type={p.type} size={14} /> {p.rsn}
              </button>
            );
          })}
        </div>
        <div className="range-bar" style={{ marginTop: "0.6rem" }}>
          <button className={mode === "level" ? "active" : ""} onClick={() => setMode("level")}>
            Levels
          </button>
          <button className={mode === "rangeXp" ? "active" : ""} onClick={() => setMode("rangeXp")}>
            XP gained ({range})
          </button>
          <button className={mode === "rangeXpPct" ? "active" : ""} onClick={() => setMode("rangeXpPct")}>
            XP composition % ({range})
          </button>
        </div>
      </div>

      {selected.length === 0 ? (
        <div className="panel"><div className="empty">Pick at least one player.</div></div>
      ) : (
        <>
          <div className="panel">
            <h2>Stat lines</h2>
            <div className="compare-stats" style={{ gridTemplateColumns: `160px repeat(${selected.length}, 1fr)` }}>
              <div className="compare-stat-label">Player</div>
              {kpis.map((k) => (
                <div key={k.rsn} className="compare-stat-head">
                  <span className="swatch" style={{ background: colorFor(k.rsn), color: colorFor(k.rsn) }} />
                  <Link to={`/players/${encodeURIComponent(k.rsn)}`} style={{ color: colorFor(k.rsn) }}>
                    {k.rsn}
                  </Link>
                </div>
              ))}

              <CompareRow label="Total XP" values={kpis.map((k) => k.totalXp)} format={(v) => v.toLocaleString()} />
              <CompareRow label="Total level" values={kpis.map((k) => k.totalLevel)} format={(v) => `${v} / ${MAX_TOTAL_LEVEL}`} />
              <CompareRow label="99s" values={kpis.map((k) => k.s99)} format={(v) => `${v} / ${TRAINABLE_SKILL_COUNT}`} />
              <CompareRow label={`XP gained (${range})`} values={kpis.map((k) => k.xpGain)} format={fmtXp} />
              <CompareRow label={`Hours played (${range})`} values={kpis.map((k) => k.hrs)} format={(v) => `${v.toFixed(1)}h`} />
              <CompareRow label={`XP / day (${range})`} values={kpis.map((k) => k.xpPerDay)} format={(v) => Math.round(v).toLocaleString()} />
              <CompareRow label={`XP / hour (${range})`} values={kpis.map((k) => k.xpPerHour)} format={(v) => Math.round(v).toLocaleString()} />
            </div>
          </div>

          <div className="panel" style={{ height: 480 }}>
            <h2 style={{ marginBottom: "0.25rem" }}>
              Skill fingerprint — {RADAR_LABEL[mode]}
            </h2>
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart data={radarData} outerRadius="78%" margin={{ top: 20, right: 30, bottom: 20, left: 30 }}>
                <PolarGrid stroke="#5a3d1f" />
                <PolarAngleAxis
                  dataKey="skill"
                  stroke="#b8a684"
                  tick={{ fill: "#b8a684", fontSize: 11 }}
                />
                <PolarRadiusAxis
                  stroke="#5a3d1f"
                  tick={{ fill: "#8a6b3d", fontSize: 10 }}
                  tickFormatter={(v) => mode === "level" ? String(v) : mode === "rangeXpPct" ? `${v.toFixed(0)}%` : fmtXp(v)}
                  angle={90}
                />
                <Tooltip
                  contentStyle={{ background: "#2b1f12", border: "2px solid #8a6b3d", color: "#f0e2c0" }}
                  labelStyle={{ color: "#ffb43b" }}
                  formatter={(v: number, key: string) => {
                    const display = mode === "level"
                      ? `level ${Math.round(v)}`
                      : mode === "rangeXpPct"
                        ? `${v.toFixed(1)}%`
                        : `${Math.round(v).toLocaleString()} xp`;
                    return [display, key];
                  }}
                />
                <Legend wrapperStyle={{ color: "#f0e2c0" }} />
                {selected.map((rsn) => (
                  <Radar
                    key={rsn}
                    name={rsn}
                    dataKey={rsn}
                    stroke={colorFor(rsn)}
                    fill={colorFor(rsn)}
                    fillOpacity={0.18}
                    strokeWidth={2}
                  />
                ))}
              </RadarChart>
            </ResponsiveContainer>
          </div>

          <div className="panel">
            <h2>Skill-by-skill</h2>
            <SkillBreakdownTable selected={selected} mode={mode} radarData={radarData} />
          </div>
        </>
      )}
    </>
  );
}

const RADAR_LABEL: Record<RadarMode, string> = {
  level: "current level per skill",
  rangeXp: "XP gained in selected range",
  rangeXpPct: "XP composition (% of player's total) in selected range",
};

function useModeParam(
  search: URLSearchParams,
  setSearch: (s: URLSearchParams) => void,
): [RadarMode, (m: RadarMode) => void] {
  const cur = (search.get("mode") as RadarMode) || "level";
  const set = (m: RadarMode) => {
    const sp = new URLSearchParams(search);
    if (m === "level") sp.delete("mode");
    else sp.set("mode", m);
    setSearch(sp);
  };
  return [cur === "level" || cur === "rangeXp" || cur === "rangeXpPct" ? cur : "level", set];
}

function CompareRow({
  label, values, format,
}: {
  label: string;
  values: number[];
  format: (v: number) => string;
}) {
  // Highlight the max with the accent color so the "winner" pops out.
  const max = values.length > 0 ? Math.max(...values) : 0;
  return (
    <>
      <div className="compare-stat-label">{label}</div>
      {values.map((v, i) => {
        const isMax = v > 0 && v === max;
        return (
          <div key={i} className={"compare-stat-cell" + (isMax ? " win" : "")}>
            {format(v)}
          </div>
        );
      })}
    </>
  );
}

function SkillBreakdownTable({
  selected, mode, radarData,
}: {
  selected: string[];
  mode: RadarMode;
  radarData: RadarRow[];
}) {
  const fmt = (v: number) =>
    mode === "level" ? String(Math.round(v))
    : mode === "rangeXpPct" ? `${v.toFixed(1)}%`
    : fmtXp(v);
  return (
    <table>
      <thead>
        <tr>
          <th>Skill</th>
          {selected.map((rsn) => (
            <th key={rsn} className="num" style={{ color: colorFor(rsn) }}>{rsn}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {radarData.map((row) => {
          const vals = selected.map((rsn) => Number(row[rsn]) || 0);
          const max = Math.max(...vals);
          return (
            <tr key={String(row.skill)}>
              <td>
                <span style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem" }}>
                  <SkillIcon name={String(row.skill)} size={16} /> {row.skill}
                </span>
              </td>
              {vals.map((v, i) => {
                const isMax = v > 0 && v === max;
                return (
                  <td key={i} className="num" style={isMax ? { color: "var(--accent-2)", fontWeight: 700 } : undefined}>
                    {fmt(v)}
                  </td>
                );
              })}
            </tr>
          );
        })}
        {/* Total / current XP row (raw, ignoring mode toggles) for context. */}
        <tr>
          <td>
            <strong style={{ color: "var(--text-dim)" }}>
              {mode === "rangeXpPct" ? "Total XP gained" : mode === "rangeXp" ? "Total XP gained" : "Sum of levels"}
            </strong>
          </td>
          {selected.map((rsn) => {
            const total = radarData.reduce((sum, row) => {
              const v = Number(row[rsn]) || 0;
              return sum + v;
            }, 0);
            const display = mode === "level"
              ? `${Math.round(total)} / ${MAX_XP > 0 ? TRAINABLE_SKILLS.length * 99 : 0}`
              : mode === "rangeXpPct" ? `${total.toFixed(0)}%`
              : fmtXp(total);
            return (
              <td key={rsn} className="num" style={{ color: colorFor(rsn) }}>
                <strong>{display}</strong>
              </td>
            );
          })}
        </tr>
      </tbody>
    </table>
  );
}
