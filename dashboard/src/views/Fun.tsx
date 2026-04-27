import { useMemo, useState } from "react";
import { useUI } from "../App";
import { useData, noXpStreakHours, snapshotsInRange, xpGainInRange } from "../store";
import { TRAINABLE_SKILLS, colorFor } from "../skills";

export function Fun() {
  const { players, index } = useData();
  const range = useUI((s) => s.range);

  const slacker = useMemo(() => {
    if (!index) return [];
    return index.players
      .map((p) => ({ rsn: p.rsn, hours: players[p.rsn] ? noXpStreakHours(players[p.rsn]) : null }))
      .filter((r): r is { rsn: string; hours: number } => r.hours != null)
      .sort((a, b) => b.hours - a.hours);
  }, [index, players]);

  const efficiency = useMemo(() => {
    if (!index) return [];
    return index.players
      .map((p) => {
        const pf = players[p.rsn];
        if (!pf) return { rsn: p.rsn, xpPerActiveHr: 0 };
        const inR = snapshotsInRange(pf, range);
        let activeHrs = 0;
        let xp = 0;
        for (let i = 1; i < inR.length; i++) {
          const a = inR[i - 1].s[0];
          const b = inR[i].s[0];
          if (a < 0 || b < 0 || b === a) continue;
          activeHrs += (Date.parse(inR[i].t) - Date.parse(inR[i - 1].t)) / 3600_000;
          xp += b - a;
        }
        return { rsn: p.rsn, xpPerActiveHr: activeHrs > 0 ? xp / activeHrs : 0 };
      })
      .sort((a, b) => b.xpPerActiveHr - a.xpPerActiveHr);
  }, [index, players, range]);

  // Rivalry head-to-head: pick two players, see XP gain per skill in range.
  const playerOptions = index?.players.map((p) => p.rsn) ?? [];
  const [a, setA] = useState(playerOptions[0] ?? "");
  const [b, setB] = useState(playerOptions[1] ?? playerOptions[0] ?? "");

  const rivalry = useMemo(() => {
    if (!index || !players[a] || !players[b]) return [];
    return TRAINABLE_SKILLS.map((s, i) => {
      const idx = i + 1;
      const ga = xpGainInRange(players[a], idx, range);
      const gb = xpGainInRange(players[b], idx, range);
      return { skill: s, a: ga, b: gb, winner: ga === gb ? null : ga > gb ? a : b };
    });
  }, [index, players, a, b, range]);

  if (!index) return null;

  return (
    <>
      <div className="panel">
        <h2>Slacker board — longest no-XP streak</h2>
        <table>
          <thead><tr><th>#</th><th>Player</th><th className="num">Hours idle</th></tr></thead>
          <tbody>
            {slacker.map((r, i) => (
              <tr key={r.rsn}>
                <td className="num">{i + 1}</td>
                <td><span style={{ color: colorFor(r.rsn) }}>●</span> {r.rsn}</td>
                <td className="num">{r.hours.toFixed(1)}h</td>
              </tr>
            ))}
            {!slacker.length && <tr><td colSpan={3} className="empty">Need more snapshots.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="panel">
        <h2>Efficiency — XP per active hour ({range})</h2>
        <table>
          <thead><tr><th>#</th><th>Player</th><th className="num">XP / active hr</th></tr></thead>
          <tbody>
            {efficiency.map((r, i) => (
              <tr key={r.rsn}>
                <td className="num">{i + 1}</td>
                <td><span style={{ color: colorFor(r.rsn) }}>●</span> {r.rsn}</td>
                <td className="num">{Math.round(r.xpPerActiveHr).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="panel">
        <h2>Rivalry head-to-head ({range})</h2>
        <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.75rem" }}>
          <select value={a} onChange={(e) => setA(e.target.value)}>
            {playerOptions.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <span>vs.</span>
          <select value={b} onChange={(e) => setB(e.target.value)}>
            {playerOptions.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <table>
          <thead>
            <tr>
              <th>Skill</th>
              <th className="num" style={{ color: colorFor(a) }}>{a}</th>
              <th className="num" style={{ color: colorFor(b) }}>{b}</th>
              <th>Winner</th>
            </tr>
          </thead>
          <tbody>
            {rivalry.map((r) => (
              <tr key={r.skill}>
                <td>{r.skill}</td>
                <td className="num">{r.a.toLocaleString()}</td>
                <td className="num">{r.b.toLocaleString()}</td>
                <td style={{ color: r.winner ? colorFor(r.winner) : undefined }}>
                  {r.winner ?? "tie"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
