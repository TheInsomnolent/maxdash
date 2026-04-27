import { useNavigate, useParams, Link } from "react-router-dom";
import { useUI } from "../App";
import { useData, etaToMaxDays, latestSnapshot, snapshotsInRange, xpGainInRange } from "../store";
import { MAX_XP, SKILLS, TRAINABLE_SKILLS, colorFor, xpToLevel } from "../skills";

export function PlayerDetail() {
  const { rsn } = useParams();
  const nav = useNavigate();
  const { players, index } = useData();
  const range = useUI((s) => s.range);

  if (!index) return null;
  const current = rsn && players[rsn] ? rsn : index.players[0]?.rsn;
  if (!current) return <div className="empty">No players.</div>;

  const pf = players[current];
  const last = latestSnapshot(pf);
  const snap = last?.s ?? [];

  const totalXp = snap[0] ?? 0;
  const totalLevel = snap.slice(1).reduce((a, x) => a + (x >= 0 ? xpToLevel(x) : 1), 0);
  const skills99 = snap.slice(1).filter((x) => x >= MAX_XP).length;
  const xpGainOverall = xpGainInRange(pf, 0, range);

  const inRange = snapshotsInRange(pf, range);
  const days = inRange.length >= 2
    ? Math.max(1, (Date.parse(inRange.at(-1)!.t) - Date.parse(inRange[0].t)) / 86400_000)
    : 1;
  const xpPerDay = xpGainOverall / days;

  // Next skill to 99: smallest positive ETA.
  let nextSkill: { name: string; eta: number } | null = null;
  for (let i = 1; i < snap.length; i++) {
    if (snap[i] >= MAX_XP) continue;
    const eta = etaToMaxDays(pf, i);
    if (eta == null || eta <= 0) continue;
    if (!nextSkill || eta < nextSkill.eta) nextSkill = { name: SKILLS[i], eta };
  }

  return (
    <>
      <div className="panel">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem" }}>
          <h2 style={{ margin: 0 }}>
            <span style={{ color: colorFor(current) }}>●</span> {current}
          </h2>
          <select value={current} onChange={(e) => nav(`/players/${encodeURIComponent(e.target.value)}`)}>
            {index.players.map((p) => (
              <option key={p.rsn} value={p.rsn}>{p.rsn}</option>
            ))}
          </select>
        </div>
        <div className="kpis" style={{ marginTop: "0.75rem" }}>
          <Kpi label="Total XP" value={totalXp.toLocaleString()} />
          <Kpi label="Total Level" value={`${totalLevel} / 2277`} />
          <Kpi label="99s" value={`${skills99} / ${TRAINABLE_SKILLS.length}`} />
          <Kpi label={`XP / day (${range})`} value={Math.round(xpPerDay).toLocaleString()} />
          <Kpi label="Next 99" value={nextSkill ? `${nextSkill.name} • ${nextSkill.eta.toFixed(0)}d` : "—"} />
        </div>
      </div>

      <div className="panel">
        <h2>Skills</h2>
        <div className="grid-skills">
          {TRAINABLE_SKILLS.map((s, i) => {
            const idx = i + 1;
            const xp = snap[idx] ?? -1;
            const lvl = xp >= 0 ? xpToLevel(xp) : 1;
            const pct = xp >= 0 ? Math.min(100, (xp / MAX_XP) * 100) : 0;
            const maxed = xp >= MAX_XP;
            const eta = etaToMaxDays(pf, idx);
            return (
              <Link
                key={s}
                to={`/skills/${encodeURIComponent(s)}`}
                style={{ color: "inherit", textDecoration: "none" }}
              >
                <div className={"skill-card" + (maxed ? " maxed" : "")}>
                  <div className="name">{s}</div>
                  <div className="lvl">{lvl}</div>
                  <div className="bar"><span style={{ width: `${pct}%` }} /></div>
                  <div className="meta">
                    {xp < 0 ? "unranked" : `${xp.toLocaleString()} xp`}
                    {!maxed && eta != null && <> • {eta.toFixed(0)}d</>}
                    {maxed && <> • ✓ maxed</>}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="kpi">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
    </div>
  );
}
