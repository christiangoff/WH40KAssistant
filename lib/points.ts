import type { UnitStats } from "./wahapedia";
import { selectMFMTier, getPointsFromTier } from "./mfm";

// Single source of truth for "how many points is this army unit worth".
// Pure + client-safe — used by the army builder, the army-list totals
// (lib/armies.ts), the export view, and the export API.

export interface UnitPointsInput {
  stats: UnitStats | null;
  modelCount: number;
  /** 0-based index of this unit among army units sharing the same unit_id (for MFM per-copy tiers). */
  copyIndex: number;
  /** User override of the datasheet cost. When set, replaces base + wargear. */
  customPoints?: number | null;
  /** Parsed selection: name→count map, legacy name[] array, or the raw JSON string. */
  selectedWeapons?: Record<string, number> | string[] | string | null;
  /** Points for the enhancement assigned to this unit, if any. */
  enhancementPoints?: number | null;
}

export interface UnitPointsResult {
  /** Datasheet cost (MFM tier / points table / per-model). */
  base: number;
  /** Sum of MFM costed wargear upgrades in the current loadout. */
  wargear: number;
  /** Enhancement cost. */
  enhancement: number;
  /** base + wargear + enhancement, or customPoints + enhancement when overridden. */
  total: number;
  tierLabel: string | null;
  hasTiers: boolean;
}

const normWeapon = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Coerce whatever `selected_weapons` shape we were handed into name→count. */
export function weaponCountMap(
  selected: UnitPointsInput["selectedWeapons"],
  modelCount: number
): Record<string, number> | null {
  if (selected == null) return null;
  let parsed: unknown = selected;
  if (typeof selected === "string") {
    try {
      parsed = JSON.parse(selected);
    } catch {
      return null;
    }
  }
  if (Array.isArray(parsed)) {
    // Legacy: a selected weapon means the whole squad carries it.
    return Object.fromEntries((parsed as string[]).map((n) => [n, modelCount]));
  }
  if (parsed && typeof parsed === "object") return parsed as Record<string, number>;
  return null;
}

/** Total extra points from MFM costed wargear given the current loadout. */
export function wargearCost(
  stats: UnitStats | null,
  counts: Record<string, number> | null
): number {
  const options = stats?.mfm_wargear;
  if (!options?.length || !counts) return 0;
  let total = 0;
  for (const opt of options) {
    const target = normWeapon(opt.weapon);
    // Match the option against selected weapon keys (exact, then prefix either way).
    let count = 0;
    for (const [name, n] of Object.entries(counts)) {
      const key = normWeapon(name);
      if (key === target || key.startsWith(target) || target.startsWith(key)) {
        count = Math.max(count, n || 0);
      }
    }
    total += count * opt.points;
  }
  return total;
}

function baseDatasheetPoints(
  stats: UnitStats,
  modelCount: number,
  copyIndex: number
): { points: number; tierLabel: string | null; hasTiers: boolean } {
  const tiers = stats.mfm_tiers;
  if (Array.isArray(tiers) && tiers.length > 0) {
    const tier = selectMFMTier(tiers, copyIndex);
    return {
      points: getPointsFromTier(tier, modelCount),
      tierLabel: tier.copies,
      hasTiers: tiers.length > 1,
    };
  }
  const table = stats.points_table;
  if (table && table.length > 0) {
    const sorted = [...table].sort((a, b) => a.models - b.models);
    const matching = sorted.filter((e) => e.models <= modelCount);
    const entry = matching.length > 0 ? matching[matching.length - 1] : sorted[0];
    return { points: entry.points, tierLabel: null, hasTiers: false };
  }
  return { points: (stats.points_per_model ?? 0) * modelCount, tierLabel: null, hasTiers: false };
}

/**
 * Rough cost of a single minimum-size squad of this datasheet — for collection
 * estimates, where we know how many squads someone owns but not how they'd be
 * fielded. Prices one squad at its smallest legal size using the MFM tier /
 * points table, falling back to per-model. Multiply by squads owned.
 */
export function estimateSquadPoints(stats: UnitStats | null): number {
  if (!stats) return 0;
  const entries = [
    ...(stats.mfm_tiers?.flatMap((t) => t.entries) ?? []),
    ...(stats.points_table ?? []),
  ].filter((e) => e.models > 0 && e.points > 0);
  if (entries.length === 0) return stats.points_per_model ?? 0;
  const minModels = Math.min(...entries.map((e) => e.models));
  return Math.min(...entries.filter((e) => e.models === minModels).map((e) => e.points));
}

export function resolveUnitPoints(input: UnitPointsInput): UnitPointsResult {
  const enhancement = input.enhancementPoints ?? 0;

  if (input.customPoints != null) {
    return {
      base: input.customPoints,
      wargear: 0,
      enhancement,
      total: input.customPoints + enhancement,
      tierLabel: null,
      hasTiers: false,
    };
  }

  if (!input.stats) {
    return { base: 0, wargear: 0, enhancement, total: enhancement, tierLabel: null, hasTiers: false };
  }

  const { points: base, tierLabel, hasTiers } = baseDatasheetPoints(
    input.stats,
    input.modelCount,
    input.copyIndex
  );
  const wargear = wargearCost(input.stats, weaponCountMap(input.selectedWeapons, input.modelCount));

  return { base, wargear, enhancement, total: base + wargear + enhancement, tierLabel, hasTiers };
}
