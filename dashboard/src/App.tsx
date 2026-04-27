import { useEffect } from "react";
import { NavLink, Route, Routes } from "react-router-dom";
import { useData, RANGE_OPTIONS, type RangeKey } from "./store";
import { create } from "zustand";
import { Overall } from "./views/Overall";
import { SkillRace } from "./views/SkillRace";
import { PlayerDetail } from "./views/PlayerDetail";
import { MVP } from "./views/MVP";
import { Fun } from "./views/Fun";

interface UIState {
  range: RangeKey;
  setRange: (r: RangeKey) => void;
}
export const useUI = create<UIState>((set) => ({
  range: "7d",
  setRange: (r) => set({ range: r }),
}));

export function App() {
  const { load, loading, error, index } = useData();
  const range = useUI((s) => s.range);
  const setRange = useUI((s) => s.setRange);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="app">
      <nav className="nav">
        <span className="brand">maxdash</span>
        <NavLink to="/" end>Overall</NavLink>
        <NavLink to="/skills">Skills</NavLink>
        <NavLink to="/players">Players</NavLink>
        <NavLink to="/mvp">MVP</NavLink>
        <NavLink to="/fun">Fun</NavLink>
        <span className="spacer" />
        <div className="range-bar">
          {RANGE_OPTIONS.map((opt) => (
            <button
              key={opt.key}
              className={range === opt.key ? "active" : ""}
              onClick={() => setRange(opt.key)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </nav>
      <main className="main">
        {error && <div className="error">Failed to load data: {error}</div>}
        {!index && loading && <div className="empty">Loading…</div>}
        {!index && !loading && !error && (
          <div className="empty">
            No data yet. Run <code>npm run snapshot</code> to gather a baseline.
          </div>
        )}
        {index && (
          <Routes>
            <Route path="/" element={<Overall />} />
            <Route path="/skills" element={<SkillRace />} />
            <Route path="/skills/:name" element={<SkillRace />} />
            <Route path="/players" element={<PlayerDetail />} />
            <Route path="/players/:rsn" element={<PlayerDetail />} />
            <Route path="/mvp" element={<MVP />} />
            <Route path="/fun" element={<Fun />} />
          </Routes>
        )}
      </main>
    </div>
  );
}
