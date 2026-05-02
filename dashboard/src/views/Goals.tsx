import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useUI } from "../App";
import { useData, filterPlayers } from "../store";
import { colorFor } from "../skills";
import { AccountBadge } from "../components/AccountBadge";
import { SkillIcon } from "../components/SkillIcon";
import {
  defaultGoals, evaluateGoal, loadGoals, saveGoals,
  SKILL_OPTIONS_FOR_GOALS,
  type Goal, type GoalProgress,
} from "../goals";

type DraftKind = Goal["kind"];

interface Draft {
  kind: DraftKind;
  title: string;
  skill: string;
  level: number;
  target: number;
}

function newDraft(): Draft {
  return {
    kind: "everyoneReachesLevel",
    title: "",
    skill: "Slayer",
    level: 90,
    target: 1_000_000_000,
  };
}

export function Goals() {
  const { players, index } = useData();
  const typeFilter = useUI((s) => s.typeFilter);
  const hideInactive = useUI((s) => s.hideInactive);

  const [goals, setGoals] = useState<Goal[]>(() => loadGoals());
  const [draft, setDraft] = useState<Draft>(newDraft);
  const [editing, setEditing] = useState<string | null>(null);

  // Persist whenever the goals list changes.
  useEffect(() => { saveGoals(goals); }, [goals]);

  const visible = useMemo(
    () => index ? filterPlayers(index.players, typeFilter, hideInactive) : [],
    [index, typeFilter, hideInactive],
  );

  const evaluated = useMemo<GoalProgress[]>(() => {
    if (!index) return [];
    return goals.map((g) => evaluateGoal(g, visible, players));
  }, [goals, visible, players, index]);

  const addOrUpdate = () => {
    const g = draftToGoal(draft, editing);
    if (!g) return;
    setGoals((prev) => {
      const existing = prev.findIndex((x) => x.id === g.id);
      if (existing >= 0) {
        const next = [...prev];
        next[existing] = g;
        return next;
      }
      return [g, ...prev];
    });
    setDraft(newDraft());
    setEditing(null);
  };

  const remove = (id: string) => setGoals((prev) => prev.filter((g) => g.id !== id));
  const restore = () => setGoals(defaultGoals());
  const beginEdit = (g: Goal) => {
    setEditing(g.id);
    setDraft({
      kind: g.kind,
      title: g.title,
      skill: "skill" in g ? g.skill : "Overall",
      level: g.kind === "everyoneReachesLevel" ? g.level : 99,
      target: g.kind === "groupTotalXp" ? g.target
        : g.kind === "groupHas99sCount" ? g.target
        : 1_000_000_000,
    });
  };

  return (
    <>
      <div className="panel">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.75rem" }}>
          <h2 style={{ margin: 0 }}>Group goals</h2>
          <button className="btn" onClick={restore} title="Restore the built-in goal set">
            Restore defaults
          </button>
        </div>
        <p style={{ marginTop: 0, color: "var(--text-dim)", fontSize: "0.9rem" }}>
          Track shared objectives across the whole roster. Custom goals are saved to your browser's localStorage.
        </p>

        <div className="goal-form">
          <select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as DraftKind })}>
            <option value="everyoneReachesLevel">Everyone reaches level…</option>
            <option value="groupTotalXp">Group total XP target…</option>
            <option value="groupHas99sCount">Collective 99s count…</option>
          </select>

          {(draft.kind === "everyoneReachesLevel" || draft.kind === "groupTotalXp") && (
            <select value={draft.skill} onChange={(e) => setDraft({ ...draft, skill: e.target.value })}>
              {SKILL_OPTIONS_FOR_GOALS.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          )}

          {draft.kind === "everyoneReachesLevel" && (
            <input
              type="number"
              min={2}
              max={draft.skill === "Overall" ? 2277 : 99}
              value={draft.level}
              onChange={(e) => setDraft({ ...draft, level: Math.max(2, Number(e.target.value) || 0) })}
              placeholder="Target level"
              style={{ width: 100 }}
            />
          )}
          {draft.kind === "groupTotalXp" && (
            <input
              type="number"
              min={1}
              step={1_000_000}
              value={draft.target}
              onChange={(e) => setDraft({ ...draft, target: Math.max(1, Number(e.target.value) || 0) })}
              placeholder="Target XP"
              style={{ width: 160 }}
            />
          )}
          {draft.kind === "groupHas99sCount" && (
            <input
              type="number"
              min={1}
              value={draft.target}
              onChange={(e) => setDraft({ ...draft, target: Math.max(1, Number(e.target.value) || 0) })}
              placeholder="Target 99s"
              style={{ width: 100 }}
            />
          )}

          <input
            type="text"
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            placeholder="Optional custom title"
            style={{ flex: 1, minWidth: 200 }}
          />
          <button className="btn primary" onClick={addOrUpdate}>
            {editing ? "Save" : "Add goal"}
          </button>
          {editing && (
            <button className="btn" onClick={() => { setEditing(null); setDraft(newDraft()); }}>
              Cancel
            </button>
          )}
        </div>
      </div>

      <div className="goals-grid">
        {evaluated.map((p) => (
          <GoalCard
            key={p.goal.id}
            progress={p}
            onEdit={() => beginEdit(p.goal)}
            onDelete={() => remove(p.goal.id)}
          />
        ))}
      </div>
    </>
  );
}

function GoalCard({
  progress, onEdit, onDelete,
}: {
  progress: GoalProgress;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { goal, percent, current, target, contributions, etaDays, format } = progress;
  const skill = "skill" in goal ? goal.skill : null;
  const completed = percent >= 100;

  // Sort by largest contribution so the heroes show up first.
  const sortedContribs = [...contributions].sort((a, b) => b.contribution - a.contribution);

  return (
    <div className={"panel goal-card" + (completed ? " complete" : "")}>
      <div className="goal-head">
        <div className="goal-title">
          {skill && <SkillIcon name={skill} size={22} />}
          {goal.title}
        </div>
        <div className="goal-actions">
          <button className="btn small" onClick={onEdit}>Edit</button>
          <button className="btn small danger" onClick={onDelete}>Remove</button>
        </div>
      </div>
      <div className="goal-bar">
        <div className="goal-bar-fill" style={{ width: `${Math.min(100, percent)}%` }} />
        <div className="goal-bar-label">{percent.toFixed(1)}%</div>
      </div>
      <div className="goal-meta">
        <span><strong>{format(current)}</strong> / {format(target)}</span>
        {etaDays != null && etaDays > 0 && <span>ETA ~{formatEta(etaDays)} at recent pace</span>}
        {etaDays === 0 && <span style={{ color: "var(--good)" }}>Complete</span>}
      </div>
      <div className="goal-contrib-list">
        {sortedContribs.map((c) => (
          <ContribRow key={c.rsn} c={c} format={format} />
        ))}
      </div>
    </div>
  );
}

function ContribRow({
  c, format,
}: {
  c: { rsn: string; current: number; target: number; contribution: number; done: boolean };
  format: (n: number) => string;
}) {
  const { index } = useData();
  const player = index?.players.find((p) => p.rsn === c.rsn);
  const color = colorFor(c.rsn);
  const pct = Math.min(100, c.contribution);
  return (
    <div className={"goal-contrib" + (c.done ? " done" : "")}>
      <div className="goal-contrib-name">
        <span className="swatch" style={{ background: color, color }} />
        {player && <AccountBadge type={player.type} />}{" "}
        <Link to={`/players/${encodeURIComponent(c.rsn)}`} style={{ color }}>{c.rsn}</Link>
      </div>
      <div className="goal-contrib-bar">
        <div
          className="goal-contrib-fill"
          style={{ width: `${pct}%`, background: color, opacity: c.done ? 1 : 0.85 }}
        />
      </div>
      <div className="goal-contrib-val">{format(c.current)}</div>
    </div>
  );
}

function draftToGoal(draft: Draft, editingId: string | null): Goal | null {
  const id = editingId ?? `user:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
  switch (draft.kind) {
    case "everyoneReachesLevel": {
      if (draft.level < 2) return null;
      const cap = draft.skill === "Overall" ? 2277 : 99;
      const lvl = Math.min(cap, draft.level);
      return {
        id, kind: "everyoneReachesLevel",
        title: draft.title.trim() ||
          (draft.skill === "Overall"
            ? `Everyone hits Total Level ${lvl}`
            : `Everyone reaches ${lvl} ${draft.skill}`),
        skill: draft.skill, level: lvl,
      };
    }
    case "groupTotalXp": {
      if (draft.target < 1) return null;
      return {
        id, kind: "groupTotalXp",
        title: draft.title.trim() || `Group ${draft.skill} XP reaches ${formatBig(draft.target)}`,
        skill: draft.skill, target: draft.target,
      };
    }
    case "groupHas99sCount":
      if (draft.target < 1) return null;
      return {
        id, kind: "groupHas99sCount",
        title: draft.title.trim() || `${draft.target} collective 99s across the roster`,
        target: draft.target,
      };
  }
}

function formatBig(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(0)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return String(n);
}

function formatEta(days: number): string {
  if (days < 1) return "<1d";
  if (days < 60) return `${Math.round(days)}d`;
  if (days < 365 * 2) return `${(days / 30).toFixed(1)}mo`;
  return `${(days / 365).toFixed(1)}y`;
}
