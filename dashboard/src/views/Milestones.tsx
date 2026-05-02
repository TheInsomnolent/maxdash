import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useUI } from "../App";
import { useData, filterPlayers } from "../store";
import { colorFor } from "../skills";
import { AccountBadge } from "../components/AccountBadge";
import { SkillIcon } from "../components/SkillIcon";
import {
  milestonesForPlayer,
  MILESTONE_KIND_LABEL,
  MILESTONE_KINDS,
  type Milestone,
  type MilestoneKind,
} from "../milestones";

const LAST_VISIT_KEY = "maxdash:milestones:lastVisit";

export function Milestones() {
  const { players, index } = useData();
  const typeFilter = useUI((s) => s.typeFilter);
  const hideInactive = useUI((s) => s.hideInactive);

  const [enabledKinds, setEnabledKinds] = useState<Set<MilestoneKind>>(
    () => new Set(MILESTONE_KINDS),
  );
  // Read last-visit from localStorage so we can highlight everything since.
  // Persist the *previous* value, then immediately bump it so refreshing the
  // page doesn't strip the highlight before the user has a chance to read.
  const [highlightSince, setHighlightSince] = useState<number | null>(null);
  useEffect(() => {
    const raw = window.localStorage.getItem(LAST_VISIT_KEY);
    setHighlightSince(raw ? Number(raw) : 0);
    window.localStorage.setItem(LAST_VISIT_KEY, String(Date.now()));
  }, []);

  const visible = useMemo(
    () => index ? filterPlayers(index.players, typeFilter, hideInactive) : [],
    [index, typeFilter, hideInactive],
  );
  const visibleRsns = useMemo(() => new Set(visible.map((p) => p.rsn)), [visible]);

  const allMilestones = useMemo<Milestone[]>(() => {
    const out: Milestone[] = [];
    for (const p of visible) {
      const pf = players[p.rsn];
      if (!pf) continue;
      out.push(...milestonesForPlayer(pf));
    }
    out.sort((a, b) => Date.parse(b.t) - Date.parse(a.t));
    return out;
  }, [visible, players]);

  const filtered = useMemo(
    () => allMilestones.filter((m) => enabledKinds.has(m.kind) && visibleRsns.has(m.rsn)),
    [allMilestones, enabledKinds, visibleRsns],
  );

  const newCount = useMemo(() => {
    if (highlightSince == null) return 0;
    return filtered.filter((m) => Date.parse(m.t) > highlightSince).length;
  }, [filtered, highlightSince]);

  // Group by calendar day for a tidy timeline.
  const groups = useMemo(() => {
    const byDay = new Map<string, Milestone[]>();
    for (const m of filtered) {
      const d = new Date(m.t);
      d.setHours(0, 0, 0, 0);
      const key = d.toISOString();
      const arr = byDay.get(key) ?? [];
      arr.push(m);
      byDay.set(key, arr);
    }
    return [...byDay.entries()]
      .sort((a, b) => Date.parse(b[0]) - Date.parse(a[0]))
      .map(([day, items]) => ({
        day,
        items: items.sort((a, b) => b.weight - a.weight || Date.parse(b.t) - Date.parse(a.t)),
      }));
  }, [filtered]);

  const toggleKind = (k: MilestoneKind) => {
    const next = new Set(enabledKinds);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    setEnabledKinds(next);
  };

  const totalEver = allMilestones.length;

  return (
    <>
      <div className="panel">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.75rem" }}>
          <h2 style={{ margin: 0 }}>
            Milestones
            {newCount > 0 && (
              <span className="milestone-new-pill" title="New since your last visit">
                {newCount} new
              </span>
            )}
          </h2>
          <div className="range-bar" title="Filter milestone kinds">
            {MILESTONE_KINDS.map((k) => (
              <button
                key={k}
                className={enabledKinds.has(k) ? "active" : ""}
                onClick={() => toggleKind(k)}
              >
                {MILESTONE_KIND_LABEL[k]}
              </button>
            ))}
          </div>
        </div>
        <div style={{ marginTop: "0.5rem", color: "var(--text-dim)", fontSize: "0.9rem" }}>
          {filtered.length.toLocaleString()} of {totalEver.toLocaleString()} milestones shown.
          {highlightSince != null && highlightSince > 0 && (
            <> Last visit: {new Date(highlightSince).toLocaleString()}.</>
          )}
        </div>
      </div>

      {groups.length === 0 ? (
        <div className="panel"><div className="empty">No milestones recorded yet for this filter.</div></div>
      ) : (
        <div className="panel">
          <div className="timeline">
            {groups.map(({ day, items }) => (
              <div key={day} className="timeline-day">
                <div className="timeline-day-header">
                  {new Date(day).toLocaleDateString(undefined, {
                    weekday: "long", year: "numeric", month: "long", day: "numeric",
                  })}
                </div>
                <div className="timeline-items">
                  {items.map((m, i) => (
                    <MilestoneRow
                      key={`${day}:${i}:${m.rsn}:${m.kind}:${m.value}`}
                      m={m}
                      isNew={highlightSince != null && Date.parse(m.t) > highlightSince}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

function MilestoneRow({ m, isNew }: { m: Milestone; isNew: boolean }) {
  const { index } = useData();
  const player = index?.players.find((p) => p.rsn === m.rsn);
  const color = colorFor(m.rsn);
  const time = new Date(m.t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const featured = m.weight >= 60;
  return (
    <div className={"timeline-item" + (featured ? " featured" : "") + (isNew ? " is-new" : "")}>
      <div className="timeline-icon" style={{ borderColor: color }}>
        {m.skill ? <SkillIcon name={m.skill} size={28} /> : <span className="timeline-icon-glyph">{glyphFor(m.kind)}</span>}
      </div>
      <div className="timeline-body">
        <div className="timeline-title">
          {m.title}
          {isNew && <span className="milestone-new-pill small">NEW</span>}
        </div>
        <div className="timeline-sub">
          <span className="swatch" style={{ background: color, color }} />
          {player && <AccountBadge type={player.type} />}{" "}
          <Link to={`/players/${encodeURIComponent(m.rsn)}`} style={{ color }}>{m.rsn}</Link>
          <span className="timeline-time"> · {time}</span>
        </div>
      </div>
    </div>
  );
}

function glyphFor(kind: MilestoneKind): string {
  switch (kind) {
    case "skill99": return "★";
    case "totalLevel": return "Σ";
    case "totalXp": return "✦";
    case "bigDay": return "⚡";
    default: return "•";
  }
}
