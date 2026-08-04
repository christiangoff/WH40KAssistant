import getDb from "./db";

export interface BattleSize {
  id: number;
  name: string;
  points: number;
  dp_budget: number;
  enhancement_limit: number;
}

/**
 * Resolves the DP budget / enhancement limit for a given army points total.
 * Picks the largest seeded battle size whose points threshold is <= pointLimit,
 * falling back to the smallest seeded size for anything below that.
 */
export function resolveBattleSize(pointLimit: number): BattleSize | null {
  const db = getDb();
  const sizes = db.prepare("SELECT * FROM battle_sizes ORDER BY points ASC").all() as BattleSize[];
  if (sizes.length === 0) return null;
  const eligible = sizes.filter((s) => s.points <= pointLimit);
  return eligible.length > 0 ? eligible[eligible.length - 1] : sizes[0];
}
