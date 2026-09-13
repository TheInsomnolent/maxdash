/**
 * Scrapes the Combat Achievement task list (including community completion
 * rates) from the OSRS Wiki and emits it as CSV rows.
 *
 * The wiki renders the table via a Lua module, so we ask the MediaWiki parse
 * API for the rendered HTML of `Combat_Achievements/All_tasks` and pull the
 * `ca-tasks` table out of it. Each row carries Monster, Name, Description,
 * Type, Tier and the crowdsourced Comp% — exactly the columns the dashboard's
 * completion table is built from.
 */

const WIKI_API = "https://oldschool.runescape.wiki/api.php";
const PAGE = "Combat_Achievements/All_tasks";
const UA = "maxdash/0.1 (github.com/TheInsomnolent/maxdash)";

export interface CaTask {
  monster: string;
  name: string;
  description: string;
  type: string;
  tier: string;
  comp: string;
}

/** The CSV column order the completion compiler expects. */
export const CA_CSV_HEADER = [
  "Monster",
  "Name",
  "Description",
  "Type",
  "Tier",
  "Comp%",
] as const;

/** Decode the handful of HTML entities the wiki markup uses. */
function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/** Strip HTML tags, decode entities, and collapse whitespace to single spaces. */
function cellText(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, ""))
    .replace(/[\s\u00a0]+/g, " ")
    .trim();
}

/** Extract the `ca-tasks` table's task rows from the rendered page HTML. */
function parseTasks(pageHtml: string): CaTask[] {
  const table = pageHtml.match(
    /<table[^>]*class="[^"]*ca-tasks[^"]*"[^>]*>([\s\S]*?)<\/table>/,
  );
  if (!table) {
    throw new Error("ca-wiki: could not find the ca-tasks table in the wiki HTML");
  }

  const tasks: CaTask[] = [];
  const rowRe = /<tr\b[^>]*data-ca-task-id[^>]*>([\s\S]*?)<\/tr>/g;
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowRe.exec(table[1])) !== null) {
    const cells: string[] = [];
    const cellRe = /<td\b[^>]*>([\s\S]*?)<\/td>/g;
    let cellMatch: RegExpExecArray | null;
    while ((cellMatch = cellRe.exec(rowMatch[1])) !== null) {
      cells.push(cellText(cellMatch[1]));
    }
    if (cells.length < 6) continue;
    tasks.push({
      monster: cells[0],
      name: cells[1],
      description: cells[2],
      type: cells[3],
      tier: cells[4],
      comp: cells[5],
    });
  }

  if (tasks.length === 0) {
    throw new Error("ca-wiki: parsed the ca-tasks table but found no task rows");
  }
  return tasks;
}

/** Fetch and parse the full Combat Achievement task list from the wiki. */
export async function scrapeCaTasks(): Promise<CaTask[]> {
  const params = new URLSearchParams({
    action: "parse",
    page: PAGE,
    prop: "text",
    formatversion: "2",
    format: "json",
  });
  const res = await fetch(`${WIKI_API}?${params.toString()}`, {
    headers: { "User-Agent": UA },
  });
  if (!res.ok) {
    throw new Error(`ca-wiki: wiki API returned ${res.status} ${res.statusText}`);
  }
  const body = (await res.json()) as { parse?: { text?: string }; error?: unknown };
  const html = body.parse?.text;
  if (typeof html !== "string") {
    throw new Error("ca-wiki: unexpected wiki API response (no parsed HTML)");
  }
  return parseTasks(html);
}

/** Escape a single field for RFC-4180 CSV output (always quoted). */
function csvField(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

/** Render the scraped tasks as a CSV string matching the committed format. */
export function tasksToCsv(tasks: CaTask[]): string {
  const rows = [CA_CSV_HEADER.map(csvField).join(",")];
  for (const t of tasks) {
    rows.push(
      [t.monster, t.name, t.description, t.type, t.tier, t.comp]
        .map(csvField)
        .join(","),
    );
  }
  return rows.join("\n") + "\n";
}
