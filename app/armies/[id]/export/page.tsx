"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { UnitStats } from "@/lib/wahapedia";
import { selectMFMTier, getPointsFromTier } from "@/lib/mfm";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ArmyUnit {
  id: number;
  unit_id: number;
  name: string;
  faction: string | null;
  model_count: number;
  custom_points: number | null;
  selected_weapons: string | null;
  selected_drones: string | null;
  label: string | null;
  stats_json: string | null;
}

interface Army {
  id: number;
  name: string;
  faction: string | null;
  point_limit: number;
  units: ArmyUnit[];
}

// ─── Points helpers (mirrors army builder logic) ───────────────────────────

function getCopyIndex(unit: ArmyUnit, allUnits: ArmyUnit[]): number {
  let idx = 0;
  for (const u of allUnits) {
    if (u.unit_id === unit.unit_id) {
      if (u.id === unit.id) return idx;
      idx++;
    }
  }
  return 0;
}

function getUnitPoints(unit: ArmyUnit, allUnits: ArmyUnit[]): number {
  if (unit.custom_points !== null) return unit.custom_points;
  const stats: UnitStats | null = unit.stats_json ? JSON.parse(unit.stats_json) : null;
  if (!stats) return 0;
  const copyIndex = getCopyIndex(unit, allUnits);
  if (Array.isArray(stats.mfm_tiers) && stats.mfm_tiers.length > 0) {
    const tier = selectMFMTier(stats.mfm_tiers, copyIndex);
    return getPointsFromTier(tier, unit.model_count);
  }
  const table = stats.points_table;
  if (table && table.length > 0) {
    const sorted = [...table].sort((a, b) => a.models - b.models);
    const matching = sorted.filter(e => e.models <= unit.model_count);
    return (matching.length > 0 ? matching[matching.length - 1] : sorted[0]).points;
  }
  return (stats.points_per_model ?? 0) * unit.model_count;
}

// ─── Drone ability lookup ─────────────────────────────────────────────────

const DRONE_ABILITIES: Record<string, string> = {
  "Gun Drone":      "Twin pulse carbine: 18\", A2, 5+, S5, AP0, D1",
  "Shield Drone":   "4+ invulnerable save",
  "Marker Drone":   "Markerlight — each hit adds a Markerlight token to the target",
  "Guardian Drone": "+1 to armour saving throws for models in the bearer's unit",
  "Missile Drone":  "Missile pod: 36\", A2, 4+, S7, AP-1, D2",
};

// ─── Text export builder ──────────────────────────────────────────────────

function buildAIText(army: Army): string {
  const totalPoints = army.units.reduce((s, u) => s + getUnitPoints(u, army.units), 0);
  const lines: string[] = [];

  lines.push(`# ${army.name}`);
  if (army.faction) lines.push(`Faction: ${army.faction}`);
  lines.push(`Points: ${totalPoints} / ${army.point_limit}`);
  lines.push(`Units: ${army.units.length}`);
  lines.push("");

  for (const unit of army.units) {
    const stats: UnitStats | null = unit.stats_json ? JSON.parse(unit.stats_json) : null;
    const pts = getUnitPoints(unit, army.units);

    lines.push("---");
    lines.push(`## ${unit.name}${unit.label ? ` (${unit.label})` : ""}`);
    lines.push(`Models: ${unit.model_count}  |  Points: ${pts}`);
    if (unit.faction) lines.push(`Faction: ${unit.faction}`);

    if (stats) {
      lines.push(`Stats: M${stats.M} T${stats.T} W${stats.W} Sv${stats.Sv}${stats.invuln ? ` (${stats.invuln}++)` : ""} Ld${stats.Ld} OC${stats.OC}`);

      if (stats.keywords?.length) lines.push(`Keywords: ${stats.keywords.join(", ")}`);

      // Weapons — filtered by selection
      const selectedWeapons: Record<string, number> | null = unit.selected_weapons
        ? (() => {
            const sw = JSON.parse(unit.selected_weapons);
            return Array.isArray(sw)
              ? Object.fromEntries((sw as string[]).map(n => [n, unit.model_count]))
              : sw;
          })()
        : null;
      const weapons = selectedWeapons
        ? stats.weapons.filter(w => (selectedWeapons[w.name] ?? 0) > 0)
        : stats.weapons;

      const ranged = weapons.filter(w => w.type === "ranged");
      const melee  = weapons.filter(w => w.type === "melee");

      if (ranged.length) {
        lines.push("");
        lines.push("Ranged Weapons:");
        for (const w of ranged) {
          const n = selectedWeapons ? selectedWeapons[w.name] : unit.model_count;
          lines.push(`  ${w.name} ×${n}: ${w.range} | A${w.attacks} ${w.bsWs} S${w.strength} AP${w.ap} D${w.damage}${w.abilities ? ` [${w.abilities}]` : ""}`);
        }
      }
      if (melee.length) {
        lines.push("");
        lines.push("Melee Weapons:");
        for (const w of melee) {
          const n = selectedWeapons ? selectedWeapons[w.name] : unit.model_count;
          lines.push(`  ${w.name} ×${n}: — | A${w.attacks} ${w.bsWs} S${w.strength} AP${w.ap} D${w.damage}${w.abilities ? ` [${w.abilities}]` : ""}`);
        }
      }

      // Drones
      if (unit.selected_drones) {
        const drones = Object.entries(JSON.parse(unit.selected_drones) as Record<string, number>)
          .filter(([, n]) => n > 0);
        if (drones.length) {
          lines.push("");
          lines.push("Drones:");
          for (const [name, count] of drones) {
            const ability = DRONE_ABILITIES[name] ?? "";
            lines.push(`  ${name} ×${count}${ability ? ` — ${ability}` : ""}`);
          }
        }
      }

      // Abilities
      if (stats.abilities?.length) {
        lines.push("");
        lines.push("Abilities:");
        for (const a of stats.abilities) {
          lines.push(`  ${a.name}: ${a.description}`);
        }
      }

      // Stratagems (abbreviated)
      if (stats.stratagems?.length) {
        lines.push("");
        lines.push("Stratagems:");
        for (const s of stats.stratagems) {
          lines.push(`  ${s.name} (${s.cp}): ${s.effect}`);
        }
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}

// ─── Unit data sheet card (print view) ────────────────────────────────────

function DataSheetCard({ unit, allUnits, showStratagems }: { unit: ArmyUnit; allUnits: ArmyUnit[]; showStratagems: boolean }) {
  const stats: UnitStats | null = unit.stats_json ? JSON.parse(unit.stats_json) : null;
  const pts = getUnitPoints(unit, allUnits);

  const selectedWeapons: Record<string, number> | null = unit.selected_weapons
    ? (() => {
        const sw = JSON.parse(unit.selected_weapons);
        return Array.isArray(sw)
          ? Object.fromEntries((sw as string[]).map(n => [n, unit.model_count]))
          : sw;
      })()
    : null;
  const weapons = stats
    ? (selectedWeapons
        ? stats.weapons.filter(w => (selectedWeapons[w.name] ?? 0) > 0)
        : stats.weapons)
    : [];
  const ranged = weapons.filter(w => w.type === "ranged");
  const melee  = weapons.filter(w => w.type === "melee");

  const drones: [string, number][] = unit.selected_drones
    ? Object.entries(JSON.parse(unit.selected_drones) as Record<string, number>).filter(([, n]) => n > 0)
    : [];

  const coreStats = stats ? [
    { label: "M",   value: stats.M   },
    { label: "T",   value: stats.T   },
    { label: "W",   value: stats.W   },
    { label: "Sv",  value: stats.Sv  },
    { label: "Ld",  value: stats.Ld  },
    { label: "OC",  value: stats.OC  },
    ...(stats.invuln ? [{ label: "Inv", value: `${stats.invuln}++` }] : []),
  ] : [];

  return (
    <div className="data-sheet bg-white text-black rounded-lg overflow-hidden border-2 border-gray-300 break-inside-avoid mb-4">
      {/* Header */}
      <div className="bg-gray-800 text-white px-4 py-2 flex items-baseline justify-between gap-3">
        <div>
          <span className="font-bold text-lg">{unit.name}</span>
          {unit.label && <span className="text-gray-300 text-sm ml-2">— {unit.label}</span>}
          {unit.faction && <span className="text-gray-400 text-xs ml-2">{unit.faction}</span>}
        </div>
        <div className="text-right shrink-0">
          <span className="text-amber-300 font-bold font-mono">{pts} pts</span>
          <span className="text-gray-400 text-sm ml-2">{unit.model_count}m</span>
        </div>
      </div>

      <div className="p-3 space-y-3">
        {/* Core stats */}
        {coreStats.length > 0 && (
          <div className={`grid gap-1 text-center`} style={{ gridTemplateColumns: `repeat(${coreStats.length}, 1fr)` }}>
            {coreStats.map(s => (
              <div key={s.label} className="border border-gray-200 rounded py-1">
                <div className="text-gray-500 text-[10px] font-bold uppercase">{s.label}</div>
                <div className="text-black font-mono font-bold text-sm">{s.value || "—"}</div>
              </div>
            ))}
          </div>
        )}

        {/* Keywords */}
        {stats?.keywords?.length && (
          <div className="flex flex-wrap gap-1">
            {stats.keywords.map((kw, i) => (
              <span key={i} className="bg-gray-100 border border-gray-300 text-gray-700 text-[10px] px-1.5 py-0.5 rounded font-medium">{kw}</span>
            ))}
          </div>
        )}

        {/* Weapons table */}
        {(ranged.length > 0 || melee.length > 0) && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-gray-100">
                  <th className="text-left px-2 py-1 border border-gray-200">Weapon</th>
                  <th className="px-2 py-1 border border-gray-200 text-center">×</th>
                  <th className="px-2 py-1 border border-gray-200 text-center">Rng</th>
                  <th className="px-2 py-1 border border-gray-200 text-center">A</th>
                  <th className="px-2 py-1 border border-gray-200 text-center">BS/WS</th>
                  <th className="px-2 py-1 border border-gray-200 text-center">S</th>
                  <th className="px-2 py-1 border border-gray-200 text-center">AP</th>
                  <th className="px-2 py-1 border border-gray-200 text-center">D</th>
                  <th className="text-left px-2 py-1 border border-gray-200">Abilities</th>
                </tr>
              </thead>
              <tbody>
                {ranged.length > 0 && (
                  <>
                    <tr><td colSpan={9} className="bg-blue-50 text-blue-700 text-[10px] font-bold uppercase px-2 py-0.5">Ranged</td></tr>
                    {ranged.map(w => (
                      <tr key={w.name} className="border-t border-gray-100">
                        <td className="px-2 py-1 font-medium">{w.name}</td>
                        <td className="px-2 py-1 text-center text-gray-500">{selectedWeapons ? selectedWeapons[w.name] : unit.model_count}</td>
                        <td className="px-2 py-1 text-center">{w.range}</td>
                        <td className="px-2 py-1 text-center">{w.attacks}</td>
                        <td className="px-2 py-1 text-center">{w.bsWs}</td>
                        <td className="px-2 py-1 text-center">{w.strength}</td>
                        <td className="px-2 py-1 text-center">{w.ap}</td>
                        <td className="px-2 py-1 text-center">{w.damage}</td>
                        <td className="px-2 py-1 text-gray-600">{w.abilities}</td>
                      </tr>
                    ))}
                  </>
                )}
                {melee.length > 0 && (
                  <>
                    <tr><td colSpan={9} className="bg-red-50 text-red-700 text-[10px] font-bold uppercase px-2 py-0.5">Melee</td></tr>
                    {melee.map(w => (
                      <tr key={w.name} className="border-t border-gray-100">
                        <td className="px-2 py-1 font-medium">{w.name}</td>
                        <td className="px-2 py-1 text-center text-gray-500">{selectedWeapons ? selectedWeapons[w.name] : unit.model_count}</td>
                        <td className="px-2 py-1 text-center">—</td>
                        <td className="px-2 py-1 text-center">{w.attacks}</td>
                        <td className="px-2 py-1 text-center">{w.bsWs}</td>
                        <td className="px-2 py-1 text-center">{w.strength}</td>
                        <td className="px-2 py-1 text-center">{w.ap}</td>
                        <td className="px-2 py-1 text-center">{w.damage}</td>
                        <td className="px-2 py-1 text-gray-600">{w.abilities}</td>
                      </tr>
                    ))}
                  </>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Drones */}
        {drones.length > 0 && (
          <div>
            <div className="text-teal-700 text-[10px] font-bold uppercase mb-1">Drones</div>
            <div className="space-y-0.5">
              {drones.map(([name, count]) => (
                <div key={name} className="text-xs flex gap-2">
                  <span className="font-bold text-teal-700">{count}×</span>
                  <span className="font-medium">{name}</span>
                  {DRONE_ABILITIES[name] && (
                    <span className="text-gray-500">— {DRONE_ABILITIES[name]}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Abilities */}
        {stats?.abilities?.length ? (
          <div>
            <div className="text-amber-700 text-[10px] font-bold uppercase mb-1">Abilities</div>
            <div className="space-y-0.5">
              {stats.abilities.map((a, i) => (
                <div key={i} className="text-xs">
                  <span className="font-bold text-amber-800">{a.name}: </span>
                  <span className="text-gray-700">{a.description}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {/* Stratagems */}
        {showStratagems && stats?.stratagems?.length ? (
          <div>
            <div className="text-purple-700 text-[10px] font-bold uppercase mb-1">Stratagems ({stats.stratagems.length})</div>
            <div className="space-y-1">
              {stats.stratagems.map((s, i) => (
                <div key={i} className="text-xs border-l-2 border-purple-200 pl-2">
                  <span className="font-bold">{s.name}</span>
                  <span className="text-gray-500 ml-1">({s.cp})</span>
                  {s.type && <span className="text-purple-600 ml-1 italic">{s.type}</span>}
                  {s.effect && <div className="text-gray-600 mt-0.5">{s.effect}</div>}
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────

export default function ExportPage() {
  const params = useParams();
  const armyId = params.id as string;
  const [army, setArmy] = useState<Army | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [showStratagems, setShowStratagems] = useState(true);

  const loadArmy = useCallback(async () => {
    const res = await fetch(`/api/armies/${armyId}`);
    if (res.ok) setArmy(await res.json());
    setLoading(false);
  }, [armyId]);

  useEffect(() => { loadArmy(); }, [loadArmy]);

  async function handleCopyAI() {
    if (!army) return;
    await navigator.clipboard.writeText(buildAIText(army));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (loading) return <div className="p-8 text-gray-400">Loading...</div>;
  if (!army)   return <div className="p-8 text-gray-400">Army not found.</div>;

  const totalPoints = army.units.reduce((s, u) => s + getUnitPoints(u, army.units), 0);

  return (
    <>
      {/* Print-only styles */}
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: white !important; }
          .data-sheet { box-shadow: none !important; border: 1px solid #ccc !important; }
        }
      `}</style>

      {/* Toolbar — hidden on print */}
      <div className="no-print bg-gray-900 border-b border-gray-800 px-4 py-3 flex items-center gap-3 flex-wrap sticky top-0 z-10">
        <Link href={`/armies/${armyId}`} className="text-gray-400 hover:text-white text-sm">
          ← Back
        </Link>
        <div className="flex-1 min-w-0">
          <span className="text-white font-bold">{army.name}</span>
          {army.faction && <span className="text-gray-400 text-sm ml-2">{army.faction}</span>}
          <span className="text-amber-400 font-mono text-sm ml-3">{totalPoints} / {army.point_limit} pts</span>
        </div>
        <label className="flex items-center gap-1.5 text-sm text-gray-300 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showStratagems}
            onChange={e => setShowStratagems(e.target.checked)}
            className="accent-amber-500"
          />
          Stratagems
        </label>
        <button
          onClick={handleCopyAI}
          className="bg-blue-700 hover:bg-blue-600 text-white px-4 py-1.5 rounded text-sm font-medium transition-colors"
        >
          {copied ? "Copied!" : "Copy for AI"}
        </button>
        <button
          onClick={() => window.print()}
          className="bg-amber-700 hover:bg-amber-600 text-white px-4 py-1.5 rounded text-sm font-medium transition-colors"
        >
          Print
        </button>
      </div>

      {/* Print header — visible only when printing */}
      <div className="hidden print:block px-6 pt-4 pb-2 border-b border-gray-300 mb-4">
        <h1 className="text-2xl font-bold">{army.name}</h1>
        <p className="text-gray-600">{army.faction} — {totalPoints} / {army.point_limit} pts — {army.units.length} units</p>
      </div>

      {/* Data sheets */}
      <div className="max-w-4xl mx-auto px-4 py-6 columns-1 md:columns-2 gap-4">
        {army.units.map(unit => (
          <DataSheetCard key={unit.id} unit={unit} allUnits={army.units} showStratagems={showStratagems} />
        ))}
      </div>
    </>
  );
}
