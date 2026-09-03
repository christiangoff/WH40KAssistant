"use client";

import { useState } from "react";
import Link from "next/link";
import { UnitStats, weaponLabel } from "@/lib/wahapedia";
import { resolveUnitPoints } from "@/lib/points";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ArmyUnit {
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
  enhancement_name?: string | null;
  enhancement_points?: number | null;
  enhancement_description?: string | null;
}

export interface Detachment {
  id: number;
  faction_id: number;
  name: string;
  dp_cost: number;
  unique_tag: string | null;
  force_disposition?: string | null;
  rule_name?: string | null;
  rule_text?: string | null;
}

export interface StratagemRow {
  id: number;
  scope: "core" | "faction" | "detachment";
  detachment_id: number | null;
  name: string;
  cp: string;
  type: string;
  when_text: string;
  target_text: string;
  effect_text: string;
  restrictions: string | null;
}

export interface StratagemGroups {
  core: StratagemRow[];
  byDetachment: Record<number, StratagemRow[]>;
}

export interface ExportArmy {
  id: number;
  name: string;
  faction: string | null;
  faction_id: number | null;
  point_limit: number;
  is_owner: boolean;
  owner_username: string;
  army_rule_name?: string | null;
  army_rule_text?: string | null;
  units: ArmyUnit[];
  detachments: Detachment[];
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

export function getUnitPoints(unit: ArmyUnit, allUnits: ArmyUnit[]): number {
  const stats: UnitStats | null = unit.stats_json ? JSON.parse(unit.stats_json) : null;
  return resolveUnitPoints({
    stats,
    modelCount: unit.model_count,
    copyIndex: getCopyIndex(unit, allUnits),
    customPoints: unit.custom_points,
    selectedWeapons: unit.selected_weapons,
    enhancementPoints: unit.enhancement_points ?? null,
  }).total;
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

function buildAIText(army: ExportArmy, stratagemGroups: StratagemGroups | null): string {
  const totalPoints = army.units.reduce((s, u) => s + getUnitPoints(u, army.units), 0);
  const lines: string[] = [];

  lines.push(`# ${army.name}`);
  if (army.faction) lines.push(`Faction: ${army.faction}`);
  if (army.detachments.length > 0) {
    lines.push(`Detachments: ${army.detachments.map(d => `${d.name} (${d.dp_cost}DP)`).join(", ")}`);
  }
  lines.push(`Points: ${totalPoints} / ${army.point_limit}`);
  lines.push(`Units: ${army.units.length}`);
  lines.push("");

  if (army.army_rule_name || army.detachments.some(d => d.rule_name || d.rule_text)) {
    lines.push("## Rules");
    if (army.army_rule_name) {
      lines.push(`Army Rule — ${army.army_rule_name}: ${army.army_rule_text ?? ""}`.trim());
    }
    for (const d of army.detachments) {
      if (!d.rule_name && !d.rule_text) continue;
      lines.push(`${d.name} (${d.dp_cost}DP)${d.rule_name ? ` — ${d.rule_name}` : ""}: ${d.rule_text ?? ""}`.trim());
    }
    lines.push("");
  }

  for (const unit of army.units) {
    const stats: UnitStats | null = unit.stats_json ? JSON.parse(unit.stats_json) : null;
    const pts = getUnitPoints(unit, army.units);

    lines.push("---");
    lines.push(`## ${unit.name}${unit.label ? ` (${unit.label})` : ""}`);
    lines.push(`Models: ${unit.model_count}  |  Points: ${pts}`);
    if (unit.faction) lines.push(`Faction: ${unit.faction}`);
    if (unit.enhancement_name) {
      lines.push(`Enhancement: ${unit.enhancement_name}${unit.enhancement_points ? ` (+${unit.enhancement_points}pts)` : ""}${unit.enhancement_description ? ` — ${unit.enhancement_description}` : ""}`);
    }

    if (stats) {
      lines.push(`Stats: M${stats.M} T${stats.T} W${stats.W} Sv${stats.Sv}${stats.invuln ? ` (${stats.invuln}++)` : ""} Ld${stats.Ld} OC${stats.OC}`);

      if (stats.keywords?.length) lines.push(`Keywords: ${stats.keywords.join(", ")}`);

      if (stats.unit_composition) lines.push(`Composition: ${stats.unit_composition}`);
      if (stats.equipped_with) lines.push(stats.equipped_with);

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
      const wgCost = (name: string) => {
        const b = name.toLowerCase().replace(/[^a-z0-9]/g, "");
        const opt = (stats.mfm_wargear ?? []).find(o => {
          const a = o.weapon.toLowerCase().replace(/[^a-z0-9]/g, "");
          return a === b || a.startsWith(b) || b.startsWith(a);
        });
        return opt?.points ?? 0;
      };

      if (ranged.length) {
        lines.push("");
        lines.push("Ranged Weapons:");
        for (const w of ranged) {
          const n = selectedWeapons ? selectedWeapons[w.name] : unit.model_count;
          const c = wgCost(w.name);
          lines.push(`  ${weaponLabel(w)} ×${n}${c ? ` (+${c}pts ea)` : ""}: ${w.range} | A${w.attacks} ${w.bsWs} S${w.strength} AP${w.ap} D${w.damage}${w.abilities ? ` [${w.abilities}]` : ""}`);
        }
      }
      if (melee.length) {
        lines.push("");
        lines.push("Melee Weapons:");
        for (const w of melee) {
          const n = selectedWeapons ? selectedWeapons[w.name] : unit.model_count;
          const c = wgCost(w.name);
          lines.push(`  ${weaponLabel(w)} ×${n}${c ? ` (+${c}pts ea)` : ""}: — | A${w.attacks} ${w.bsWs} S${w.strength} AP${w.ap} D${w.damage}${w.abilities ? ` [${w.abilities}]` : ""}`);
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

      // Damaged
      if (stats.damaged) {
        lines.push("");
        lines.push(`Damaged: ${stats.damaged.threshold}`);
        lines.push(`  ${stats.damaged.effect}`);
      }

    }
    lines.push("");
  }

  if (stratagemGroups) {
    const allGroups: [string, StratagemRow[]][] = [
      ["Core Stratagems", stratagemGroups.core],
      ...army.detachments.map((d): [string, StratagemRow[]] => [`${d.name} Stratagems`, stratagemGroups.byDetachment[d.id] ?? []]),
    ];
    for (const [title, strats] of allGroups) {
      if (strats.length === 0) continue;
      lines.push("---");
      lines.push(`## ${title}`);
      for (const s of strats) {
        const parts = [
          s.when_text && `WHEN: ${s.when_text}`,
          s.target_text && `TARGET: ${s.target_text}`,
          s.effect_text && `EFFECT: ${s.effect_text}`,
          s.restrictions && `RESTRICTIONS: ${s.restrictions}`,
        ].filter(Boolean).join("  ");
        lines.push(`  ${s.name} (${s.cp})${s.type ? ` [${s.type}]` : ""}: ${parts}`);
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}

// ─── Unit data sheet card (print view) ────────────────────────────────────

function DataSheetCard({ unit, allUnits }: { unit: ArmyUnit; allUnits: ArmyUnit[] }) {
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
        {/* Unit composition */}
        {(stats?.unit_composition || stats?.equipped_with) && (
          <div className="text-[11px] text-gray-600">
            {stats?.unit_composition && (
              <div><span className="font-bold uppercase text-gray-500">Composition: </span>{stats.unit_composition}</div>
            )}
            {stats?.equipped_with && <div>{stats.equipped_with}</div>}
          </div>
        )}

        {/* Enhancement */}
        {unit.enhancement_name && (
          <div className="text-xs border border-amber-300 bg-amber-50 rounded px-2 py-1">
            <span className="font-bold text-amber-800">Enhancement — {unit.enhancement_name}</span>
            {unit.enhancement_points ? <span className="font-mono ml-1">+{unit.enhancement_points}pts</span> : null}
            {unit.enhancement_description && <span className="text-gray-600 ml-1">{unit.enhancement_description}</span>}
          </div>
        )}

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
                      <tr key={weaponLabel(w)} className="border-t border-gray-100">
                        <td className="px-2 py-1 font-medium">{weaponLabel(w)}</td>
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
                      <tr key={weaponLabel(w)} className="border-t border-gray-100">
                        <td className="px-2 py-1 font-medium">{weaponLabel(w)}</td>
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

        {/* Damaged */}
        {stats?.damaged && (
          <div>
            <div className="text-red-700 text-[10px] font-bold uppercase mb-1">Damaged: {stats.damaged.threshold}</div>
            <div className="text-xs text-gray-700">{stats.damaged.effect}</div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Army & detachment rules (print) ──────────────────────────────────────

function RulesSection({ army }: { army: ExportArmy }) {
  const detachmentsWithRules = army.detachments.filter(d => d.rule_name || d.rule_text);
  if (!army.army_rule_name && detachmentsWithRules.length === 0) return null;

  return (
    <div className="data-sheet bg-white text-black rounded-lg overflow-hidden border-2 border-amber-300 break-inside-avoid mb-4 p-3">
      <div className="text-amber-700 text-xs font-bold uppercase mb-2">Rules</div>
      <div className="space-y-2.5">
        {army.army_rule_name && (
          <div className="text-xs border-l-2 border-amber-300 pl-2">
            <span className="font-bold">Army Rule — {army.army_rule_name}</span>
            {army.army_rule_text && <div className="text-gray-700 mt-0.5">{army.army_rule_text}</div>}
          </div>
        )}
        {detachmentsWithRules.map(d => (
          <div key={d.id} className="text-xs border-l-2 border-amber-200 pl-2">
            <span className="font-bold">{d.name}</span>
            <span className="text-gray-500 ml-1">({d.dp_cost}DP)</span>
            {d.force_disposition && <span className="text-gray-500 ml-1 italic">{d.force_disposition}</span>}
            {d.rule_name && <span className="text-amber-700 ml-1 italic">{d.rule_name}</span>}
            {d.rule_text && <div className="text-gray-700 mt-0.5">{d.rule_text}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Army-level stratagems section (print) ─────────────────────────────────

function StratagemsSection({ title, stratagems }: { title: string; stratagems: StratagemRow[] }) {
  if (stratagems.length === 0) return null;
  return (
    <div className="data-sheet bg-white text-black rounded-lg overflow-hidden border-2 border-gray-300 break-inside-avoid mb-4 p-3">
      <div className="text-purple-700 text-xs font-bold uppercase mb-1.5">{title} ({stratagems.length})</div>
      <div className="space-y-2">
        {stratagems.map(s => (
          <div key={s.id} className="text-xs border-l-2 border-purple-200 pl-2 break-inside-avoid">
            <div>
              <span className="font-bold">{s.name}</span>
              <span className="text-gray-500 ml-1">({s.cp})</span>
              {s.type && <span className="text-purple-600 ml-1 italic">{s.type}</span>}
            </div>
            {s.when_text && <div className="mt-0.5"><span className="font-bold text-gray-700">WHEN: </span><span className="text-gray-600">{s.when_text}</span></div>}
            {s.target_text && <div><span className="font-bold text-gray-700">TARGET: </span><span className="text-gray-600">{s.target_text}</span></div>}
            {s.effect_text && <div><span className="font-bold text-gray-700">EFFECT: </span><span className="text-gray-600">{s.effect_text}</span></div>}
            {s.restrictions && <div><span className="font-bold text-gray-700">RESTRICTIONS: </span><span className="text-gray-600">{s.restrictions}</span></div>}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── The full printable / shareable army view ──────────────────────────────

export function ArmyExportView({
  army,
  stratagemGroups,
  backHref,
}: {
  army: ExportArmy;
  stratagemGroups: StratagemGroups | null;
  backHref?: string;
}) {
  const [copied, setCopied] = useState(false);
  const [showStratagems, setShowStratagems] = useState(true);

  const totalPoints = army.units.reduce((s, u) => s + getUnitPoints(u, army.units), 0);

  async function handleCopyAI() {
    await navigator.clipboard.writeText(buildAIText(army, stratagemGroups));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

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
        {backHref && (
          <Link href={backHref} className="text-gray-400 hover:text-white text-sm">← Back</Link>
        )}
        <div className="flex-1 min-w-0">
          <span className="text-white font-bold">{army.name}</span>
          {army.faction && <span className="text-gray-400 text-sm ml-2">{army.faction}</span>}
          {!army.is_owner && <span className="text-gray-500 text-sm ml-2">· Shared by {army.owner_username}</span>}
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

      {/* Army & detachment rules */}
      <div className="max-w-4xl mx-auto px-4 pt-6">
        <RulesSection army={army} />
      </div>

      {/* Data sheets */}
      <div className="max-w-4xl mx-auto px-4 pb-6 columns-1 md:columns-2 gap-4">
        {army.units.map(unit => (
          <DataSheetCard key={unit.id} unit={unit} allUnits={army.units} />
        ))}
      </div>

      {/* Army-level stratagems */}
      {showStratagems && stratagemGroups && (
        <div className="max-w-4xl mx-auto px-4 pb-6 columns-1 md:columns-2 gap-4">
          <StratagemsSection title="Core Stratagems" stratagems={stratagemGroups.core} />
          {army.detachments.map(d => (
            <StratagemsSection key={d.id} title={`${d.name} Stratagems`} stratagems={stratagemGroups.byDetachment[d.id] ?? []} />
          ))}
        </div>
      )}
    </>
  );
}
