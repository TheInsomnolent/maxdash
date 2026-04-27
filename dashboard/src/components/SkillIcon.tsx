import type { CSSProperties } from "react";

const BASE = `${import.meta.env.BASE_URL}images/skills/`;

/** Wiki filename for each skill (PascalCase + `_icon.png`). */
function fileFor(skill: string): string {
  if (skill === "Overall") return "Stats_icon.png";
  return `${skill}_icon.png`;
}

export function SkillIcon({
  name,
  size = 18,
  style,
}: {
  name: string;
  size?: number;
  style?: CSSProperties;
}) {
  return (
    <img
      src={BASE + fileFor(name)}
      alt={name}
      title={name}
      width={size}
      height={size}
      style={{
        verticalAlign: "middle",
        imageRendering: "pixelated",
        ...style,
      }}
      loading="lazy"
    />
  );
}
