import type Database from "better-sqlite3";
import { selectMFMTier, getPointsFromTier } from "@/lib/mfm";
import type { MFMPricingTier } from "@/lib/mfm";

// Shared by /api/armies (owner's list) and /api/armies/shared (armies shared with you)
export function computeArmyTotals(db: Database.Database, armyId: number): { unit_count: number; total_points: number } {
  const units = db.prepare(`
    SELECT au.unit_id, au.model_count, au.custom_points, u.stats_json
    FROM army_units au JOIN units u ON u.id = au.unit_id
    WHERE au.army_id = ? ORDER BY au.id ASC
  `).all(armyId) as Array<{ unit_id: number; model_count: number; custom_points: number | null; stats_json: string | null }>;

  // Track how many of each unit_id we've seen to compute copy index (for MFM tier pricing)
  const copyCount: Record<number, number> = {};
  const totalPoints = units.reduce((sum, u) => {
    if (u.custom_points !== null) return sum + u.custom_points;
    const stats = u.stats_json ? JSON.parse(u.stats_json) : null;
    if (!stats) return sum;
    const copyIndex = copyCount[u.unit_id] ?? 0;
    copyCount[u.unit_id] = copyIndex + 1;
    if (Array.isArray(stats.mfm_tiers) && (stats.mfm_tiers as MFMPricingTier[]).length > 0) {
      const tier = selectMFMTier(stats.mfm_tiers as MFMPricingTier[], copyIndex);
      return sum + getPointsFromTier(tier, u.model_count);
    }
    const table = stats.points_table as Array<{ models: number; points: number }> | null;
    if (table && table.length > 0) {
      const sorted = [...table].sort((a, b) => a.models - b.models);
      const match = [...sorted].filter((e) => e.models <= u.model_count);
      return sum + (match.length > 0 ? match[match.length - 1].points : sorted[0].points);
    }
    return sum + ((stats.points_per_model || 0) * u.model_count);
  }, 0);

  return { unit_count: units.length, total_points: totalPoints };
}
