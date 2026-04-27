import { useMemo } from "react";
import { useUI } from "../App";
import { useData, levelGainInRange, xpGainInRange } from "../store";
import { colorFor } from "../skills";

export function MVP() {
  const { players, index } = useData();
  const range = useUI((s) => s.range);

  const xpBoard = useMemo(() => {
    if (!index) return [];
    return index.players
      .map((p) => {
        const pf = players[p.rsn];
        return { rsn: p.rsn, value: pf ? xpGainInRange(pf, 0, range) : 0 };
      })
      .sort((a, b) => b.value - a.value);
  }, [index, players, range]);

  const lvlBoard = useMemo(() => {
    if (!index) return [];
    return index.players
      .map((p) => {
        const pf = players[p.rsn];
        return { rsn: p.rsn, value: pf ? levelGainInRange(pf, 0, range) : 0 };
      })
      .sort((a, b) => b.value - a.value);
  }, [index, players, range]);

  if (!index) return null;

  return (
    <>
      <Board title={`MVP — XP gained (${range})`} rows={xpBoard} suffix=" xp" />
      <Board title={`MVP — Levels gained (${range})`} rows={lvlBoard} suffix=" lvls" />
    </>
  );
}

function Board({ title, rows, suffix }: { title: string; rows: { rsn: string; value: number }[]; suffix: string }) {
  const podium = rows.slice(0, 3);
  return (
    <div className="panel">
      <h2>{title}</h2>
      {rows.every((r) => r.value === 0) ? (
        <div className="empty">No movement in this range yet.</div>
      ) : (
        <>
          <div className="podium">
            {[1, 0, 2].map((order) => {
              const r = podium[order];
              if (!r) return <div key={order} />;
              return (
                <div key={r.rsn} className={"step" + (order === 0 ? " first" : "")}>
                  <div style={{ fontSize: "1.4rem" }}>{order === 0 ? "🥇" : order === 1 ? "🥈" : "🥉"}</div>
                  <div className="who" style={{ color: colorFor(r.rsn) }}>{r.rsn}</div>
                  <div className="what">{r.value.toLocaleString()}{suffix}</div>
                </div>
              );
            })}
          </div>
          <table style={{ marginTop: "1rem" }}>
            <thead><tr><th>#</th><th>Player</th><th className="num">Gained</th></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.rsn}>
                  <td className="num">{i + 1}</td>
                  <td><span style={{ color: colorFor(r.rsn) }}>●</span> {r.rsn}</td>
                  <td className="num">{r.value.toLocaleString()}{suffix}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
