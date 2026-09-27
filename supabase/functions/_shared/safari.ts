export type SafariTarget = {
  scientificName: string;
  label: string;
  foundBy?: string | null;
  foundAt?: string | null;
};
export type SafariRun = {
  id: string;
  title: string;
  mode: "zoo" | "nature";
  code: string;
  hostId: string;
  startedAt: string;
  expiresAt: string;
  status: "active" | "completed" | "ended" | "expired";
  revision: number;
  evidence: string;
  sourceUrl: string;
  radiusKm: number;
  members: { userId: string; name: string; left: boolean }[];
  targets: SafariTarget[];
};
export type SafariOffer = {
  id: string;
  title: string;
  evidence: string;
  sourceUrl: string;
  targets: SafariTarget[];
};
export type SafariSite = {
  id: string;
  name: string;
  country: string;
  inventory_at: string;
  revision_note: string | null;
};

export function coordinates(lat: unknown, lon: unknown): [number, number] {
  if (
    typeof lat !== "number" || typeof lon !== "number" ||
    !Number.isFinite(lat) || !Number.isFinite(lon) ||
    Math.abs(lat) > 90 || Math.abs(lon) > 180
  ) throw new Error("Position invalide.");
  return [lat, lon];
}

export function distanceKm(
  lat: number,
  lon: number,
  lat2: number,
  lon2: number,
) {
  const rad = Math.PI / 180;
  return 12742 *
    Math.asin(Math.sqrt(Math.min(
      1,
      Math.sin((lat2 - lat) * rad / 2) ** 2 +
        Math.cos(lat * rad) * Math.cos(lat2 * rad) *
          Math.sin((lon2 - lon) * rad / 2) ** 2,
    )));
}

export function activityState(run: SafariRun) {
  const found = run.targets.filter((t) => t.foundAt);
  const last =
    [...found].sort((a, b) =>
      String(b.foundAt).localeCompare(String(a.foundAt))
    )[0];
  const author = last &&
    run.members.find((m) => m.userId === last.foundBy)?.name;
  return {
    speciesCount: found.length,
    newSpeciesCount: 0,
    targetCount: run.targets.length,
    nextTarget: run.targets.find((t) => !t.foundAt)?.label ?? "",
    lastSpecies: last ? `${author ?? "Un équipier"} · ${last.label}` : "",
    teamSize: run.members.filter((m) => !m.left).length,
  };
}
