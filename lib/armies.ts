import type Database from "better-sqlite3";
import { resolveUnitPoints } from "@/lib/points";

// Shared by /api/armies (owner's list) and /api/armies/shared (armies shared with you)
export function computeArmyTotals(db: Database.Database, armyId: number): { unit_count: number; total_points: number } {
  const units = db.prepare(`
    SELECT au.unit_id, au.model_count, au.custom_points, au.selected_weapons, e.points AS enhancement_points, u.stats_json
    FROM army_units au JOIN units u ON u.id = au.unit_id
    LEFT JOIN enhancements e ON e.id = au.enhancement_id
    WHERE au.army_id = ? ORDER BY au.id ASC
  `).all(armyId) as Array<{
    unit_id: number;
    model_count: number;
    custom_points: number | null;
    selected_weapons: string | null;
    enhancement_points: number | null;
    stats_json: string | null;
  }>;

  // Track how many of each unit_id we've seen to compute copy index (for MFM tier pricing)
  const copyCount: Record<number, number> = {};
  const totalPoints = units.reduce((sum, u) => {
    const copyIndex = copyCount[u.unit_id] ?? 0;
    copyCount[u.unit_id] = copyIndex + 1;
    const stats = u.stats_json ? JSON.parse(u.stats_json) : null;
    return sum + resolveUnitPoints({
      stats,
      modelCount: u.model_count,
      copyIndex,
      customPoints: u.custom_points,
      selectedWeapons: u.selected_weapons,
      enhancementPoints: u.enhancement_points,
    }).total;
  }, 0);

  return { unit_count: units.length, total_points: totalPoints };
}
