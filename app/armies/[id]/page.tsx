"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { UnitStats } from "@/lib/wahapedia";
import { selectMFMTier, getPointsFromTier } from "@/lib/mfm";

interface CollectionUnit {
  id: number;
  name: string;
  faction: string | null;
  stats_json: string | null;
  quantity: number; // owned models
}

interface Squad {
  id: number;
  army_id: number;
  name: string;
}

interface ArmyUnit {
  id: number;
  army_id: number;
  unit_id: number;
  model_count: number;
  custom_points: number | null;
  squad_id: number | null;
  selected_weapons: string | null;
  selected_drones: string | null;
  label: string | null;
  detachment: string | null;
  name: string;
  faction: string | null;
  stats_json: string | null;
  owned_models: number;
}

interface Army {
  id: number;
  name: string;
  faction: string | null;
  point_limit: number;
  units: ArmyUnit[];
  squads: Squad[];
}

function parseStats(unit: ArmyUnit): UnitStats | null {
  return unit.stats_json ? JSON.parse(unit.stats_json) : null;
}

// Returns the copy index (0-based) of this unit among all units with the same unit_id
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

// Returns { points, tier, copyIndex } for display
function resolveUnitPoints(
  unit: ArmyUnit,
  allUnits: ArmyUnit[]
): { points: number; tierLabel: string | null; copyIndex: number; hasTiers: boolean } {
  if (unit.custom_points !== null) {
    return { points: unit.custom_points, tierLabel: null, copyIndex: 0, hasTiers: false };
  }

  const stats = parseStats(unit);
  if (!stats) return { points: 0, tierLabel: null, copyIndex: 0, hasTiers: false };

  const copyIndex = getCopyIndex(unit, allUnits);
  const hasTiers =
    Array.isArray(stats.mfm_tiers) &&
    stats.mfm_tiers.length > 1;

  if (Array.isArray(stats.mfm_tiers) && stats.mfm_tiers.length > 0) {
    const tier = selectMFMTier(stats.mfm_tiers, copyIndex);
    const points = getPointsFromTier(tier, unit.model_count);
    return { points, tierLabel: tier.copies, copyIndex, hasTiers };
  }

  // Fallback: use points_table / points_per_model from Wahapedia
  const table = stats.points_table;
  if (table && table.length > 0) {
    const sorted = [...table].sort((a, b) => a.models - b.models);
    const matching = sorted.filter((e) => e.models <= unit.model_count);
    const entry = matching.length > 0 ? matching[matching.length - 1] : sorted[0];
    return { points: entry.points, tierLabel: null, copyIndex, hasTiers: false };
  }

  return {
    points: (stats.points_per_model ?? 0) * unit.model_count,
    tierLabel: null,
    copyIndex,
    hasTiers: false,
  };
}

function getUnitPoints(unit: ArmyUnit, allUnits: ArmyUnit[] = []): number {
  return resolveUnitPoints(unit, allUnits).points;
}

function getValidSizes(stats: UnitStats | null): number[] {
  if (!stats) return [];
  if (Array.isArray(stats.mfm_tiers) && stats.mfm_tiers.length > 0) {
    const primary = stats.mfm_tiers.find(t => t.copies === "1st-2nd" || t.copies === "all") ?? stats.mfm_tiers[0];
    if (primary.entries.length > 0)
      return [...primary.entries].sort((a, b) => a.models - b.models).map(e => e.models);
  }
  if (Array.isArray(stats.points_table) && stats.points_table.length > 0)
    return [...stats.points_table].sort((a, b) => a.models - b.models).map(e => e.models);
  return [];
}

// Parse selected_weapons JSON into weapon→count map.
// Handles both legacy string[] and new Record<string,number> format.
function parseWeaponCounts(
  selectedWeapons: string | null,
  allWeapons: { name: string }[],
  modelCount: number
): Record<string, number> {
  const defaults: Record<string, number> = {};
  allWeapons.forEach(w => { defaults[w.name] = modelCount; });
  if (!selectedWeapons) return defaults;
  try {
    const parsed = JSON.parse(selectedWeapons);
    if (Array.isArray(parsed)) {
      // Legacy: string[] of selected weapon names → count = modelCount for selected, 0 for others
      const sel = new Set(parsed as string[]);
      const result: Record<string, number> = {};
      allWeapons.forEach(w => { result[w.name] = sel.has(w.name) ? modelCount : 0; });
      return result;
    }
    // New format: Record<string, number>
    return parsed as Record<string, number>;
  } catch {
    return defaults;
  }
}

interface DroneOption {
  name: string;
  maxPerGroup: number; // stated limit per group (e.g. "up to two")
  perModel: boolean;   // true = limit applies per model; false = limit applies to the leader only
}

// Parse available drone options from a unit's wargear_options text.
// Looks for bullet lines containing "drone" and infers per-model max from the preceding context.
function parseDroneOptions(wargearOptions: string[]): DroneOption[] | null {
  const result: DroneOption[] = [];
  const seen = new Set<string>();

  let sectionMax = 2;
  let sectionPerModel = true;

  for (const line of wargearOptions) {
    const droneMatch = line.match(/•\s*\d+\s+(.+?drone)\b/i);
    if (droneMatch) {
      const rawName = droneMatch[1].replace(/\s*\(.*\)/g, "").trim();
      const name = rawName.replace(/\b\w/g, (c) => c.toUpperCase());
      // "(it cannot take duplicates of this piece of wargear)" → max 1 of this type
      const noDuplicate = /cannot take duplicates/i.test(line);
      if (!seen.has(name)) {
        seen.add(name);
        result.push({ name, maxPerGroup: noDuplicate ? 1 : sectionMax, perModel: sectionPerModel });
      }
    } else {
      const upToMatch = line.match(/up to (\w+)/i);
      if (upToMatch) {
        const w: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5 };
        sectionMax = w[upToMatch[1].toLowerCase()] ?? parseInt(upToMatch[1]) ?? 2;
      }
      if (/shas'?ui|leader\b/i.test(line) && !/any number of models/i.test(line)) {
        sectionPerModel = false;
      } else if (/any number of models|each model/i.test(line)) {
        sectionPerModel = true;
      }
    }
  }

  return result.length > 0 ? result : null;
}

function parseDroneCounts(
  selectedDrones: string | null,
  droneOptions: DroneOption[]
): Record<string, number> {
  const defaults: Record<string, number> = {};
  droneOptions.forEach((d) => { defaults[d.name] = 0; });
  if (!selectedDrones) return defaults;
  try {
    return { ...defaults, ...(JSON.parse(selectedDrones) as Record<string, number>) };
  } catch {
    return defaults;
  }
}

interface UnitRowProps {
  unit: ArmyUnit;
  allArmyUnits: ArmyUnit[];
  squads: Squad[];
  onSizeChange: (unit: ArmyUnit, size: number) => void;
  onAssignSquad: (unit: ArmyUnit, squadId: number | null) => void;
  onRemove: (id: number) => void;
  onWeaponsChange: (unitId: number, data: Record<string, number> | null) => void;
  onDronesChange: (unitId: number, data: Record<string, number> | null) => void;
  onLabelChange: (unitId: number, label: string | null) => void;
  onDetachmentChange: (unitId: number, detachment: string | null) => void;
}

function UnitRow({
  unit,
  allArmyUnits,
  squads,
  onSizeChange,
  onAssignSquad,
  onRemove,
  onWeaponsChange,
  onDronesChange,
  onLabelChange,
  onDetachmentChange,
}: UnitRowProps) {
  const [weaponsOpen, setWeaponsOpen] = useState(false);
  const [dronesOpen, setDronesOpen] = useState(false);
  const [labelValue, setLabelValue] = useState(unit.label ?? "");
  const labelRef = useRef(unit.label);

  const stats: UnitStats | null = unit.stats_json ? JSON.parse(unit.stats_json) : null;
  const allWeapons = stats?.weapons ?? [];
  const droneOptions = parseDroneOptions(stats?.wargear_options ?? []);

  const [weaponCounts, setWeaponCounts] = useState<Record<string, number>>(() =>
    parseWeaponCounts(unit.selected_weapons, allWeapons, unit.model_count)
  );
  const [droneCounts, setDroneCounts] = useState<Record<string, number>>(() =>
    parseDroneCounts(unit.selected_drones, droneOptions ?? [])
  );

  // Sync label when it changes externally
  useEffect(() => {
    if (unit.label !== labelRef.current) {
      labelRef.current = unit.label;
      setLabelValue(unit.label ?? "");
    }
  }, [unit.label]);

  // Clamp weapon counts when squad size changes
  useEffect(() => {
    setWeaponCounts(prev => {
      const clamped = { ...prev };
      let changed = false;
      allWeapons.forEach(w => {
        if ((clamped[w.name] ?? 0) > unit.model_count) {
          clamped[w.name] = unit.model_count;
          changed = true;
        }
      });
      return changed ? clamped : prev;
    });
  }, [unit.model_count]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleLabelBlur() {
    const trimmed = labelValue.trim() || null;
    if (trimmed !== (unit.label || null)) {
      onLabelChange(unit.id, trimmed);
    }
  }

  function updateWeaponCount(weaponName: string, count: number) {
    const newCounts = { ...weaponCounts, [weaponName]: Math.max(0, Math.min(unit.model_count, count)) };
    setWeaponCounts(newCounts);
    // Pass null if everything is at default (all = model_count)
    const isDefault = allWeapons.every(w => (newCounts[w.name] ?? 0) === unit.model_count);
    onWeaponsChange(unit.id, isDefault ? null : newCounts);
  }

  function updateDroneCount(droneName: string, count: number, maxCount: number) {
    const newCounts = { ...droneCounts, [droneName]: Math.max(0, Math.min(maxCount, count)) };
    setDroneCounts(newCounts);
    const isEmpty = Object.values(newCounts).every(v => v === 0);
    onDronesChange(unit.id, isEmpty ? null : newCounts);
  }

  const { points: pts, tierLabel, hasTiers } = resolveUnitPoints(unit, allArmyUnits);
  const validSizes = getValidSizes(stats);
  const isInvalidSize = validSizes.length > 0 && !validSizes.includes(unit.model_count);
  const availableDetachments = Array.from(
    new Set((stats?.stratagems ?? []).map(s => s.type).filter(t => t && !t.toLowerCase().includes("core")))
  ).sort();

  return (
    <div className="flex flex-col gap-0 bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
      {/* Main row */}
      <div className="p-3 flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="text-white font-medium">{unit.name}</div>
          <input
            type="text"
            value={labelValue}
            onChange={(e) => setLabelValue(e.target.value)}
            onBlur={handleLabelBlur}
            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
            placeholder="Label (e.g. Sgt – Chainfist)…"
            className="mt-0.5 w-full bg-transparent border-b border-dashed border-gray-700 focus:border-amber-500 text-amber-300 text-xs focus:outline-none placeholder-gray-600"
          />
          <div className="text-gray-400 text-xs flex gap-3 mt-0.5 flex-wrap">
            {unit.faction && <span>{unit.faction}</span>}
            {stats && (
              <>
                <span>M:{stats.M}</span>
                <span>T:{stats.T}</span>
                <span>W:{stats.W}</span>
                <span>Sv:{stats.Sv}</span>
              </>
            )}
          </div>
        </div>
        {/* Squad selector */}
        <select
          value={unit.squad_id ?? ""}
          onChange={(e) => onAssignSquad(unit, e.target.value ? parseInt(e.target.value) : null)}
          className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-gray-300 text-xs focus:outline-none focus:border-amber-500 shrink-0"
        >
          <option value="">No unit</option>
          {squads.map((sq) => (
            <option key={sq.id} value={sq.id}>{sq.name}</option>
          ))}
        </select>
        {/* Size selector */}
        <div className="flex items-center gap-1 shrink-0 flex-wrap justify-end">
          {validSizes.length > 1 ? (
            validSizes.map(size => (
              <button
                key={size}
                onClick={() => onSizeChange(unit, size)}
                className={`px-2 py-1 rounded text-xs font-mono transition-colors ${
                  unit.model_count === size
                    ? "bg-amber-600 text-white"
                    : "bg-gray-700 text-gray-300 hover:bg-gray-600"
                }`}
              >
                {size}m
              </button>
            ))
          ) : validSizes.length === 1 ? (
            <span className="text-gray-400 text-xs">{validSizes[0]}m</span>
          ) : (
            <>
              <span className="text-gray-400 text-xs">Size:</span>
              <button
                onClick={() => onSizeChange(unit, unit.model_count - 1)}
                disabled={unit.model_count <= 1}
                className="w-6 h-6 bg-gray-700 hover:bg-gray-600 disabled:opacity-40 rounded text-white text-sm"
              >-</button>
              <span className="w-6 text-center text-white text-sm">{unit.model_count}</span>
              <button
                onClick={() => onSizeChange(unit, unit.model_count + 1)}
                className="w-6 h-6 bg-gray-700 hover:bg-gray-600 rounded text-white text-sm"
              >+</button>
            </>
          )}
          {isInvalidSize && (
            <span className="text-amber-500 text-xs" title={`${unit.model_count} is not a valid squad size`}>⚠</span>
          )}
        </div>
        {/* Points */}
        <div className="text-right shrink-0">
          <div className={`font-mono text-sm ${tierLabel === "3rd+" || tierLabel === "2nd+" ? "text-orange-400" : "text-amber-400"}`}>
            {pts > 0 ? `${pts} pts` : "—"}
          </div>
          {hasTiers && tierLabel && (
            <div className={`text-xs ${tierLabel === "3rd+" || tierLabel === "2nd+" ? "text-orange-500" : "text-gray-500"}`}>
              {tierLabel === "1st-2nd" ? "1st–2nd copy" : tierLabel === "3rd+" ? "3rd+ copy" : tierLabel === "2nd+" ? "2nd+ copy" : tierLabel}
            </div>
          )}
          {!hasTiers && stats?.points_per_model && (
            <div className="text-gray-500 text-xs">{stats.points_per_model}/model</div>
          )}
        </div>
        <button
          onClick={() => onRemove(unit.id)}
          className="text-gray-600 hover:text-red-400 text-sm shrink-0 transition-colors"
        >
          ✕
        </button>
      </div>
      {/* Detachment selector */}
      {availableDetachments.length > 0 && (
        <div className="border-t border-gray-800 px-3 py-1.5 flex items-center gap-2">
          <span className="text-gray-500 text-xs shrink-0">Detachment:</span>
          <select
            value={unit.detachment ?? ""}
            onChange={e => onDetachmentChange(unit.id, e.target.value || null)}
            className="flex-1 bg-gray-800 border border-gray-700 rounded px-2 py-0.5 text-xs text-white focus:outline-none focus:border-amber-500"
          >
            <option value="">— none —</option>
            {availableDetachments.map(d => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </div>
      )}
      {/* Weapons section */}
      {allWeapons.length > 0 && (
        <div className="border-t border-gray-800">
          <button
            onClick={() => setWeaponsOpen(v => !v)}
            className="w-full text-left px-3 py-1.5 text-xs text-gray-500 hover:text-gray-300 transition-colors flex items-center gap-1"
          >
            <span>{weaponsOpen ? "▲" : "▼"}</span>
            <span>Weapons</span>
            {!weaponsOpen && (() => {
              const active = allWeapons.filter(w => (weaponCounts[w.name] ?? 0) > 0 && (weaponCounts[w.name] ?? 0) < unit.model_count);
              const absent = allWeapons.filter(w => (weaponCounts[w.name] ?? 0) === 0);
              if (absent.length === 0 && active.length === 0) return <span className="text-gray-700 ml-1">all ×{unit.model_count}</span>;
              return (
                <span className="text-gray-600 ml-1 truncate">
                  {allWeapons
                    .filter(w => (weaponCounts[w.name] ?? 0) > 0)
                    .map(w => `${w.name} ×${weaponCounts[w.name]}`)
                    .join(", ")}
                </span>
              );
            })()}
          </button>
          {weaponsOpen && (
            <div className="px-3 pb-3 space-y-3">
              {(["ranged", "melee"] as const).map(type => {
                const group = allWeapons.filter(w => w.type === type);
                if (group.length === 0) return null;
                return (
                  <div key={type}>
                    <div className={`text-xs font-bold uppercase mb-1.5 ${type === "ranged" ? "text-blue-400" : "text-red-400"}`}>
                      {type === "ranged" ? "Ranged" : "Melee"}
                    </div>
                    {group.map(w => {
                      const count = weaponCounts[w.name] ?? 0;
                      return (
                        <div key={w.name} className="flex items-center gap-2 py-1">
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              onClick={() => updateWeaponCount(w.name, count - 1)}
                              disabled={count <= 0}
                              className="w-6 h-6 bg-gray-700 hover:bg-gray-600 disabled:opacity-30 rounded text-white text-xs font-bold"
                            >−</button>
                            <span className={`w-6 text-center text-sm font-mono font-bold ${count > 0 ? "text-amber-400" : "text-gray-600"}`}>
                              {count}
                            </span>
                            <button
                              onClick={() => updateWeaponCount(w.name, count + 1)}
                              disabled={count >= unit.model_count}
                              className="w-6 h-6 bg-gray-700 hover:bg-gray-600 disabled:opacity-30 rounded text-white text-xs font-bold"
                            >+</button>
                          </div>
                          <div className="flex-1 min-w-0">
                            <span className={`text-xs ${count > 0 ? "text-gray-200" : "text-gray-600"}`}>{w.name}</span>
                          </div>
                          <span className="text-gray-600 text-xs font-mono shrink-0">
                            {w.attacks}A {w.strength}S {w.ap}AP {w.damage}D
                          </span>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
              <div className="flex gap-2 pt-1 border-t border-gray-800">
                <button
                  onClick={() => {
                    const full: Record<string, number> = {};
                    allWeapons.forEach(w => { full[w.name] = unit.model_count; });
                    setWeaponCounts(full);
                    onWeaponsChange(unit.id, null);
                  }}
                  className="text-xs text-gray-500 hover:text-white transition-colors"
                >
                  All ×{unit.model_count}
                </button>
                <button
                  onClick={() => {
                    const none: Record<string, number> = {};
                    allWeapons.forEach(w => { none[w.name] = 0; });
                    setWeaponCounts(none);
                    onWeaponsChange(unit.id, none);
                  }}
                  className="text-xs text-gray-500 hover:text-white transition-colors"
                >
                  Clear all
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      {/* Drones section */}
      {droneOptions && droneOptions.length > 0 && (
        <div className="border-t border-gray-800">
          <button
            onClick={() => setDronesOpen(v => !v)}
            className="w-full text-left px-3 py-1.5 text-xs text-gray-500 hover:text-gray-300 transition-colors flex items-center gap-1"
          >
            <span>{dronesOpen ? "▲" : "▼"}</span>
            <span>Drones</span>
            {!dronesOpen && (() => {
              const active = droneOptions.filter(d => (droneCounts[d.name] ?? 0) > 0);
              if (active.length === 0) return <span className="text-gray-700 ml-1">none</span>;
              return (
                <span className="text-gray-600 ml-1 truncate">
                  {active.map(d => `${d.name} ×${droneCounts[d.name]}`).join(", ")}
                </span>
              );
            })()}
          </button>
          {dronesOpen && (
            <div className="px-3 pb-3 space-y-1">
              <div className="text-xs font-bold uppercase mb-1.5 text-teal-400">Drones</div>
              {droneOptions.map(drone => {
                const maxCount = drone.perModel
                  ? drone.maxPerGroup * unit.model_count
                  : drone.maxPerGroup;
                const count = droneCounts[drone.name] ?? 0;
                return (
                  <div key={drone.name} className="flex items-center gap-2 py-1">
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => updateDroneCount(drone.name, count - 1, maxCount)}
                        disabled={count <= 0}
                        className="w-6 h-6 bg-gray-700 hover:bg-gray-600 disabled:opacity-30 rounded text-white text-xs font-bold"
                      >−</button>
                      <span className={`w-6 text-center text-sm font-mono font-bold ${count > 0 ? "text-teal-400" : "text-gray-600"}`}>
                        {count}
                      </span>
                      <button
                        onClick={() => updateDroneCount(drone.name, count + 1, maxCount)}
                        disabled={count >= maxCount}
                        className="w-6 h-6 bg-gray-700 hover:bg-gray-600 disabled:opacity-30 rounded text-white text-xs font-bold"
                      >+</button>
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className={`text-xs ${count > 0 ? "text-gray-200" : "text-gray-600"}`}>{drone.name}</span>
                    </div>
                    <span className="text-gray-600 text-xs shrink-0">
                      max {maxCount} {drone.perModel ? `(${drone.maxPerGroup}/model)` : "(leader)"}
                    </span>
                  </div>
                );
              })}
              <div className="flex gap-2 pt-1 border-t border-gray-800">
                <button
                  onClick={() => {
                    const none: Record<string, number> = {};
                    droneOptions.forEach(d => { none[d.name] = 0; });
                    setDroneCounts(none);
                    onDronesChange(unit.id, null);
                  }}
                  className="text-xs text-gray-500 hover:text-white transition-colors"
                >
                  Clear all
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function ArmyDetailPage() {
  const params = useParams();
  const router = useRouter();
  const armyId = params.id as string;

  const [army, setArmy] = useState<Army | null>(null);
  const [collection, setCollection] = useState<CollectionUnit[]>([]);
  const [loading, setLoading] = useState(true);
  const [unitSearch, setUnitSearch] = useState("");
  const [editingName, setEditingName] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPointLimit, setNewPointLimit] = useState(2000);
  const [startingMatch, setStartingMatch] = useState(false);
  const [cpStart, setCpStart] = useState(0);
  const [newSquadName, setNewSquadName] = useState("");
  const [creatingSquad, setCreatingSquad] = useState(false);
  const [editingSquadId, setEditingSquadId] = useState<number | null>(null);
  const [editingSquadName, setEditingSquadName] = useState("");
  const [showOtherFactions, setShowOtherFactions] = useState(false);
  const [collectionOpen, setCollectionOpen] = useState(true);

  const loadArmy = useCallback(async () => {
    const [armyRes, collRes] = await Promise.all([
      fetch(`/api/armies/${armyId}`),
      fetch("/api/units"),
    ]);
    const armyData = await armyRes.json();
    const collData = await collRes.json();
    setArmy(armyData);
    setNewName(armyData.name);
    setNewPointLimit(armyData.point_limit);
    setCollection(Array.isArray(collData) ? collData : []);
    setLoading(false);
  }, [armyId]);

  useEffect(() => {
    loadArmy();
  }, [loadArmy]);

  // Compute how many squad slots of a collection unit are already in this army
  function squadsInArmy(collUnitId: number): number {
    return (army?.units ?? []).filter((u) => u.unit_id === collUnitId).length;
  }

  function squadsAvailable(collUnit: CollectionUnit): number {
    return collUnit.quantity - squadsInArmy(collUnit.id);
  }

  async function handleAddUnit(unitId: number) {
    const cu = collection.find((c) => c.id === unitId);
    const avail = cu ? squadsAvailable(cu) : 0;
    if (avail <= 0) return;
    const stats: UnitStats | null = cu?.stats_json ? JSON.parse(cu.stats_json) : null;
    const validSizes = getValidSizes(stats);
    const defaultSize = validSizes.length > 0 ? validSizes[0] : 1;
    const res = await fetch(`/api/armies/${armyId}/units`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ unit_id: unitId, model_count: defaultSize }),
    });
    if (res.ok) await loadArmy();
  }

  async function handleRemoveUnit(armyUnitId: number) {
    await fetch(`/api/armies/${armyId}/units/${armyUnitId}`, { method: "DELETE" });
    setArmy((prev) =>
      prev ? { ...prev, units: prev.units.filter((u) => u.id !== armyUnitId) } : prev
    );
  }

  function putUnit(armyUnit: ArmyUnit, overrides: Partial<ArmyUnit> = {}) {
    const u = { ...armyUnit, ...overrides };
    return fetch(`/api/armies/${armyId}/units/${armyUnit.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model_count: u.model_count,
        custom_points: u.custom_points,
        squad_id: u.squad_id,
        selected_weapons: u.selected_weapons,
        selected_drones: u.selected_drones,
        label: u.label,
        detachment: u.detachment,
      }),
    });
  }

  async function handleSizeChange(armyUnit: ArmyUnit, size: number) {
    if (size === armyUnit.model_count || size < 1) return;
    await putUnit(armyUnit, { model_count: size });
    setArmy(prev =>
      prev ? { ...prev, units: prev.units.map(u => u.id === armyUnit.id ? { ...u, model_count: size } : u) } : prev
    );
  }

  async function handleAssignSquad(armyUnit: ArmyUnit, squadId: number | null) {
    await putUnit(armyUnit, { squad_id: squadId });
    setArmy((prev) =>
      prev
        ? { ...prev, units: prev.units.map((u) => u.id === armyUnit.id ? { ...u, squad_id: squadId } : u) }
        : prev
    );
  }

  async function handleWeaponsChange(armyUnitId: number, data: Record<string, number> | null) {
    const unit = army?.units.find(u => u.id === armyUnitId);
    if (!unit) return;
    const selected_weapons = data ? JSON.stringify(data) : null;
    await putUnit(unit, { selected_weapons });
    setArmy(prev => prev ? {
      ...prev,
      units: prev.units.map(u => u.id === armyUnitId ? { ...u, selected_weapons } : u)
    } : prev);
  }

  async function handleDronesChange(armyUnitId: number, data: Record<string, number> | null) {
    const unit = army?.units.find(u => u.id === armyUnitId);
    if (!unit) return;
    const selected_drones = data ? JSON.stringify(data) : null;
    await putUnit(unit, { selected_drones });
    setArmy(prev => prev ? {
      ...prev,
      units: prev.units.map(u => u.id === armyUnitId ? { ...u, selected_drones } : u)
    } : prev);
  }

  async function handleLabelChange(armyUnitId: number, label: string | null) {
    const unit = army?.units.find(u => u.id === armyUnitId);
    if (!unit) return;
    await putUnit(unit, { label });
    setArmy(prev => prev ? {
      ...prev,
      units: prev.units.map(u => u.id === armyUnitId ? { ...u, label } : u)
    } : prev);
  }

  async function handleDetachmentChange(armyUnitId: number, detachment: string | null) {
    const unit = army?.units.find(u => u.id === armyUnitId);
    if (!unit) return;
    await putUnit(unit, { detachment });
    setArmy(prev => prev ? {
      ...prev,
      units: prev.units.map(u => u.id === armyUnitId ? { ...u, detachment } : u)
    } : prev);
  }

  async function handleCreateSquad() {
    if (!newSquadName.trim()) return;
    const res = await fetch(`/api/armies/${armyId}/squads`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newSquadName.trim() }),
    });
    if (res.ok) {
      const squad: Squad = await res.json();
      setArmy((prev) => prev ? { ...prev, squads: [...prev.squads, squad] } : prev);
      setNewSquadName("");
      setCreatingSquad(false);
    }
  }

  async function handleRenameSquad(squadId: number) {
    if (!editingSquadName.trim()) return;
    const res = await fetch(`/api/armies/${armyId}/squads/${squadId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: editingSquadName.trim() }),
    });
    if (res.ok) {
      setArmy((prev) =>
        prev ? { ...prev, squads: prev.squads.map((s) => s.id === squadId ? { ...s, name: editingSquadName.trim() } : s) } : prev
      );
      setEditingSquadId(null);
    }
  }

  async function handleDeleteSquad(squadId: number) {
    await fetch(`/api/armies/${armyId}/squads/${squadId}`, { method: "DELETE" });
    setArmy((prev) =>
      prev
        ? {
            ...prev,
            squads: prev.squads.filter((s) => s.id !== squadId),
            units: prev.units.map((u) => u.squad_id === squadId ? { ...u, squad_id: null } : u),
          }
        : prev
    );
  }

  async function handleSaveArmy() {
    await fetch(`/api/armies/${armyId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName, point_limit: newPointLimit, faction: army?.faction ?? null }),
    });
    setArmy((prev) => prev ? { ...prev, name: newName, point_limit: newPointLimit } : prev);
    setEditingName(false);
  }

  async function handleStartMatch() {
    setStartingMatch(true);
    try {
      const res = await fetch("/api/matches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ army_id: parseInt(armyId), cp_start: cpStart }),
      });
      if (res.ok) {
        const match = await res.json();
        router.push(`/match/${match.id}`);
      }
    } finally {
      setStartingMatch(false);
    }
  }

  if (loading) return <div className="p-8 text-gray-400">Loading...</div>;
  if (!army) return <div className="p-8 text-gray-400">Army not found</div>;

  const totalPoints = army.units.reduce((sum, u) => sum + getUnitPoints(u, army.units), 0);
  const pct = Math.min(100, Math.round((totalPoints / army.point_limit) * 100));
  const overLimit = totalPoints > army.point_limit;

  const filteredCollection = collection.filter((u) => {
    const matchesSearch =
      !unitSearch ||
      u.name.toLowerCase().includes(unitSearch.toLowerCase()) ||
      (u.faction || "").toLowerCase().includes(unitSearch.toLowerCase());
    const matchesFaction =
      showOtherFactions || !army?.faction || (u.faction || "") === army.faction;
    return matchesSearch && matchesFaction;
  });

  const hasOtherFactions = collection.some(
    (u) => army?.faction && (u.faction || "") !== army.faction
  );

  // Group units: one group per squad, plus "Unassigned"
  const unassigned = army.units.filter((u) => u.squad_id === null);
  const squadGroups = army.squads.map((sq) => ({
    squad: sq,
    units: army.units.filter((u) => u.squad_id === sq.id),
  }));

  function renderUnitRows(units: ArmyUnit[]) {
    return units.map(unit => (
      <UnitRow
        key={unit.id}
        unit={unit}
        allArmyUnits={army!.units}
        squads={army!.squads}
        onSizeChange={handleSizeChange}
        onAssignSquad={handleAssignSquad}
        onRemove={handleRemoveUnit}
        onWeaponsChange={handleWeaponsChange}
        onDronesChange={handleDronesChange}
        onLabelChange={handleLabelChange}
        onDetachmentChange={handleDetachmentChange}
      />
    ));
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      {/* Army header */}
      <div className="mb-6">
        <Link href="/armies" className="text-gray-500 hover:text-gray-300 text-sm mb-2 block">
          ← Back to Armies
        </Link>
        {editingName ? (
          <div className="flex gap-2 items-center flex-wrap">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white text-xl font-bold focus:outline-none focus:border-amber-500"
            />
            <input
              type="number"
              value={newPointLimit}
              onChange={(e) => setNewPointLimit(parseInt(e.target.value) || 2000)}
              className="w-28 bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white focus:outline-none focus:border-amber-500"
              step={500}
            />
            <span className="text-gray-400 text-sm">pts limit</span>
            <button onClick={handleSaveArmy} className="bg-amber-600 hover:bg-amber-500 text-white px-3 py-2 rounded text-sm">Save</button>
            <button onClick={() => setEditingName(false)} className="bg-gray-700 hover:bg-gray-600 text-gray-300 px-3 py-2 rounded text-sm">Cancel</button>
          </div>
        ) : (
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-3xl font-bold text-amber-400">{army.name}</h1>
            <button onClick={() => setEditingName(true)} className="text-gray-500 hover:text-gray-300 text-sm">Edit</button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Collection search */}
        <div className="lg:col-span-1">
          <div className="bg-gray-900 border border-gray-800 rounded-lg lg:sticky lg:top-4">
            {/* Header — always visible, toggles panel on mobile */}
            <button
              onClick={() => setCollectionOpen(v => !v)}
              className="w-full flex items-center justify-between p-4 lg:cursor-default"
            >
              <div className="flex items-center gap-2">
                <h2 className="text-white font-bold uppercase text-sm tracking-wide">Add Units from Collection</h2>
                {army?.faction && (
                  <span className="text-xs bg-gray-800 border border-gray-700 text-amber-300 px-2 py-0.5 rounded">
                    {army.faction}
                  </span>
                )}
              </div>
              <span className="lg:hidden text-gray-500 text-xs">{collectionOpen ? "▲" : "▼"}</span>
            </button>

            {collectionOpen && (
              <div className="px-4 pb-4 border-t border-gray-800">
            <input
              type="text"
              value={unitSearch}
              onChange={(e) => setUnitSearch(e.target.value)}
              placeholder="Search collection..."
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white text-sm mt-3 mb-2 focus:outline-none focus:border-amber-500"
            />
            {hasOtherFactions && (
              <button
                onClick={() => setShowOtherFactions(v => !v)}
                className="mb-3 text-xs text-gray-500 hover:text-amber-400 transition-colors"
              >
                {showOtherFactions ? "▲ Show faction only" : "▼ Show other factions"}
              </button>
            )}
            {collection.length === 0 ? (
              <p className="text-gray-500 text-sm">
                No units in collection.{" "}
                <Link href="/collection" className="text-amber-400 hover:underline">Import some first.</Link>
              </p>
            ) : (
              <div className="space-y-2 max-h-[50vh] lg:max-h-[60vh] overflow-y-auto">
                {filteredCollection.map((u) => {
                  const stats: UnitStats | null = u.stats_json ? JSON.parse(u.stats_json) : null;
                  const avail = squadsAvailable(u);
                  const mfmTiers = stats?.mfm_tiers;
                  const hasMFMTiers = mfmTiers && mfmTiers.length > 0;

                  // Build a compact points label from MFM tiers
                  let ptsLabel = "";
                  if (hasMFMTiers) {
                    const primaryTier =
                      mfmTiers.find((t) => t.copies === "1st-2nd" || t.copies === "all") ??
                      mfmTiers[0];
                    if (primaryTier.entries.length === 1) {
                      ptsLabel = `${primaryTier.entries[0].points} pts`;
                    } else if (primaryTier.entries.length > 1) {
                      const sorted = [...primaryTier.entries].sort((a, b) => a.models - b.models);
                      ptsLabel = sorted.map((e) => `${e.models}m: ${e.points}`).join(" / ");
                    }
                    if (mfmTiers.length > 1) ptsLabel += " *";
                  } else if (stats?.points_per_model) {
                    ptsLabel = `${stats.points_per_model} pts/model`;
                  }

                  return (
                    <div key={u.id} className="flex items-center justify-between bg-gray-800 rounded p-2 gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="text-white text-sm font-medium truncate">{u.name}</div>
                        <div className="text-gray-400 text-xs flex gap-2 flex-wrap">
                          {u.faction && <span>{u.faction}</span>}
                          {ptsLabel && (
                            <span className={mfmTiers && mfmTiers.length > 1 ? "text-amber-400" : ""}>
                              {ptsLabel}
                            </span>
                          )}
                          <span className={avail <= 0 ? "text-red-400" : "text-green-400"}>
                            {avail}/{u.quantity} squads
                          </span>
                        </div>
                        {/* Show tiered pricing breakdown on hover/always for multi-tier units */}
                        {hasMFMTiers && mfmTiers.length > 1 && (
                          <div className="mt-0.5 text-xs text-gray-600 space-y-0.5">
                            {mfmTiers.map((tier) => (
                              <div key={tier.copies} className="flex gap-1 flex-wrap">
                                <span className="text-gray-600">
                                  {tier.copies === "1st-2nd" ? "1st–2nd:" : tier.copies === "3rd+" ? "3rd+:" : tier.copies === "2nd+" ? "2nd+:" : ""}
                                </span>
                                {tier.entries.map((e) => (
                                  <span key={e.models} className={tier.copies === "3rd+" || tier.copies === "2nd+" ? "text-orange-600" : "text-gray-500"}>
                                    {e.models}m/{e.points}
                                  </span>
                                ))}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                      <button
                        onClick={() => handleAddUnit(u.id)}
                        disabled={avail <= 0}
                        className="shrink-0 bg-red-700 hover:bg-red-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs px-2 py-1 rounded transition-colors"
                        title={avail <= 0 ? "No squads available" : `Add squad (${avail} left)`}
                      >
                        + Add
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
            </div>
            )}
          </div>
        </div>

        {/* Right: Army roster */}
        <div className="lg:col-span-2">
          {/* Points summary */}
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 mb-4">
            <div className="flex items-center justify-between mb-2">
              <div className={`text-2xl font-bold font-mono ${overLimit ? "text-red-400" : "text-green-400"}`}>
                {totalPoints} / {army.point_limit} pts
              </div>
              <span className="text-gray-400 text-sm">{army.units.length} units</span>
            </div>
            <div className="h-3 bg-gray-800 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${overLimit ? "bg-red-600" : "bg-green-600"}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            {overLimit && <p className="text-red-400 text-xs mt-1">Over limit by {totalPoints - army.point_limit} pts</p>}
          </div>

          {/* Squads management bar */}
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <span className="text-gray-400 text-sm">Units:</span>
            {army.squads.map((sq) => (
              <div key={sq.id} className="flex items-center gap-1">
                {editingSquadId === sq.id ? (
                  <>
                    <input
                      autoFocus
                      value={editingSquadName}
                      onChange={(e) => setEditingSquadName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") handleRenameSquad(sq.id); if (e.key === "Escape") setEditingSquadId(null); }}
                      className="bg-gray-800 border border-amber-500 rounded px-2 py-0.5 text-white text-xs focus:outline-none w-32"
                    />
                    <button onClick={() => handleRenameSquad(sq.id)} className="text-amber-400 text-xs hover:text-amber-300">✓</button>
                    <button onClick={() => setEditingSquadId(null)} className="text-gray-500 text-xs hover:text-gray-300">✕</button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => { setEditingSquadId(sq.id); setEditingSquadName(sq.name); }}
                      className="bg-gray-800 border border-gray-700 text-gray-300 text-xs px-2 py-0.5 rounded hover:border-amber-500 transition-colors"
                    >
                      {sq.name}
                    </button>
                    <button
                      onClick={() => handleDeleteSquad(sq.id)}
                      className="text-gray-600 hover:text-red-400 text-xs transition-colors"
                    >
                      ×
                    </button>
                  </>
                )}
              </div>
            ))}
            {creatingSquad ? (
              <div className="flex items-center gap-1">
                <input
                  autoFocus
                  value={newSquadName}
                  onChange={(e) => setNewSquadName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleCreateSquad(); if (e.key === "Escape") setCreatingSquad(false); }}
                  placeholder="Unit name..."
                  className="bg-gray-800 border border-amber-500 rounded px-2 py-0.5 text-white text-xs focus:outline-none w-36"
                />
                <button onClick={handleCreateSquad} className="text-amber-400 text-xs hover:text-amber-300">✓</button>
                <button onClick={() => setCreatingSquad(false)} className="text-gray-500 text-xs hover:text-gray-300">✕</button>
              </div>
            ) : (
              <button
                onClick={() => setCreatingSquad(true)}
                className="text-gray-500 hover:text-amber-400 text-xs border border-dashed border-gray-700 hover:border-amber-500 rounded px-2 py-0.5 transition-colors"
              >
                + New Unit
              </button>
            )}
          </div>

          {/* Army units grouped by squad */}
          {army.units.length === 0 ? (
            <div className="text-center py-12 text-gray-500">No units in this army yet. Add from the collection panel.</div>
          ) : (
            <div className="space-y-4 mb-4">
              {/* Named squads */}
              {squadGroups.map(({ squad, units }) => (
                units.length > 0 && (
                  <div key={squad.id}>
                    <h3 className="text-amber-300 text-xs font-bold uppercase tracking-wide mb-1 pl-1">{squad.name}</h3>
                    <div className="space-y-2 border-l-2 border-amber-800 pl-3">
                      {renderUnitRows(units)}
                    </div>
                  </div>
                )
              ))}
              {/* Unassigned */}
              {unassigned.length > 0 && (
                <div>
                  {army.squads.length > 0 && (
                    <h3 className="text-gray-500 text-xs font-bold uppercase tracking-wide mb-1 pl-1">Unassigned</h3>
                  )}
                  <div className="space-y-2">
                    {renderUnitRows(unassigned)}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Start match */}
          {army.units.length > 0 && (
            <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
              <h3 className="text-white font-bold mb-3">Start a Match</h3>
              <div className="flex items-center gap-3 flex-wrap">
                <div className="flex items-center gap-2">
                  <label className="text-gray-400 text-sm">Starting CP:</label>
                  <input
                    type="number"
                    value={cpStart}
                    onChange={(e) => setCpStart(parseInt(e.target.value) || 0)}
                    className="w-20 bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-white text-sm focus:outline-none focus:border-amber-500"
                    min={0}
                  />
                </div>
                <button
                  onClick={handleStartMatch}
                  disabled={startingMatch}
                  className="bg-red-700 hover:bg-red-600 disabled:opacity-50 text-white px-6 py-2 rounded font-medium transition-colors"
                >
                  {startingMatch ? "Starting..." : "Start Match"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
