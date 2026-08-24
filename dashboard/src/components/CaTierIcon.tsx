import type { CSSProperties } from "react";
import { tierIconUrl, type CaTierDef } from "../ca";

/** Combat Achievement tier badge (Easy → Grandmaster). */
export function CaTierIcon({
  tier,
  size = 18,
  style,
}: {
  tier: CaTierDef | string;
  size?: number;
  style?: CSSProperties;
}) {
  const label = typeof tier === "string" ? tier : tier.name;
  return (
    <img
      src={tierIconUrl(tier)}
      alt={label}
      title={label}
      height={size}
      style={{
        verticalAlign: "middle",
        imageRendering: "pixelated",
        width: "auto",
        ...style,
      }}
      loading="lazy"
    />
  );
}
