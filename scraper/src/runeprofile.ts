const BASE = "https://api.runeprofile.com/v1/accounts";
const UA = "maxdash/0.1 (github.com/TheInsomnolent/maxdash)";

export interface CaTierSummary {
  id: number;
  name: string;
  completed: number;
  total: number;
}

export interface CaTask {
  index: number;
  tierId: number;
  tierName: string;
  name: string;
  description: string;
  type: string;
  monster: string;
  completed: boolean;
}

export interface RuneProfileCa {
  tiers: CaTierSummary[];
  tasks: CaTask[];
  totalPoints: number;
  tierReached: string | null;
}

/**
 * Thrown for any non-OK RuneProfile response. `notFound` is true when the
 * account simply isn't linked to RuneProfile yet (the plugin has never
 * uploaded a profile), which is an expected, non-fatal state.
 */
export class RuneProfileError extends Error {
  constructor(
    public readonly rsn: string,
    public readonly status: number,
    public readonly code: string | null,
    message: string,
  ) {
    super(message);
  }

  get notFound(): boolean {
    return this.status === 404 || this.code === "NOT_FOUND";
  }
}

async function get<T>(rsn: string, suffix: string): Promise<T> {
  const url = `${BASE}/${encodeURIComponent(rsn)}/combat-achievements${suffix}`;
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) {
    let code: string | null = null;
    let message = `RuneProfile returned ${res.status} for "${rsn}"`;
    try {
      const body = (await res.json()) as { error?: string; code?: string };
      if (body?.code) code = body.code;
      if (body?.error) message = `${body.error} (${res.status})`;
    } catch {
      // Non-JSON error body — keep the generic message.
    }
    throw new RuneProfileError(rsn, res.status, code, message);
  }
  return (await res.json()) as T;
}

/** Fetch a player's Combat Achievement tier summary + full task list. */
export async function fetchCombatAchievements(
  rsn: string,
): Promise<RuneProfileCa> {
  const tiers = await get<{ data: CaTierSummary[] }>(rsn, "");
  const tasks = await get<{
    totalPoints: number;
    tierReached: string | null;
    data: CaTask[];
  }>(rsn, "/tasks");
  return {
    tiers: tiers.data ?? [],
    tasks: tasks.data ?? [],
    totalPoints: tasks.totalPoints ?? 0,
    tierReached: tasks.tierReached ?? null,
  };
}
