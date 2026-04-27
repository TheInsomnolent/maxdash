import { useState } from "react";

const BASE = `${import.meta.env.BASE_URL}images/`;
const DEFAULT_SRC = `${BASE}Default.png`;

export function playerImageUrl(rsn: string): string {
  return `${BASE}${encodeURIComponent(rsn)}.png`;
}

interface Props {
  rsn: string;
  size?: number;
  className?: string;
  title?: string;
}

/**
 * Square headshot for a player. Looks up `/images/<rsn>.png`; on 404 falls
 * back to `/images/Default.png`. Bordered with the player's race color.
 */
export function PlayerImage({ rsn, size = 32, className, title }: Props) {
  const [src, setSrc] = useState<string>(playerImageUrl(rsn));
  return (
    <img
      src={src}
      alt={rsn}
      title={title ?? rsn}
      width={size}
      height={size}
      className={"player-img" + (className ? ` ${className}` : "")}
      onError={() => {
        if (src !== DEFAULT_SRC) setSrc(DEFAULT_SRC);
      }}
      style={{ width: size, height: size }}
    />
  );
}
