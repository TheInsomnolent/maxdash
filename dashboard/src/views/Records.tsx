import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useUI } from "../App";
import { useData, filterPlayers } from "../store";
import { colorFor } from "../skills";
import { AccountBadge, type AccountType } from "../components/AccountBadge";
import { SkillIcon } from "../components/SkillIcon";
import { fmtXp } from "../activity";
import {
  computePlayerRecords, buildAllDayRecords,
  type PlayerRecords,
} from "../records";

interface RecordsRow extends PlayerRecords {
  type: AccountType;
}

const fmtDate = (ms: number | null | undefined) =>
  ms == null ? "—" : new Date(ms).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

export function Records() {
  const { players, index } = useData();
  const typeFilter = useUI((s) => s.typeFilter);
  const hideInactive = useUI((s) => s.hideInactive);

  const visible = useMemo(
    () => index ? filterPlayers(index.players, typeFilter, hideInactive) : [],
    [index, typeFilter, hideInactive],
  );

  const rows = useMemo<RecordsRow[]>(() => {
    return visible
      .map((p) => {
        const pf = players[p.rsn];
        if (!pf) return null;
        const rec = computePlayerRecords(pf);
        return { ...rec, type: p.type };
      })
      .filter((r): r is RecordsRow => r !== null);
  }, [visible, players]);

  const groupRecords = useMemo(() => {
    const pfs = visible.map((p) => players[p.rsn]).filter(Boolean);
    return buildAllDayRecords(pfs, 10);
  }, [visible, players]);

  if (!index) return null;

  return (
    <>
      <div className="panel">
        <h2>Records & Personal Bests</h2>
        <p style={{ marginTop: 0, color: "var(--text-dim)", fontSize: "0.9rem" }}>
          All-time peaks since the first recorded snapshot. Days where snapshots
          are too far apart to attribute reliably are dropped.
        </p>
      </div>

      <div className="panel">
        <h2>Per-player bests</h2>
        <table>
          <thead>
            <tr>
              <th>Player</th>
              <th className="num">Best day</th>
              <th>When</th>
              <th className="num">Best 7-day</th>
              <th className="num">Longest streak</th>
              <th className="num">Current streak</th>
              <th>Best skill grind</th>
            </tr>
          </thead>
          <tbody>
            {rows
              .slice()
              .sort((a, b) => (b.bestDay?.xp ?? 0) - (a.bestDay?.xp ?? 0))
              .map((r) => (
                <tr key={r.rsn}>
                  <td>
                    <span className="swatch" style={{ background: colorFor(r.rsn), color: colorFor(r.rsn) }} />
                    <AccountBadge type={r.type} />{" "}
                    <Link to={`/players/${encodeURIComponent(r.rsn)}`}>{r.rsn}</Link>
                  </td>
                  <td className="num">{r.bestDay ? fmtXp(r.bestDay.xp) : "—"}</td>
                  <td>{fmtDate(r.bestDay?.dayMs)}</td>
                  <td className="num">
                    {r.bestWeek ? fmtXp(r.bestWeek.xp) : "—"}
                    {r.bestWeek && (
                      <div style={{ fontSize: "0.75rem", color: "var(--text-dim)" }}>
                        {fmtDate(r.bestWeek.startMs)}
                      </div>
                    )}
                  </td>
                  <td className="num">
                    {r.longestStreak.length > 0 ? `${r.longestStreak.length}d` : "—"}
                    {r.longestStreak.length > 0 && (
                      <div style={{ fontSize: "0.75rem", color: "var(--text-dim)" }}>
                        {fmtDate(r.longestStreak.startMs)}
                      </div>
                    )}
                  </td>
                  <td className="num">
                    {r.currentStreak > 0
                      ? <span style={{ color: "var(--good)" }}>{r.currentStreak}d</span>
                      : <span style={{ color: "var(--text-dim)" }}>0d</span>}
                  </td>
                  <td>
                    {r.bestSkillDay ? (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem" }}>
                        <SkillIcon name={r.bestSkillDay.skill} size={16} />
                        {r.bestSkillDay.skill} · <strong>{fmtXp(r.bestSkillDay.xp)}</strong>
                        <span style={{ color: "var(--text-dim)", fontSize: "0.85rem" }}>
                          ({fmtDate(r.bestSkillDay.dayMs)})
                        </span>
                      </span>
                    ) : "—"}
                  </td>
                </tr>
              ))}
            {rows.length === 0 && (
              <tr><td colSpan={7}><div className="empty">No data.</div></td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="panel">
        <h2>Group records — biggest single days</h2>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
          <div>
            <h3 style={{ margin: "0 0 0.5rem", color: "var(--text-dim)", fontSize: "1rem" }}>
              Top 10 overall-XP days (any player)
            </h3>
            <table>
              <thead>
                <tr><th>#</th><th>Player</th><th>Date</th><th className="num">XP</th></tr>
              </thead>
              <tbody>
                {groupRecords.topDays.map((d, i) => (
                  <tr key={`${d.rsn}:${d.dayMs}`}>
                    <td className="num">{i + 1}</td>
                    <td>
                      <span className="swatch" style={{ background: colorFor(d.rsn), color: colorFor(d.rsn) }} />
                      <Link to={`/players/${encodeURIComponent(d.rsn)}`}>{d.rsn}</Link>
                    </td>
                    <td>{fmtDate(d.dayMs)}</td>
                    <td className="num"><strong>{fmtXp(d.xp)}</strong></td>
                  </tr>
                ))}
                {groupRecords.topDays.length === 0 && (
                  <tr><td colSpan={4}><div className="empty">No data.</div></td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div>
            <h3 style={{ margin: "0 0 0.5rem", color: "var(--text-dim)", fontSize: "1rem" }}>
              Top 10 single-skill grind days
            </h3>
            <table>
              <thead>
                <tr><th>#</th><th>Player</th><th>Skill</th><th>Date</th><th className="num">XP</th></tr>
              </thead>
              <tbody>
                {groupRecords.topSkillDays.map((d, i) => (
                  <tr key={`${d.rsn}:${d.dayMs}:${d.skill}`}>
                    <td className="num">{i + 1}</td>
                    <td>
                      <span className="swatch" style={{ background: colorFor(d.rsn), color: colorFor(d.rsn) }} />
                      <Link to={`/players/${encodeURIComponent(d.rsn)}`}>{d.rsn}</Link>
                    </td>
                    <td>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem" }}>
                        <SkillIcon name={d.skill} size={16} /> {d.skill}
                      </span>
                    </td>
                    <td>{fmtDate(d.dayMs)}</td>
                    <td className="num"><strong>{fmtXp(d.xp)}</strong></td>
                  </tr>
                ))}
                {groupRecords.topSkillDays.length === 0 && (
                  <tr><td colSpan={5}><div className="empty">No data.</div></td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="panel">
        <h2>Lifetime totals</h2>
        <table>
          <thead>
            <tr>
              <th>Player</th>
              <th className="num">Active days (recorded)</th>
              <th className="num">Lifetime XP gained (since first snapshot)</th>
            </tr>
          </thead>
          <tbody>
            {rows
              .slice()
              .sort((a, b) => b.lifetimeXpGained - a.lifetimeXpGained)
              .map((r) => (
                <tr key={r.rsn}>
                  <td>
                    <span className="swatch" style={{ background: colorFor(r.rsn), color: colorFor(r.rsn) }} />
                    <AccountBadge type={r.type} />{" "}
                    <Link to={`/players/${encodeURIComponent(r.rsn)}`}>{r.rsn}</Link>
                  </td>
                  <td className="num">{r.activeDays}</td>
                  <td className="num">{fmtXp(r.lifetimeXpGained)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
