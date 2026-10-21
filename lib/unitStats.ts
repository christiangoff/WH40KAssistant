import type Database from "better-sqlite3";
import { scrapeWahapediaUnit } from "@/lib/wahapedia";
import type { UnitStats } from "@/lib/wahapedia";
import { findMFMUnitPoints, selectPrimaryMFMTier } from "@/lib/mfm";
import { normalizeWahapediaUrl } from "@/lib/text";
import { loadCatalogIndex, resolveDatasheet, type DatasheetResolution } from "@/lib/catalog";

// Scrape a unit's Wahapedia page and layer Munitorum Field Manual pricing on top.
// Shared by the per-unit refresh route and the admin "refresh every user's units"
// route so both stay in lockstep.
export async function buildUnitStats(wahapediaUrl: string): Promise<UnitStats> {
  // Always scrape the 11th-edition page: MFM points below are 11th edition, so an
  // old wh40k10ed link would otherwise refresh the points but not the datasheet.
  const stats = await scrapeWahapediaUnit(normalizeWahapediaUrl(wahapediaUrl));

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

// Saves scraped stats along with the page they came from (datasheet_url) and
// that datasheet's catalog fingerprint at the time (datasheet_hash). The unit's
// link is updated to that page too, so a moved datasheet's new address sticks.
export function persistUnitStats(
  db: Database.Database,
  unitId: number,
  fallbackName: string | null | undefined,
  stats: UnitStats,
  datasheetUrl: string,
  datasheetHash: string | null
): void {
  db.prepare(
    "UPDATE units SET stats_json = ?, stats_fetched_at = ?, name = ?, faction = ?, wahapedia_url = ?, datasheet_url = ?, datasheet_hash = ? WHERE id = ?"
  ).run(
    JSON.stringify(stats),
    Date.now(),
    stats.name || fallbackName || "Unknown",
    stats.faction ?? null,
    datasheetUrl,
    datasheetUrl,
    datasheetHash,
    unitId
  );
}

// Resolve a unit's link against the current-datasheet catalog, then scrape and
// save. A retired datasheet is still re-scraped (it's the best data there is
// until the user picks a replacement) — the collection page flags it.
export async function refreshUnitDatasheet(
  db: Database.Database,
  unit: { id: number; name?: string | null; wahapedia_url: string },
  index?: ReturnType<typeof loadCatalogIndex>,
  scrape: (url: string) => Promise<UnitStats> = buildUnitStats
): Promise<DatasheetResolution> {
  const resolution = resolveDatasheet(index ?? loadCatalogIndex(db), unit.wahapedia_url, unit.name ?? null);
  const stats = await scrape(resolution.url);
  persistUnitStats(db, unit.id, unit.name, stats, resolution.url, resolution.contentHash);
  return resolution;
}
