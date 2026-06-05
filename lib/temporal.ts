export type TemporalLayer = 1 | 2 | 3;

export type TemporalAccess = {
  archiveCutoff: string | null;
  archiveLabel: string;
};

export function getTemporalAccess(
  role: string,
  trustTier: string,
): TemporalAccess {
  if (role === "admin") {
    return {
      archiveCutoff: null,
      archiveLabel: "Unlimited archive access",
    };
  }

  if (trustTier === "VERIFIED") {
    const d = new Date();
    d.setMonth(d.getMonth() - 3);
    return {
      archiveCutoff: d.toISOString().split("T")[0],
      archiveLabel: "3 months archive",
    };
  }

  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return {
    archiveCutoff: d.toISOString().split("T")[0],
    archiveLabel: "1 month archive",
  };
}

export function classifyTemporalLayer(isoDate: string | null): TemporalLayer {
  if (!isoDate) return 2;
  const now = new Date();
  const date = new Date(isoDate);
  const diffMs = now.getTime() - date.getTime();
  const diffDays = diffMs / 86_400_000;

  if (diffDays <= 0) return 1;
  if (diffDays <= 7) return 2;
  return 3;
}

export function oneWeekAgoCutoff(): string {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  return d.toISOString().split("T")[0];
}
