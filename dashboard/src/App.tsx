import { useEffect } from "react";
import { NavLink, Route, Routes } from "react-router-dom";
import { useData, RANGE_OPTIONS, type RangeKey } from "./store";
import { create } from "zustand";
import { Overall } from "./views/Overall";
import { SkillRace } from "./views/SkillRace";
import { PlayerDetail } from "./views/PlayerDetail";
import { Activity } from "./views/Activity";
import { Milestones } from "./views/Milestones";
import { Goals } from "./views/Goals";
import { Records } from "./views/Records";
import { Compare } from "./views/Compare";
import { AccountBadge, type AccountType } from "./components/AccountBadge";

interface UIState {
  range: RangeKey;
  setRange: (r: RangeKey) => void;
  /** Account-type filter; empty set ⇒ show all. */
  typeFilter: Set<AccountType>;
  toggleType: (t: AccountType) => void;
  /** When true, players with no XP gain in the last 7 days are hidden everywhere. */
  hideInactive: boolean;
  setHideInactive: (v: boolean) => void;
}
export const useUI = create<UIState>((set, get) => ({
  range: "30d",
  setRange: (r) => set({ range: r }),
  typeFilter: new Set(),
  toggleType: (t) => {
    const cur = new Set(get().typeFilter);
    if (cur.has(t)) cur.delete(t);
    else cur.add(t);
    set({ typeFilter: cur });
  },
  hideInactive: true,
  setHideInactive: (v) => set({ hideInactive: v }),
}));

/** Helper hook: filter an array of {type} entries by the active type filter. */
export function useTypeFilter() {
  return useUI((s) => s.typeFilter);
}

const ACCOUNT_TYPES: AccountType[] = ["main", "ironman", "gim"];

export function App() {
  const { load, loading, error, index } = useData();
  const range = useUI((s) => s.range);
  const setRange = useUI((s) => s.setRange);
  const typeFilter = useUI((s) => s.typeFilter);
  const toggleType = useUI((s) => s.toggleType);
  const hideInactive = useUI((s) => s.hideInactive);
  const setHideInactive = useUI((s) => s.setHideInactive);

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
        <NavLink to="/activity">Activity</NavLink>
        <NavLink to="/milestones">Milestones</NavLink>
        <NavLink to="/goals">Goals</NavLink>
        <NavLink to="/records">Records</NavLink>
        <NavLink to="/compare">Compare</NavLink>
        <span className="spacer" />
        <div className="range-bar" title="Account-type filter">
          {ACCOUNT_TYPES.map((t) => (
            <button
              key={t}
              className={typeFilter.has(t) ? "active" : ""}
              onClick={() => toggleType(t)}
              style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem" }}
            >
              <AccountBadge type={t} size={14} />
              {t === "gim" ? "GIM" : t}
            </button>
          ))}
        </div>
        <div className="range-bar" title="Hide players with no XP gain in the last 7 days">
          <button
            className={hideInactive ? "active" : ""}
            onClick={() => setHideInactive(!hideInactive)}
          >
            {hideInactive ? "Hiding inactive" : "Showing all"}
          </button>
        </div>
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
            <Route path="/activity" element={<Activity />} />
            <Route path="/milestones" element={<Milestones />} />
            <Route path="/goals" element={<Goals />} />
            <Route path="/records" element={<Records />} />
            <Route path="/compare" element={<Compare />} />
            <Route path="/skills/:name" element={<SkillRace />} />
            <Route path="/players" element={<PlayerDetail />} />
            <Route path="/players/:rsn" element={<PlayerDetail />} />
          </Routes>
        )}
      </main>
    </div>
  );
}
