import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useCaData, useData, type CaTask, type IndexEntry } from "../store";
import { AccountBadge } from "../components/AccountBadge";
import { CaTierIcon } from "../components/CaTierIcon";
import { Sparkline } from "../components/Sparkline";
import {
  buildPlan,
  CA_TIERS,
  filterTasks,
  fmtPct,
  groupByMonster,
  groupByType,
  groupPlan,
  loadCaPrefs,
  saveCaPrefs,
  tierById,
  tierGap,
  toPlannedTask,
  totalPossiblePoints,
  wikiUrl,
  type CaPrefs,
  type GroupProgress,
  type MonsterGroup,
  type PlannedTask,
  type TierGroup,
} from "../ca";

const GUIDE_URL = "https://runeprofile.com/info/guide";

const fmtWhen = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "—";

function Bar({ value, max, tone }: { value: number; max: number; tone?: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="bar">
      <span style={{ width: `${pct}%`, ...(tone ? { background: tone } : {}) }} />
    </div>
  );
}

/** Prompt shown for accounts that have never uploaded a RuneProfile profile. */
function NotLinked({ rsn }: { rsn: string }) {
  return (
    <div className="panel ca-notlinked">
      <h2>{rsn} isn't linked to RuneProfile</h2>
      <p>
        Combat Achievement data comes from RuneProfile, which needs the
        RuneLite plugin to upload a profile before anything shows up here.
      </p>
      <ol className="ca-steps">
        <li>
          Install the <strong>RuneProfile</strong> RuneLite plugin and log in on{" "}
          <strong>{rsn}</strong> — the{" "}
          <a href={GUIDE_URL} target="_blank" rel="noreferrer">
            RuneProfile setup guide
          </a>{" "}
          walks through it.
        </li>
        <li>Open the Combat Achievements interface in-game so the plugin can read your tasks.</li>
        <li>Wait for maxdash to pick the profile up.</li>
      </ol>
      <p className="ca-warn-inline">
        Heads up: this won't be instant. maxdash scrapes RuneProfile on an
        hourly cron, so your tasks will only appear here after the next
        scheduled run has completed.
      </p>
      <a className="btn primary" href={GUIDE_URL} target="_blank" rel="noreferrer">
        Open the RuneProfile guide
      </a>
    </div>
  );
}

function GroupTable({
  title,
  rows,
  labelHeader,
  renderLabel,
  emptyText,
}: {
  title: string;
  rows: GroupProgress[];
  labelHeader: string;
  renderLabel?: (row: GroupProgress) => ReactNode;
  emptyText: string;
}) {
  return (
    <div className="panel">
      <h2>{title}</h2>
      {rows.length === 0 ? (
        <div className="empty">{emptyText}</div>
      ) : (
        <div className="ca-scroll">
        <table>
          <thead>
            <tr>
              <th>{labelHeader}</th>
              <th className="num">Done</th>
              <th style={{ width: "22%" }}>Progress</th>
              <th className="num">Pts earned</th>
              <th className="num">Pts left</th>
              <th className="num" title="Best community completion rate among your outstanding tasks">
                Easiest left
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td>{renderLabel ? renderLabel(r) : r.key}</td>
                <td className="num">
                  {r.completed}/{r.total}
                </td>
                <td>
                  <Bar value={r.completed} max={r.total} />
                </td>
                <td className="num">{r.pointsEarned}</td>
                <td className="num">{r.pointsRemaining}</td>
                <td className="num">{fmtPct(r.bestRemainingPct)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
    </div>
  );
}

export function CombatAchievements() {
  const { index } = useData();
  const files = useCaData((s) => s.files);
  const loadingMap = useCaData((s) => s.loading);
  const errorMap = useCaData((s) => s.errors);
  const loadCa = useCaData((s) => s.loadCa);

  const [prefs, setPrefs] = useState<CaPrefs>(() => loadCaPrefs());
  const [monsterQuery, setMonsterQuery] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [collapsedTiers, setCollapsedTiers] = useState<Set<string>>(new Set());
  const [expandedMonsters, setExpandedMonsters] = useState<Set<string>>(new Set());

  useEffect(() => {
    saveCaPrefs(prefs);
  }, [prefs]);

  const accounts: IndexEntry[] = index?.players ?? [];
  const selected: IndexEntry | undefined =
    accounts.find((p) => p.rsn === prefs.rsn) ?? accounts[0];

  const caFilePath = selected?.ca?.file;
  const rsn = selected?.rsn;
  useEffect(() => {
    if (rsn && caFilePath) void loadCa(rsn, caFilePath);
  }, [rsn, caFilePath, loadCa]);

  const caFile = rsn ? files[rsn] : undefined;
  const rawTasks: CaTask[] = useMemo(() => caFile?.tasks ?? [], [caFile]);
  const planned = useMemo(() => rawTasks.map(toPlannedTask), [rawTasks]);

  const missingData = useMemo(
    () => planned.filter((t) => t.missingData),
    [planned],
  );

  const filters = useMemo(
    () => ({
      excludedTypes: new Set(prefs.excludedTypes),
      excludedMonsters: new Set(prefs.excludedMonsters),
      excludedTiers: new Set(prefs.excludedTiers),
    }),
    [prefs],
  );

  const plan = useMemo(
    () => buildPlan(planned, filters, caFile?.totalPoints ?? 0),
    [planned, filters, caFile],
  );

  const tierGroups = useMemo(
    () => (prefs.grouped ? groupPlan(plan) : []),
    [prefs.grouped, plan],
  );

  const allTypes = useMemo(
    () => [...new Set(planned.map((t) => t.type))].sort(),
    [planned],
  );
  const allMonsters = useMemo(
    () => [...new Set(planned.map((t) => t.monster))].sort(),
    [planned],
  );
  const outstandingPerMonster = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of planned) {
      if (t.completed) continue;
      m.set(t.monster, (m.get(t.monster) ?? 0) + 1);
    }
    return m;
  }, [planned]);

  // Summary panels reflect the same filters as the plan so the numbers agree.
  const filtered = useMemo(() => filterTasks(planned, filters), [planned, filters]);
  const typeRows = useMemo(
    () => groupByType(filtered).sort((a, b) => b.pointsRemaining - a.pointsRemaining),
    [filtered],
  );
  const monsterRows = useMemo(
    () =>
      groupByMonster(filtered)
        .filter((r) => r.completed < r.total)
        .sort((a, b) => (b.bestRemainingPct ?? -1) - (a.bestRemainingPct ?? -1))
        .slice(0, 12),
    [filtered],
  );

  const possiblePoints = useMemo(() => totalPossiblePoints(rawTasks), [rawTasks]);
  const completedCount = useMemo(
    () => planned.filter((t) => t.completed).length,
    [planned],
  );
  const pointsHistory = useMemo(
    () => (caFile?.history ?? []).map((h) => h.points),
    [caFile],
  );

  const toggle = <T,>(list: T[], value: T): T[] =>
    list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

  if (!index) return null;

  const status = selected?.ca?.status;
  const loading = rsn ? loadingMap[rsn] : false;
  const loadError = rsn ? errorMap[rsn] : undefined;
  const nextTier = plan.nextTier;
  const nextGap = nextTier ? tierGap(plan, nextTier) : null;
  const visibleMonsters = allMonsters.filter((m) =>
    m.toLowerCase().includes(monsterQuery.trim().toLowerCase()),
  );

  return (
    <>
      <div className="panel">
        <div className="ca-head">
          <h2 style={{ margin: 0, border: 0, padding: 0 }}>Combat Achievements</h2>
          <label className="ca-account-picker">
            <span>Account</span>
            <select
              value={selected?.rsn ?? ""}
              onChange={(e) => setPrefs({ ...prefs, rsn: e.target.value })}
            >
              {accounts.map((p) => (
                <option key={p.rsn} value={p.rsn}>
                  {p.rsn}
                  {p.ca?.status === "ok" ? ` — ${p.ca.totalPoints} pts` : " — not linked"}
                </option>
              ))}
            </select>
          </label>
          {selected && <AccountBadge type={selected.type} showLabel />}
          <span className="spacer" />
          <span className="ca-updated">
            RuneProfile data as of {fmtWhen(selected?.ca?.updatedAt)}
          </span>
        </div>
        <p style={{ marginBottom: 0, color: "var(--text-dim)", fontSize: "0.9rem" }}>
          Your outstanding tasks, ordered by how many players have already done
          them — the top of the list is the cheapest path to your next reward
          tier. Filters and the selected account are saved to this browser.
        </p>
      </div>

      {!selected?.ca && (
        <div className="panel">
          <div className="empty">
            No Combat Achievement data captured for this account yet. It will
            appear after the next hourly snapshot run.
          </div>
        </div>
      )}

      {status === "unlinked" && selected && <NotLinked rsn={selected.rsn} />}

      {status === "error" && (
        <div className="error">
          RuneProfile lookup failed for {selected?.rsn}: {selected?.ca?.error}
        </div>
      )}

      {status === "ok" && loadError && (
        <div className="error">Failed to load Combat Achievement data: {loadError}</div>
      )}
      {status === "ok" && !caFile && loading && <div className="empty">Loading tasks…</div>}

      {status === "ok" && caFile && (
        <>
          {missingData.length > 0 && (
            <div className="ca-warning">
              <strong>⚠ {missingData.length} task(s) missing completion data.</strong>{" "}
              RuneProfile is reporting tasks that aren't in
              <code> data/combat-achievements.csv</code>, so they're ranked at
              the bottom of the plan. Update the CSV and re-run
              <code> npm run ca:completion</code> to fix the ordering.
              <div className="ca-warning-list">
                {missingData.slice(0, 15).map((t) => (
                  <span key={t.name}>{t.name}</span>
                ))}
                {missingData.length > 15 && <span>+{missingData.length - 15} more</span>}
              </div>
            </div>
          )}

          <div className="kpis ca-kpis">
            <div className="kpi">
              <div className="label">Total points</div>
              <div className="value">
                {caFile.totalPoints}
                <span className="ca-kpi-sub"> / {possiblePoints}</span>
              </div>
              <Bar value={caFile.totalPoints} max={possiblePoints} />
              {pointsHistory.length > 1 && (
                <Sparkline values={pointsHistory} color="var(--accent)" />
              )}
            </div>
            <div className="kpi">
              <div className="label">Tier reached</div>
              <div className="value ca-kpi-tier">
                {caFile.tierReached ? (
                  <>
                    <CaTierIcon tier={caFile.tierReached} size={22} />
                    {caFile.tierReached}
                  </>
                ) : (
                  "None"
                )}
              </div>
              <div className="ca-kpi-note">
                {completedCount}/{rawTasks.length} tasks complete
              </div>
            </div>
            <div className="kpi">
              <div className="label">Next reward tier</div>
              {nextTier && nextGap && nextGap.points > 0 ? (
                <>
                  <div className="value ca-kpi-tier">
                    <CaTierIcon tier={nextTier} size={22} />
                    {nextTier.name}
                  </div>
                  <div className="ca-kpi-note">
                    {nextGap.points} pts to go
                    {nextGap.tasks !== null
                      ? ` — ${nextGap.tasks} task(s) from this plan`
                      : " — unreachable with current filters"}
                  </div>
                  <Bar value={caFile.totalPoints} max={nextTier.threshold} />
                </>
              ) : (
                <div className="value">All unlocked 🎉</div>
              )}
            </div>
            <div className="kpi">
              <div className="label">Plan size</div>
              <div className="value">{plan.tasks.length}</div>
              <div className="ca-kpi-note">
                tasks left after filters, worth{" "}
                {plan.maxPlanPoints - plan.startingPoints} pts
              </div>
            </div>
          </div>

          <div className="panel">
            <h2>Reward tiers</h2>
            <div className="ca-scroll">
            <table>
              <thead>
                <tr>
                  <th>Tier</th>
                  <th className="num">Threshold</th>
                  <th className="num">Tasks done</th>
                  <th style={{ width: "22%" }}>Tier task progress</th>
                  <th className="num">Pts from tier</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {CA_TIERS.map((tier) => {
                  const summary = caFile.tiers.find((t) => t.id === tier.id);
                  const gap = tierGap(plan, tier);
                  const unlocked = gap.points === 0;
                  return (
                    <tr key={tier.id}>
                      <td>
                        <CaTierIcon tier={tier} size={20} />{" "}
                        <strong>{tier.name}</strong>{" "}
                        <span className="ca-dim">({tier.points} pt/task)</span>
                      </td>
                      <td className="num">{tier.threshold}</td>
                      <td className="num">
                        {summary ? `${summary.completed}/${summary.total}` : "—"}
                      </td>
                      <td>
                        <Bar value={summary?.completed ?? 0} max={summary?.total ?? 1} />
                      </td>
                      <td className="num">
                        {summary ? summary.completed * tier.points : 0}
                      </td>
                      <td className={unlocked ? "ca-good" : ""}>
                        {unlocked
                          ? "Unlocked"
                          : gap.tasks !== null
                            ? `${gap.points} pts (${gap.tasks} tasks)`
                            : `${gap.points} pts — filtered out of reach`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
          </div>

          <div className="ca-two-col">
            <GroupTable
              title="By task type"
              rows={typeRows}
              labelHeader="Type"
              emptyText="No tasks match the current filters."
            />
            <GroupTable
              title="Easiest monsters to chip away at"
              rows={monsterRows}
              labelHeader="Monster"
              emptyText="Nothing outstanding — or everything is filtered out."
            />
          </div>

          <div className="panel">
            <div className="ca-head">
              <h2 style={{ margin: 0, border: 0, padding: 0 }}>Filters</h2>
              <span className="ca-dim">
                {prefs.excludedTypes.length + prefs.excludedMonsters.length + prefs.excludedTiers.length}{" "}
                exclusion(s) active
              </span>
              <span className="spacer" />
              <button className="btn small" onClick={() => setShowFilters((v) => !v)}>
                {showFilters ? "Hide" : "Show"} filters
              </button>
              <button
                className="btn small"
                onClick={() =>
                  setPrefs({ ...prefs, excludedTypes: [], excludedMonsters: [], excludedTiers: [] })
                }
              >
                Clear all
              </button>
            </div>

            {showFilters && (
              <>
                <div className="ca-filter-group">
                  <div className="ca-filter-label">Task types</div>
                  <div className="range-bar">
                    {allTypes.map((t) => (
                      <button
                        key={t}
                        className={prefs.excludedTypes.includes(t) ? "" : "active"}
                        onClick={() =>
                          setPrefs({ ...prefs, excludedTypes: toggle(prefs.excludedTypes, t) })
                        }
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="ca-filter-group">
                  <div className="ca-filter-label">Task difficulty</div>
                  <div className="range-bar">
                    {CA_TIERS.map((tier) => (
                      <button
                        key={tier.id}
                        className={prefs.excludedTiers.includes(tier.id) ? "" : "active"}
                        onClick={() =>
                          setPrefs({ ...prefs, excludedTiers: toggle(prefs.excludedTiers, tier.id) })
                        }
                        style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem" }}
                      >
                        <CaTierIcon tier={tier} size={14} />
                        {tier.name}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="ca-filter-group">
                  <div className="ca-filter-label">
                    Monsters ({allMonsters.length - prefs.excludedMonsters.length}/
                    {allMonsters.length} shown)
                  </div>
                  <div className="ca-monster-tools">
                    <input
                      type="text"
                      placeholder="Search monsters…"
                      value={monsterQuery}
                      onChange={(e) => setMonsterQuery(e.target.value)}
                    />
                    <button
                      className="btn small"
                      onClick={() =>
                        setPrefs({
                          ...prefs,
                          excludedMonsters: prefs.excludedMonsters.filter(
                            (m) => !visibleMonsters.includes(m),
                          ),
                        })
                      }
                    >
                      Include shown
                    </button>
                    <button
                      className="btn small"
                      onClick={() =>
                        setPrefs({
                          ...prefs,
                          excludedMonsters: [
                            ...new Set([...prefs.excludedMonsters, ...visibleMonsters]),
                          ],
                        })
                      }
                    >
                      Exclude shown
                    </button>
                  </div>
                  <div className="ca-monster-grid">
                    {visibleMonsters.map((m) => {
                      const excluded = prefs.excludedMonsters.includes(m);
                      const left = outstandingPerMonster.get(m) ?? 0;
                      return (
                        <label key={m} className={`ca-monster${excluded ? " excluded" : ""}`}>
                          <input
                            type="checkbox"
                            checked={!excluded}
                            onChange={() =>
                              setPrefs({
                                ...prefs,
                                excludedMonsters: toggle(prefs.excludedMonsters, m),
                              })
                            }
                          />
                          <span className="ca-monster-name">{m}</span>
                          <span className="ca-dim">{left}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
          </div>

          <div className="panel">
            <div className="ca-head">
              <h2 style={{ margin: 0, border: 0, padding: 0 }}>
                To-do list — easiest first
              </h2>
              <span className="spacer" />
              {prefs.grouped && (
                <>
                  <button
                    className="btn small"
                    onClick={() => {
                      setCollapsedTiers(new Set());
                      setExpandedMonsters(
                        new Set(
                          tierGroups.flatMap((g) =>
                            g.monsters.map((m) => `${g.id}|${m.monster}`),
                          ),
                        ),
                      );
                    }}
                  >
                    Expand all
                  </button>
                  <button
                    className="btn small"
                    onClick={() => {
                      setCollapsedTiers(new Set(tierGroups.map((g) => g.id)));
                      setExpandedMonsters(new Set());
                    }}
                  >
                    Collapse all
                  </button>
                </>
              )}
              <div className="range-bar" title="Group the list by reward tier, then monster">
                <button
                  className={prefs.grouped ? "" : "active"}
                  onClick={() => setPrefs({ ...prefs, grouped: false })}
                >
                  Flat
                </button>
                <button
                  className={prefs.grouped ? "active" : ""}
                  onClick={() => setPrefs({ ...prefs, grouped: true })}
                >
                  Smart grouping
                </button>
              </div>
            </div>
            {plan.rows.length === 0 ? (
              <div className="empty">
                Nothing outstanding with these filters. Loosen them or go enjoy your cape.
              </div>
            ) : (
              <div className="ca-scroll">
              <table className="ca-plan">
                <thead>
                  <tr>
                    <th className="num">#</th>
                    <th>Task</th>
                    <th>Monster</th>
                    <th>Type</th>
                    <th>Tier</th>
                    <th className="num">Pts</th>
                    <th className="num" title="Share of players who have completed this task">
                      Comp %
                    </th>
                    <th className="num" title="Your points total after completing this task">
                      Cumulative
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {prefs.grouped
                    ? tierGroups.map((group) => (
                        <TierGroupRows
                          key={group.id}
                          group={group}
                          collapsed={collapsedTiers.has(group.id)}
                          onToggleTier={() =>
                            setCollapsedTiers((prev) => {
                              const next = new Set(prev);
                              if (next.has(group.id)) next.delete(group.id);
                              else next.add(group.id);
                              return next;
                            })
                          }
                          expandedMonsters={expandedMonsters}
                          onToggleMonster={(key) =>
                            setExpandedMonsters((prev) => {
                              const next = new Set(prev);
                              if (next.has(key)) next.delete(key);
                              else next.add(key);
                              return next;
                            })
                          }
                        />
                      ))
                    : plan.rows.map((row) =>
                        row.kind === "goal" ? (
                          <tr
                            key={row.id}
                            className={`ca-goal-row${row.reachable ? "" : " unreachable"}`}
                          >
                            <td colSpan={8}>
                              <CaTierIcon tier={row.tier} size={22} />
                              <strong>
                                {row.reachable ? "Unlocks" : "Still short of"} {row.tier.name} rewards
                              </strong>
                              <span className="ca-dim"> — {row.tier.threshold} pts</span>
                              {row.reachable ? (
                                <span className="ca-goal-meta">
                                  after {row.tasksNeeded} task{row.tasksNeeded === 1 ? "" : "s"}
                                </span>
                              ) : (
                                <span className="ca-goal-meta">
                                  {row.shortfall} pts short with the current filters
                                </span>
                              )}
                            </td>
                          </tr>
                        ) : (
                          <TaskRow key={row.id} order={row.order} task={row.task} cumulative={row.cumulativePoints} />
                        ),
                      )}
                </tbody>
              </table>
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}

function TierGroupRows({
  group,
  collapsed,
  onToggleTier,
  expandedMonsters,
  onToggleMonster,
}: {
  group: TierGroup;
  collapsed: boolean;
  onToggleTier: () => void;
  expandedMonsters: ReadonlySet<string>;
  onToggleMonster: (key: string) => void;
}) {
  const { tier } = group;
  return (
    <>
      <tr
        className={`ca-goal-row ca-group-row${group.reachable ? "" : " unreachable"}`}
        onClick={onToggleTier}
      >
        <td colSpan={8}>
          <span className="ca-caret">{collapsed ? "▸" : "▾"}</span>
          {tier ? <CaTierIcon tier={tier} size={22} /> : null}
          <strong>
            {tier
              ? group.reachable
                ? `Path to ${tier.name} rewards`
                : `Still short of ${tier.name} rewards`
              : "Everything else"}
          </strong>
          {tier && <span className="ca-dim"> — {tier.threshold} pts</span>}
          <span className="ca-goal-meta">
            {group.taskCount} task{group.taskCount === 1 ? "" : "s"} · {group.points} pts ·{" "}
            {group.monsters.length} monster{group.monsters.length === 1 ? "" : "s"}
            {group.reachable
              ? ` · ${group.endPoints} pts after`
              : ` · ${group.shortfall} pts short with the current filters`}
          </span>
        </td>
      </tr>
      {!collapsed &&
        group.monsters.map((m) => (
          <MonsterGroupRows
            key={`${group.id}|${m.monster}`}
            group={m}
            expanded={expandedMonsters.has(`${group.id}|${m.monster}`)}
            onToggle={() => onToggleMonster(`${group.id}|${m.monster}`)}
          />
        ))}
    </>
  );
}

function MonsterGroupRows({
  group,
  expanded,
  onToggle,
}: {
  group: MonsterGroup;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr className="ca-monster-row" onClick={onToggle}>
        <td colSpan={5}>
          <span className="ca-caret">{expanded ? "▾" : "▸"}</span>
          <strong>{group.monster}</strong>
          <span className="ca-goal-meta">
            {group.tasks.length} task{group.tasks.length === 1 ? "" : "s"} · easiest{" "}
            {fmtPct(group.easiestPct)} · hardest {fmtPct(group.hardestPct)}
          </span>
        </td>
        <td className="num">{group.points}</td>
        <td className="num ca-dim">{fmtPct(group.hardestPct)}</td>
        <td className="num">{group.tasks.at(-1)?.cumulativePoints ?? ""}</td>
      </tr>
      {expanded &&
        group.tasks.map(({ task, cumulativePoints, order }) => (
          <TaskRow
            key={task.name}
            order={order}
            task={task}
            cumulative={cumulativePoints}
            nested
          />
        ))}
    </>
  );
}

function TaskRow({
  order,
  task,
  cumulative,
  nested = false,
}: {
  order: number;
  task: PlannedTask;
  cumulative: number;
  nested?: boolean;
}) {
  const tier = tierById(task.tierId);
  return (
    <tr className={`${task.missingData ? "ca-missing" : ""}${nested ? " ca-nested" : ""}`}>
      <td className="num ca-dim">{order}</td>
      <td className="ca-task-cell">
        <a href={wikiUrl(task.name)} target="_blank" rel="noreferrer">
          🔗 {task.name}
        </a>
        <div className="ca-task-desc" title={task.description}>
          {task.description}
        </div>
      </td>
      <td>{task.monster}</td>
      <td>{task.type}</td>
      <td>
        {tier ? <CaTierIcon tier={tier} size={16} /> : null} {task.tierName}
      </td>
      <td className="num">{task.points}</td>
      <td className="num" title={task.missingData ? "No completion data — ranked last" : undefined}>
        {task.missingData ? "?" : fmtPct(task.pct)}
      </td>
      <td className="num">{cumulative}</td>
    </tr>
  );
}
