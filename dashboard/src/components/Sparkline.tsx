/**
 * Tiny inline-SVG sparkline. Designed for "vibes" — no axes, no labels.
 * Uses a fixed 2:1 viewBox and scales to its container's width via CSS.
 * Renders an empty box (preserving layout) when fewer than 2 finite points.
 */
export function Sparkline({
  values,
  color,
  strokeWidth = 2,
}: {
  values: ReadonlyArray<number>;
  color: string;
  strokeWidth?: number;
}) {
  const VBW = 200;
  const VBH = 100;
  const svgProps = {
    viewBox: `0 0 ${VBW} ${VBH}`,
    preserveAspectRatio: "none" as const,
    style: {
      display: "block",
      width: "100%",
      height: "auto",
      aspectRatio: "2 / 1",
      overflow: "visible" as const,
    },
    "aria-hidden": true,
  };

  const pts = values.filter((v) => Number.isFinite(v) && v >= 0);
  if (pts.length < 2) return <svg {...svgProps} />;

  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const span = max - min || 1;
  const pad = strokeWidth;
  const w = VBW - pad * 2;
  const h = VBH - pad * 2;
  const stepX = w / (pts.length - 1);

  const coords = pts.map((v, i) => {
    const x = pad + i * stepX;
    const y = pad + h - ((v - min) / span) * h;
    return [x, y] as const;
  });
  const d = coords
    .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`)
    .join(" ");
  const area = `${d} L${coords[coords.length - 1][0].toFixed(1)},${(pad + h).toFixed(1)} L${coords[0][0].toFixed(1)},${(pad + h).toFixed(1)} Z`;

  return (
    <svg {...svgProps}>
      <path d={area} fill={color} fillOpacity={0.18} />
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

