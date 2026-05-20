import { useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useUI } from "../App";
import { useData, filterPlayers, latestSnapshot } from "../store";
import { TRAINABLE_SKILLS, type SkillName } from "../skills";
import { SkillIcon } from "../components/SkillIcon";
import { AccountBadge } from "../components/AccountBadge";
import {
  DEFAULT_ELIGIBLE_SKILLS,
  loadEligibleSkills,
  saveEligibleSkills,
  tearsReportForPlayer,
  topUpsToRedirect,
} from "../tears";

function fmt(n: number): string {
  return n.toLocaleString();
}

export function Tears() {
  const { rsn: routeRsn } = useParams<{ rsn?: string }>();
  const navigate = useNavigate();
  const { players, index } = useData();
  const typeFilter = useUI((s) => s.typeFilter);
  const hideInactive = useUI((s) => s.hideInactive);

  const [eligible, setEligibleState] = useState<Set<SkillName>>(() => loadEligibleSkills());
  const setEligible = (next: Set<SkillName>) => {
    setEligibleState(next);
    saveEligibleSkills(next);
  };
  const toggleSkill = (skill: SkillName) => {
    const next = new Set(eligible);
    if (next.has(skill)) next.delete(skill);
    else next.add(skill);
    setEligible(next);
  };
  const resetEligible = () => setEligible(new Set(DEFAULT_ELIGIBLE_SKILLS));

  const visible = useMemo(
    () => (index ? filterPlayers(index.players, typeFilter, hideInactive) : []),
    [index, typeFilter, hideInactive],
  );

  const selectedRsn = useMemo(() => {
    if (routeRsn && players[routeRsn]) return routeRsn;
    return visible[0]?.rsn ?? null;
  }, [routeRsn, players, visible]);

  const [targetSkill, setTargetSkill] = useState<SkillName | "">("");

  const player = selectedRsn ? players[selectedRsn] : null;
  const entry = selectedRsn ? index?.players.find((p) => p.rsn === selectedRsn) ?? null : null;
  const snap = player ? latestSnapshot(player) : null;

  const report = useMemo(() => {
    if (!snap) return null;
    return tearsReportForPlayer(snap.s, eligible);
  }, [snap, eligible]);

  const redirect = useMemo(() => {
    if (!snap || !targetSkill) return null;
    return topUpsToRedirect(snap.s, eligible, targetSkill);
  }, [snap, eligible, targetSkill]);

  const eligibleArr = useMemo(
    () => TRAINABLE_SKILLS.filter((s) => eligible.has(s)),
    [eligible],
  );

  return (
    <>
      <div className="panel">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.75rem" }}>
          <h2 style={{ margin: 0 }}>
            <SkillIcon name="Prayer" size={22} />
            Tears of Guthix
          </h2>
          <button className="btn" onClick={resetEligible} title="Restore the default eligible-skill set">
            Reset eligible skills
          </button>
        </div>
        <p style={{ marginTop: 0, color: "var(--text-dim)", fontSize: "0.9rem" }}>
          Tears of Guthix rewards XP in your lowest-XP skill. Toggle off any quest-locked or
          unreleased skills you don't want to count.
        </p>
        <div className="range-bar" style={{ marginTop: "0.5rem" }}>
          {TRAINABLE_SKILLS.map((s) => (
            <button
              key={s}
              className={eligible.has(s) ? "active" : ""}
              onClick={() => toggleSkill(s)}
              title={eligible.has(s) ? `${s} is eligible` : `${s} is excluded`}
              style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem" }}
            >
              <SkillIcon name={s} size={14} />
              {s}
            </button>
          ))}
        </div>
      </div>

      <div className="panel">
        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
          <label style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
            <span style={{ color: "var(--text-dim)" }}>Player:</span>
            <select
              value={selectedRsn ?? ""}
              onChange={(e) => navigate(`/tears/${encodeURIComponent(e.target.value)}`)}
            >
              {visible.length === 0 && <option value="">(no players)</option>}
              {visible.map((p) => (
                <option key={p.rsn} value={p.rsn}>{p.rsn}</option>
              ))}
            </select>
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
            <span style={{ color: "var(--text-dim)" }}>Target skill:</span>
            <select
              value={targetSkill}
              onChange={(e) => setTargetSkill(e.target.value as SkillName | "")}
            >
              <option value="">— none —</option>
              {eligibleArr.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </label>
          {entry && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", marginLeft: "auto" }}>
              <AccountBadge type={entry.type} size={16} />
              <span style={{ color: "var(--text-dim)" }}>{entry.type}</span>
            </span>
          )}
        </div>
      </div>

      {!player && (
        <div className="panel empty">Select a player to see their next Tears of Guthix reward.</div>
      )}

      {player && report && report.lowest && (
        <div className="panel">
          <h2>Next reward</h2>
          <div style={{ display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <SkillIcon name={report.lowest.skill} size={28} />
              <span style={{ fontFamily: "'RuneScape', serif", fontSize: "1.6rem", color: "var(--accent)" }}>
                {report.lowest.skill}
              </span>
            </div>
            <span style={{ color: "var(--text-dim)" }}>
              currently {fmt(report.lowest.xp)} xp
            </span>
          </div>
          {report.gapToNext != null && report.nextSkill ? (
            <p style={{ marginTop: "0.75rem", marginBottom: 0 }}>
              Can gain up to <strong>{fmt(report.gapToNext)} xp</strong> in{" "}
              <SkillIcon name={report.lowest.skill} size={14} /> {report.lowest.skill} before
              Tears flips to <SkillIcon name={report.nextSkill} size={14} /> {report.nextSkill}.
            </p>
          ) : (
            <p style={{ marginTop: "0.75rem", marginBottom: 0, color: "var(--text-dim)" }}>
              No other eligible skills to compare against.
            </p>
          )}
        </div>
      )}

      {player && report && !report.lowest && (
        <div className="panel empty">No eligible skills selected — enable at least one above.</div>
      )}

      {player && targetSkill && redirect && (
        <div className="panel">
          <h2>
            Redirect to <SkillIcon name={targetSkill} size={20} /> {targetSkill}
          </h2>
          {redirect.kind === "ineligible" && (
            <p style={{ color: "var(--text-dim)" }}>{redirect.reason}</p>
          )}
          {redirect.kind === "alreadyLowest" && (
            <p>
              <SkillIcon name={targetSkill} size={16} /> <strong>{targetSkill}</strong> is already
              the lowest eligible skill ({fmt(redirect.targetXp)} xp). The next Tears reward will
              land here.
            </p>
          )}
          {redirect.kind === "topUps" && (
            <>
              <p style={{ marginTop: 0, color: "var(--text-dim)" }}>
                To make <strong>{targetSkill}</strong> the lowest-XP eligible skill
                ({fmt(redirect.targetXp)} xp), train the following skills past it:
              </p>
              <table>
                <thead>
                  <tr>
                    <th>Skill</th>
                    <th className="num">Current XP</th>
                    <th className="num">XP needed</th>
                  </tr>
                </thead>
                <tbody>
                  {redirect.rows.map((r) => (
                    <tr key={r.skill}>
                      <td>
                        <SkillIcon name={r.skill} size={16} /> {r.skill}
                      </td>
                      <td className="num">{fmt(r.currentXp)}</td>
                      <td className="num">{fmt(r.xpNeeded)}</td>
                    </tr>
                  ))}
                  <tr>
                    <td><strong>Total</strong></td>
                    <td className="num"></td>
                    <td className="num"><strong>{fmt(redirect.totalXpNeeded)}</strong></td>
                  </tr>
                </tbody>
              </table>
            </>
          )}
        </div>
      )}

      {player && report && report.ranked.length > 0 && (
        <div className="panel">
          <h2>Eligible skills, ranked</h2>
          <table>
            <thead>
              <tr>
                <th className="num">#</th>
                <th>Skill</th>
                <th className="num">XP</th>
                <th className="num">XP over lowest</th>
              </tr>
            </thead>
            <tbody>
              {report.ranked.map((r, i) => {
                const overLowest = report.lowest ? r.xp - report.lowest.xp : 0;
                const isTarget = targetSkill && r.skill === targetSkill;
                return (
                  <tr key={r.skill} style={isTarget ? { background: "rgba(255,180,59,0.08)" } : undefined}>
                    <td className="num">{i + 1}</td>
                    <td>
                      <SkillIcon name={r.skill} size={16} /> {r.skill}
                    </td>
                    <td className="num">{fmt(r.xp)}</td>
                    <td className="num">{i === 0 ? "—" : fmt(overLowest)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
