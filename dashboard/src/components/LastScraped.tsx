/**
 * Small nav indicator showing when the scraper last ran (sourced from
 * `index.generatedAt`, which is committed by the hourly snapshot workflow).
 *
 * The visible label is a compact "n min ago" so it stays out of the way; the
 * mouse-over tooltip exposes the absolute time in three zones to aid bug
 * reports / diagnosis from user screenshots:
 *
 *   - the viewer's local time (with the local timezone abbreviation),
 *   - UTC (the timezone the data is actually stored in),
 *   - Australian Eastern time (AEST/AEDT — auto-selected via the IANA
 *     Australia/Sydney zone, since most users are Australian).
 */

function formatInZone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-AU", {
    timeZone,
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZoneName: "short",
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const day = get("day");
  const month = get("month");
  const year = get("year");
  const hour = get("hour");
  const minute = get("minute");
  const tz = get("timeZoneName");
  return `${day} ${month} ${year}, ${hour}:${minute} ${tz}`;
}

function formatRelative(ms: number): string {
  const sec = Math.round(ms / 1000);
  if (sec < 60) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const day = Math.round(hr / 24);
  return `${day} day${day === 1 ? "" : "s"} ago`;
}

export function LastScraped({ generatedAt }: { generatedAt: string }) {
  const ts = Date.parse(generatedAt);
  if (Number.isNaN(ts)) return null;
  const date = new Date(ts);
  const relative = formatRelative(Date.now() - ts);
  const local = formatInZone(date, Intl.DateTimeFormat().resolvedOptions().timeZone);
  const utc = formatInZone(date, "UTC");
  const sydney = formatInZone(date, "Australia/Sydney");
  const title =
    `Last scraped\n` +
    `Local:  ${local}\n` +
    `UTC:    ${utc}\n` +
    `Sydney: ${sydney}`;
  return (
    <div className="last-scraped" title={title}>
      <span className="last-scraped-label">Scraped</span>{" "}
      <time dateTime={generatedAt}>{relative}</time>
    </div>
  );
}
