import type Database from "better-sqlite3";
import { scrapeWahapediaUnit } from "@/lib/wahapedia";
import type { UnitStats } from "@/lib/wahapedia";
import { findMFMUnitPoints, selectPrimaryMFMTier } from "@/lib/mfm";

// Scrape a unit's Wahapedia page and layer Munitorum Field Manual pricing on top.
// Shared by the per-unit refresh route and the admin "refresh every user's units"
// route so both stay in lockstep.
export async function buildUnitStats(wahapediaUrl: string): Promise<UnitStats> {
  const stats = await scrapeWahapediaUnit(wahapediaUrl);

  // MFM points are best-effort — a failure here (site down, no match) leaves the
  // Wahapedia-scraped points_table / points_per_model in place.
  try {
    const mfmData = await findMFMUnitPoints(stats.name, stats.faction);
    if (mfmData?.wargear.length) stats.mfm_wargear = mfmData.wargear;
    if (mfmData && mfmData.tiers.length > 0) {
      stats.mfm_tiers = mfmData.tiers;
      const primaryTier = selectPrimaryMFMTier(mfmData.tiers);
      if (primaryTier.entries.length > 0) {
        stats.points_table = primaryTier.entries;
        const sorted = [...primaryTier.entries].sort((a, b) => a.models - b.models);
        stats.points_per_model = Math.round(sorted[0].points / sorted[0].models);
      }
    }
  } catch {
    // non-fatal
  }

  return stats;
}

export function persistUnitStats(
  db: Database.Database,
  unitId: number,
  fallbackName: string | null | undefined,
  stats: UnitStats
): void {
  db.prepare(
    "UPDATE units SET stats_json = ?, stats_fetched_at = ?, name = ?, faction = ? WHERE id = ?"
  ).run(
    JSON.stringify(stats),
    Date.now(),
    stats.name || fallbackName || "Unknown",
    stats.faction ?? null,
    unitId
  );
}
