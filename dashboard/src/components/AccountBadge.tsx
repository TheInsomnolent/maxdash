export type AccountType = "main" | "ironman" | "gim";

const BADGE_URL: Record<AccountType, string> = {
  main: `${import.meta.env.BASE_URL}images/badges/main.png`,
  ironman: `${import.meta.env.BASE_URL}images/badges/ironman.png`,
  gim: `${import.meta.env.BASE_URL}images/badges/gim.png`,
};

const BADGE_LABEL: Record<AccountType, string> = {
  main: "Main",
  ironman: "Ironman",
  gim: "Group Ironman",
};

export function AccountBadge({
  type,
  size = 16,
  showLabel = false,
}: {
  type: AccountType;
  size?: number;
  showLabel?: boolean;
}) {
  const label = BADGE_LABEL[type];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.3rem",
        verticalAlign: "middle",
      }}
      title={label}
    >
      <img
        src={BADGE_URL[type]}
        alt={label}
        width={size}
        height={size}
        style={{
          verticalAlign: "middle",
          imageRendering: "pixelated",
          objectFit: "contain",
        }}
      />
      {showLabel && <span style={{ fontSize: "0.85rem" }}>{label}</span>}
    </span>
  );
}

export const ACCOUNT_TYPES: AccountType[] = ["main", "ironman", "gim"];
export { BADGE_LABEL };
