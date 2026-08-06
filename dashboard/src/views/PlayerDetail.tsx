import { useMemo, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { useUI } from "../App";
import {
  useData,
  etaToMaxDays,
  latestSnapshot,
  snapshotsInRange,
  xpGainInRange,
  filterPlayers,
} from "../store";
import { MAX_XP, SKILLS, TRAINABLE_SKILLS, colorFor, xpToLevel } from "../skills";
import { SkillIcon } from "../components/SkillIcon";
import { AccountBadge, BADGE_LABEL, type AccountType } from "../components/AccountBadge";
import { Sparkline } from "../components/Sparkline";
import { formatHours, hoursToMax } from "../xprates";

export function PlayerDetail() {
  const { rsn } = useParams();
  const nav = useNavigate();
  const { players, index } = useData();
  const range = useUI((s) => s.range);
  const typeFilter = useUI((s) => s.typeFilter);
  const hideInactive = useUI((s) => s.hideInactive);

  if (!index) return null;
  // Apply the global type/active filters to the dropdown, but always keep the
  // currently-selected player visible so deep links never appear empty.
  const filtered = filterPlayers(index.players, typeFilter, hideInactive);
  const dropdown = rsn && !filtered.some((p) => p.rsn === rsn) && index.players.find((p) => p.rsn === rsn)
    ? [...filtered, index.players.find((p) => p.rsn === rsn)!]
    : filtered;
  const current = rsn && players[rsn] ? rsn : (filtered[0]?.rsn ?? index.players[0]?.rsn);
  if (!current) return <div className="empty">No players.</div>;

  const pf = players[current];
  const meta = index.players.find((p) => p.rsn === current)!;
  const last = latestSnapshot(pf);
  const snap = last?.s ?? [];

  const totalXp = snap[0] ?? 0;
  const totalLevel = snap.slice(1).reduce((a, x) => a + (x >= 0 ? xpToLevel(x) : 1), 0);
  const skills99 = snap.slice(1).filter((x) => x >= MAX_XP).length;
  const xpGainOverall = xpGainInRange(pf, 0, range);

  // Effective play-time left to max, using reference xp/hr rates per skill.
  const afkHours = hoursToMax(snap, "afk");
  const sweatyHours = hoursToMax(snap, "active");

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
      <div className="player-header-row">
        <img
          src={`${import.meta.env.BASE_URL}images/${encodeURIComponent(current)}.png`}
          onError={(e) => {
            const t = e.currentTarget;
            const fallback = `${import.meta.env.BASE_URL}images/Default.png`;
            if (t.src !== fallback) t.src = fallback;
          }}
          alt={current}
          className="player-hero"
        />
        <div className="panel">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem" }}>
            <h2 style={{ margin: 0, display: "inline-flex", alignItems: "center", gap: "0.6rem" }}>
              <span className="swatch" style={{ background: colorFor(current), color: colorFor(current) }} />
              <AccountBadge type={meta.type} size={22} />
              {current}
              <small style={{ fontSize: "0.6em", opacity: 0.75, fontWeight: "normal" }}>
                {BADGE_LABEL[meta.type]}
              </small>
            </h2>
            <select value={current} onChange={(e) => nav(`/players/${encodeURIComponent(e.target.value)}`)}>
              {dropdown.map((p) => (
                <option key={p.rsn} value={p.rsn}>{p.rsn}</option>
              ))}
            </select>
          </div>
          <div className="kpis" style={{ marginTop: "0.75rem" }}>
            <Kpi label="Total XP" value={totalXp.toLocaleString()} />
            <Kpi label="Total Level" value={`${totalLevel} / 2277`} />
            <Kpi label="99s" value={`${skills99} / ${TRAINABLE_SKILLS.length}`} />
            <Kpi label={`XP / day (${range})`} value={Math.round(xpPerDay).toLocaleString()} />
            <Kpi label="AFK hours to max" value={formatHours(afkHours)} />
            <Kpi label="Sweaty hours to max" value={formatHours(sweatyHours)} />
            <Kpi
              label="Next 99"
              value={nextSkill ? `${nextSkill.name} • ${nextSkill.eta.toFixed(0)}d` : "—"}
              icon={nextSkill?.name}
            />
          </div>
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
            const series = inRange.map((sn) => sn.s[idx]).filter((v) => v >= 0);
            return (
              <Link
                key={s}
                to={`/skills/${encodeURIComponent(s)}`}
                style={{ color: "inherit", textDecoration: "none" }}
              >
                <div className={"skill-card" + (maxed ? " maxed" : "")}>
                  <div className="name"><SkillIcon name={s} size={16} /> {s}</div>
                  <div className="lvl">{lvl}</div>
                  <Sparkline values={series} color={colorFor(current)} />
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

      <HeadToHead currentRsn={current} />
    </>
  );
}

function HeadToHead({ currentRsn }: { currentRsn: string }) {
  const { players, index } = useData();
  const range = useUI((s) => s.range);
  const playerOptions = index?.players ?? [];
  const playerType = (rsn: string): AccountType =>
    playerOptions.find((p) => p.rsn === rsn)?.type ?? "main";
  // Default opponent: first roster player that isn't us.
  const defaultOpp =
    playerOptions.find((p) => p.rsn !== currentRsn)?.rsn ?? currentRsn;
  const [opp, setOpp] = useState(defaultOpp);
  // If the viewed player changes, reset opponent.
  const oppOrFallback = useMemo(() => {
    if (opp === currentRsn) {
      return (
        playerOptions.find((p) => p.rsn !== currentRsn)?.rsn ?? currentRsn
      );
    }
    return opp;
  }, [opp, currentRsn, playerOptions]);

  const rivalry = useMemo(() => {
    if (!index || !players[currentRsn] || !players[oppOrFallback]) return [];
    return TRAINABLE_SKILLS.map((s, i) => {
      const idx = i + 1;
      const ga = xpGainInRange(players[currentRsn], idx, range);
      const gb = xpGainInRange(players[oppOrFallback], idx, range);
      return {
        skill: s,
        a: ga,
        b: gb,
        winner: ga === gb ? null : ga > gb ? currentRsn : oppOrFallback,
      };
    });
  }, [index, players, currentRsn, oppOrFallback, range]);

  const totals = useMemo(() => {
    let aWins = 0, bWins = 0, ties = 0;
    for (const r of rivalry) {
      if (r.winner === currentRsn) aWins++;
      else if (r.winner === oppOrFallback) bWins++;
      else ties++;
    }
    return { aWins, bWins, ties };
  }, [rivalry, currentRsn, oppOrFallback]);

  return (
    <div className="panel">
      <h2>Head-to-head ({range})</h2>
      <div
        style={{
          display: "flex",
          gap: "0.5rem",
          marginBottom: "0.75rem",
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem" }}>
          <AccountBadge type={playerType(currentRsn)} />
          <strong style={{ color: colorFor(currentRsn) }}>{currentRsn}</strong>
        </span>
        <span>vs.</span>
        <select value={oppOrFallback} onChange={(e) => setOpp(e.target.value)}>
          {playerOptions
            .filter((p) => p.rsn !== currentRsn)
            .map((p) => (
              <option key={p.rsn} value={p.rsn}>{p.rsn}</option>
            ))}
        </select>
        <AccountBadge type={playerType(oppOrFallback)} />
        <span style={{ marginLeft: "auto", color: "var(--text-dim)" }}>
          Skills won: <strong style={{ color: colorFor(currentRsn) }}>{totals.aWins}</strong>
          {" – "}
          <strong style={{ color: colorFor(oppOrFallback) }}>{totals.bWins}</strong>
          {totals.ties ? ` (${totals.ties} tie)` : ""}
        </span>
      </div>
      <table>
        <thead>
          <tr>
            <th>Skill</th>
            <th className="num" style={{ color: colorFor(currentRsn) }}>
              <AccountBadge type={playerType(currentRsn)} /> {currentRsn}
            </th>
            <th className="num" style={{ color: colorFor(oppOrFallback) }}>
              <AccountBadge type={playerType(oppOrFallback)} /> {oppOrFallback}
            </th>
            <th>Winner</th>
          </tr>
        </thead>
        <tbody>
          {rivalry.map((r) => (
            <tr key={r.skill}>
              <td><SkillIcon name={r.skill} size={16} /> {r.skill}</td>
              <td className="num">{r.a.toLocaleString()}</td>
              <td className="num">{r.b.toLocaleString()}</td>
              <td style={{ color: r.winner ? colorFor(r.winner) : undefined }}>
                {r.winner ? (
                  <><AccountBadge type={playerType(r.winner)} /> {r.winner}</>
                ) : (
                  "tie"
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Kpi({ label, value, icon }: { label: string; value: string; icon?: string }) {
  return (
    <div className="kpi">
      <div className="label">{label}</div>
      <div className="value" style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
        {icon && <SkillIcon name={icon} size={20} />} {value}
      </div>
    </div>
  );
}
