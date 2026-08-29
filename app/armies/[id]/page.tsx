"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { UnitStats } from "@/lib/wahapedia";
import { selectPrimaryMFMTier } from "@/lib/mfm";
import { resolveUnitPoints as computeUnitPoints } from "@/lib/points";
import { normalizeFactionName } from "@/lib/text";
import StatBlock from "@/components/StatBlock";
import { GlossaryModalContext, useGlossaryModalState } from "@/components/Glossary";

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
  detachment_id: number | null;
  enhancement_id: number | null;
  enhancement_name?: string | null;
  enhancement_points?: number | null;
  enhancement_description?: string | null;
  name: string;
  faction: string | null;
  stats_json: string | null;
  owned_models: number;
}

interface Enhancement {
  id: number;
  detachment_id: number;
  name: string;
  points: number;
  description: string;
}

interface Detachment {
  id: number;
  faction_id: number;
  name: string;
  dp_cost: number;
  unique_tag: string | null;
  force_disposition: string | null;
  rule_name: string | null;
  rule_text: string | null;
  enhancements?: Enhancement[];
}

interface BattleSize {
  id: number;
  name: string;
  points: number;
  dp_budget: number;
  enhancement_limit: number;
}

interface Army {
  id: number;
  name: string;
  faction: string | null;
  faction_id: number | null;
  point_limit: number;
  is_owner: boolean;
  owner_username: string;
  units: ArmyUnit[];
  squads: Squad[];
  detachments: Detachment[];
}

interface Faction {
  id: number;
  name: string;
  army_rule_name: string | null;
  army_rule_text: string | null;
}

interface StratagemRow {
  id: number;
  name: string;
  cp: string;
  type: string;
  legend: string;
  when_text: string;
  target_text: string;
  effect_text: string;
  restrictions: string | null;
}

interface StratagemGroups {
  core: StratagemRow[];
  faction: StratagemRow[];
  byDetachment: Record<number, StratagemRow[]>;
}

interface ShareEntry {
  id: number;
  shared_with: number;
  shared_with_username: string;
}

interface ShareUser {
  id: number;
  username: string;
}

// Compact expand/collapse stratagem card for the army-builder's detachment breakout.
// (The match page has its own richer version that also highlights "usable now" based
// on the current phase/turn — not relevant while building a list.)
function DetachmentStratagemCard({ s }: { s: StratagemRow }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="bg-gray-800 rounded overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full text-left px-2 py-1 flex items-center gap-2"
      >
        <span className="bg-gray-700 border border-gray-600 text-amber-300 text-[10px] px-1 py-0.5 rounded font-mono font-bold shrink-0">
          {s.cp}
        </span>
        <span className="text-white text-xs font-bold flex-1">{s.name}</span>
        <span className="text-gray-500 text-xs shrink-0">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="px-2 pb-2 space-y-1 border-t border-gray-700">
          {s.type && <div className="text-gray-400 text-[11px] italic pt-1">{s.type}</div>}
          {s.when_text && (
            <div className="text-[11px]"><span className="text-amber-400 font-bold">WHEN: </span><span className="text-gray-300">{s.when_text}</span></div>
          )}
          {s.target_text && (
            <div className="text-[11px]"><span className="text-amber-400 font-bold">TARGET: </span><span className="text-gray-300">{s.target_text}</span></div>
          )}
          {s.effect_text && (
            <div className="text-[11px]"><span className="text-amber-400 font-bold">EFFECT: </span><span className="text-gray-300">{s.effect_text}</span></div>
          )}
          {s.restrictions && (
            <div className="text-[11px]"><span className="text-amber-400 font-bold">RESTRICTIONS: </span><span className="text-gray-300">{s.restrictions}</span></div>
          )}
        </div>
      )}
    </div>
  );
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

// Breaks a unit's cost into base / wargear / enhancement for display, via the
// shared lib/points helper so the builder, army-list totals and export agree.
function resolveUnitPoints(
  unit: ArmyUnit,
  allUnits: ArmyUnit[]
): {
  points: number;
  base: number;
  wargear: number;
  enhancement: number;
  tierLabel: string | null;
  copyIndex: number;
  hasTiers: boolean;
} {
  const copyIndex = getCopyIndex(unit, allUnits);
  const r = computeUnitPoints({
    stats: parseStats(unit),
    modelCount: unit.model_count,
    copyIndex,
    customPoints: unit.custom_points,
    selectedWeapons: unit.selected_weapons,
    enhancementPoints: unit.enhancement_points ?? null,
  });
  return {
    points: r.total,
    base: r.base,
    wargear: r.wargear,
    enhancement: r.enhancement,
    tierLabel: r.tierLabel,
    copyIndex,
    hasTiers: r.hasTiers,
  };
}

function getUnitPoints(unit: ArmyUnit, allUnits: ArmyUnit[] = []): number {
  return resolveUnitPoints(unit, allUnits).points;
}

function getValidSizes(stats: UnitStats | null): number[] {
  if (!stats) return [];
  if (Array.isArray(stats.mfm_tiers) && stats.mfm_tiers.length > 0) {
    const primary = selectPrimaryMFMTier(stats.mfm_tiers);
    if (primary.entries.length > 0)
      return [...primary.entries].sort((a, b) => a.models - b.models).map(e => e.models);
  }
  if (Array.isArray(stats.points_table) && stats.points_table.length > 0)
    return [...stats.points_table].sort((a, b) => a.models - b.models).map(e => e.models);
  return [];
}

// Some models can carry more than one copy of the same named weapon (e.g. a Crisis
// Battlesuit built with 3 fusion blasters, or a Devilfish's 2 twin pulse carbines).
// The per-weapon max/default below is parsed from wargear_options text — the same
// array parseDroneOptions reads — falling back to "1 copy per model" (today's
// behavior) wherever nothing recognizable is found, so this only ever raises caps,
// never lowers them below what already worked.
interface WeaponMultiplicity {
  maxPerModel: Record<string, number>;
  defaultPerModel: Record<string, number>;
}

const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
function wordToNumber(word: string): number {
  return NUMBER_WORDS[word.toLowerCase()] ?? (parseInt(word, 10) || 1);
}

// Matches a wargear-option weapon phrase (e.g. "1 fusion blaster", "smart missile
// systems") against the unit's real weapon profile names, tolerating the trailing
// qualifiers Wahapedia sometimes appends (" – standard", footnote asterisks, etc.).
function findWeaponByName(text: string, allWeapons: { name: string }[]): string | null {
  const clean = text.replace(/[*.]+$/g, "").replace(/\s*\(.*\)/g, "").trim().toLowerCase();
  if (!clean) return null;
  return (
    allWeapons.find(w => w.name.toLowerCase() === clean)?.name ??
    allWeapons.find(w => w.name.toLowerCase().startsWith(clean))?.name ??
    allWeapons.find(w => clean.startsWith(w.name.toLowerCase()))?.name ??
    null
  );
}

function parseWeaponMultiplicity(wargearOptions: string[], allWeapons: { name: string }[]): WeaponMultiplicity {
  const maxPerModel: Record<string, number> = {};
  const defaultPerModel: Record<string, number> = {};
  const raiseMax = (name: string | null, n: number) => {
    if (name && n > (maxPerModel[name] ?? 1)) maxPerModel[name] = n;
  };

  // Multiplier for the current "up to N of the following, and can take duplicates"
  // block — applies to every bullet until the next top-level line resets it.
  let sectionMax = 1;

  for (const line of wargearOptions) {
    const isBullet = /^\s*•/.test(line);

    if (isBullet) {
      // Bullets are scraped as "<count> <weapon name>" (e.g. "1 fusion blaster",
      // "2 accelerator burst cannons") — the leading count times the section's
      // duplicate multiplier is how many copies of that weapon a model can end up with.
      const m = line.match(/•\s*(\d+)\s+(.+)/);
      if (m) raiseMax(findWeaponByName(m[2], allWeapons), parseInt(m[1], 10) * sectionMax);
      continue;
    }

    const listHeader = line.match(/up to (\w+) of the following/i);
    if (listHeader) {
      const allowsDuplicates = /can take duplicate/i.test(line) && !/cannot take duplicate/i.test(line);
      sectionMax = allowsDuplicates ? wordToNumber(listHeader[1]) : 1;
      continue;
    }
    sectionMax = 1;

    // "This model can be equipped with up to 2 seeker missiles."
    const singleUpTo = line.match(/up to (\w+)\s+([a-z' -]+?)s?\.?\s*$/i);
    if (singleUpTo) raiseMax(findWeaponByName(singleUpTo[2], allWeapons), wordToNumber(singleUpTo[1]));

    // "This model's 2 twin pulse carbines can be replaced with 2 smart missile systems."
    const replace = line.match(/(\d+)\s+([a-z' -]+?)s\s+can be replaced with\s+(\d+|a|one|two|three|four)\s+([a-z' -]+?)s?\.?\s*$/i);
    if (replace) {
      const baseWeapon = findWeaponByName(replace[2], allWeapons);
      const baseCount = parseInt(replace[1], 10);
      raiseMax(baseWeapon, baseCount);
      if (baseWeapon) defaultPerModel[baseWeapon] = Math.max(defaultPerModel[baseWeapon] ?? 1, baseCount);
      raiseMax(findWeaponByName(replace[4], allWeapons), wordToNumber(replace[3]));
      continue;
    }

    // "This model's 2 twin pulse carbines can be replaced with one of the following:"
    // — same base-weapon declaration, but the replacement options are bullets below.
    const replaceListHeader = line.match(/(\d+)\s+([a-z' -]+?)s\s+can be replaced with one of the following/i);
    if (replaceListHeader) {
      const baseWeapon = findWeaponByName(replaceListHeader[2], allWeapons);
      const baseCount = parseInt(replaceListHeader[1], 10);
      raiseMax(baseWeapon, baseCount);
      if (baseWeapon) defaultPerModel[baseWeapon] = Math.max(defaultPerModel[baseWeapon] ?? 1, baseCount);
    }
  }

  return { maxPerModel, defaultPerModel };
}

// Parse selected_weapons JSON into weapon→count map.
// Handles both legacy string[] and new Record<string,number> format.
function parseWeaponCounts(
  selectedWeapons: string | null,
  allWeapons: { name: string }[],
  modelCount: number,
  defaultPerModel: Record<string, number> = {}
): Record<string, number> {
  const defaults: Record<string, number> = {};
  allWeapons.forEach(w => { defaults[w.name] = modelCount * (defaultPerModel[w.name] ?? 1); });
  if (!selectedWeapons) return defaults;
  try {
    const parsed = JSON.parse(selectedWeapons);
    if (Array.isArray(parsed)) {
      // Legacy: string[] of selected weapon names → count = default for selected, 0 for others
      const sel = new Set(parsed as string[]);
      const result: Record<string, number> = {};
      allWeapons.forEach(w => { result[w.name] = sel.has(w.name) ? defaults[w.name] : 0; });
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

  const addDrone = (name: string, maxPerGroup: number, perModel: boolean) => {
    if (!seen.has(name)) {
      seen.add(name);
      result.push({ name, maxPerGroup, perModel });
    }
  };

  for (const line of wargearOptions) {
    // Format 1: bullet point — "  • 1 gun drone"
    const bulletMatch = line.match(/•\s*\d+\s+(.+?drone)\b/i);
    if (bulletMatch) {
      const name = bulletMatch[1].replace(/\s*\(.*\)/g, "").trim()
        .replace(/\b\w/g, c => c.toUpperCase());
      const noDuplicate = /cannot take duplicates/i.test(line);
      addDrone(name, noDuplicate ? 1 : sectionMax, sectionPerModel);
      continue;
    }

    // Format 2: inline sentence — "The Shas'vre can be equipped with 1 gun drone."
    const sentenceMatch = line.match(/can be equipped with (\d+)\s+(.+?drone)\b/i);
    if (sentenceMatch) {
      const count = parseInt(sentenceMatch[1]) || 1;
      const name = sentenceMatch[2].replace(/\s*\(.*\)/g, "").trim()
        .replace(/\b\w/g, c => c.toUpperCase());
      // If the line references "models" it's per-model; specific named models = leader only
      const perModel = /\bmodels\b/i.test(line) && !/shas'?v?re?\b|shas'?ui\b/i.test(line);
      addDrone(name, count, perModel);
      continue;
    }

    // Context line — update section defaults for the bullet format
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
  armyDetachments: Detachment[];
  onSizeChange: (unit: ArmyUnit, size: number) => void;
  onAssignSquad: (unit: ArmyUnit, squadId: number | null) => void;
  onRemove: (id: number) => void;
  onWeaponsChange: (unitId: number, data: Record<string, number> | null) => void;
  onDronesChange: (unitId: number, data: Record<string, number> | null) => void;
  onLabelChange: (unitId: number, label: string | null) => void;
  onDetachmentChange: (unitId: number, detachmentId: number | null) => void;
  factionDetachments: Detachment[];
  onEnhancementChange: (unit: ArmyUnit, enhancementId: number | null) => void;
  enhancementConflict: boolean;
}

function UnitRow({
  unit,
  allArmyUnits,
  squads,
  armyDetachments,
  onSizeChange,
  onAssignSquad,
  onRemove,
  onWeaponsChange,
  onDronesChange,
  onLabelChange,
  onDetachmentChange,
  factionDetachments,
  onEnhancementChange,
  enhancementConflict,
}: UnitRowProps) {
  const [weaponsOpen, setWeaponsOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const [labelValue, setLabelValue] = useState(unit.label ?? "");
  const labelRef = useRef(unit.label);

  const stats: UnitStats | null = unit.stats_json ? JSON.parse(unit.stats_json) : null;
  const allWeapons = stats?.weapons ?? [];
  const droneOptions = parseDroneOptions(stats?.wargear_options ?? []);
  const weaponMultiplicity = parseWeaponMultiplicity(stats?.wargear_options ?? [], allWeapons);
  // How many total copies of this weapon the unit can field / starts with by default —
  // usually 1 per model, but some models can carry (or start with) more than one copy.
  const weaponMaxCount = (name: string) =>
    unit.model_count * Math.max(weaponMultiplicity.maxPerModel[name] ?? 1, weaponMultiplicity.defaultPerModel[name] ?? 1);
  const weaponDefaultCount = (name: string) => unit.model_count * (weaponMultiplicity.defaultPerModel[name] ?? 1);

  const isCharacter = (stats?.keywords ?? []).some(k => k.toUpperCase() === "CHARACTER");
  const enhancementOptions =
    factionDetachments.find(d => d.id === unit.detachment_id)?.enhancements ?? [];
  const mfmWargear = stats?.mfm_wargear ?? [];
  const wargearCostFor = (weaponName: string) => {
    const opt = mfmWargear.find(w => {
      const a = w.weapon.toLowerCase().replace(/[^a-z0-9]/g, "");
      const b = weaponName.toLowerCase().replace(/[^a-z0-9]/g, "");
      return a === b || a.startsWith(b) || b.startsWith(a);
    });
    return opt?.points ?? 0;
  };

  const [weaponCounts, setWeaponCounts] = useState<Record<string, number>>(() =>
    parseWeaponCounts(unit.selected_weapons, allWeapons, unit.model_count, weaponMultiplicity.defaultPerModel)
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
        const max = weaponMaxCount(w.name);
        if ((clamped[w.name] ?? 0) > max) {
          clamped[w.name] = max;
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
    const newCounts = { ...weaponCounts, [weaponName]: Math.max(0, Math.min(weaponMaxCount(weaponName), count)) };
    setWeaponCounts(newCounts);
    // Pass null if everything is at default loadout
    const isDefault = allWeapons.every(w => (newCounts[w.name] ?? 0) === weaponDefaultCount(w.name));
    onWeaponsChange(unit.id, isDefault ? null : newCounts);
  }

  function updateDroneCount(droneName: string, count: number, maxCount: number) {
    const newCounts = { ...droneCounts, [droneName]: Math.max(0, Math.min(maxCount, count)) };
    setDroneCounts(newCounts);
    const isEmpty = Object.values(newCounts).every(v => v === 0);
    onDronesChange(unit.id, isEmpty ? null : newCounts);
  }

  const { points: pts, wargear: wargearPts, enhancement: enhancementPts, tierLabel, hasTiers } = resolveUnitPoints(unit, allArmyUnits);
  const validSizes = getValidSizes(stats);
  const isInvalidSize = validSizes.length > 0 && !validSizes.includes(unit.model_count);

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
          {(wargearPts > 0 || enhancementPts > 0) && (
            <div className="text-gray-500 text-xs">
              {[
                wargearPts > 0 ? `+${wargearPts} wargear` : null,
                enhancementPts > 0 ? `+${enhancementPts} enh` : null,
              ].filter(Boolean).join(" · ")}
            </div>
          )}
          {!hasTiers && wargearPts === 0 && enhancementPts === 0 && stats?.points_per_model && (
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
      {armyDetachments.length > 0 && (
        <div className="border-t border-gray-800 px-3 py-1.5 flex items-center gap-2">
          <span className="text-gray-500 text-xs shrink-0">Detachment:</span>
          <select
            value={unit.detachment_id ?? ""}
            onChange={e => onDetachmentChange(unit.id, e.target.value ? parseInt(e.target.value, 10) : null)}
            className="flex-1 bg-gray-800 border border-gray-700 rounded px-2 py-0.5 text-xs text-white focus:outline-none focus:border-amber-500"
          >
            <option value="">— none —</option>
            {armyDetachments.map(d => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </div>
      )}
      {/* Enhancement selector — CHARACTER units only */}
      {isCharacter && armyDetachments.length > 0 && (
        <div className="border-t border-gray-800 px-3 py-1.5 flex items-center gap-2 flex-wrap">
          <span className="text-gray-500 text-xs shrink-0">Enhancement:</span>
          <select
            value={unit.enhancement_id ?? ""}
            disabled={!unit.detachment_id}
            onChange={e => onEnhancementChange(unit, e.target.value ? parseInt(e.target.value, 10) : null)}
            className="flex-1 min-w-40 bg-gray-800 border border-gray-700 rounded px-2 py-0.5 text-xs text-white focus:outline-none focus:border-amber-500 disabled:opacity-50"
          >
            <option value="">— none —</option>
            {enhancementOptions.map(e => (
              <option key={e.id} value={e.id}>{e.name} +{e.points}pts</option>
            ))}
          </select>
          {!unit.detachment_id && (
            <span className="text-gray-600 text-xs">pick a detachment first</span>
          )}
          {enhancementConflict && (
            <span className="text-amber-500 text-xs" title="This enhancement is on more than one unit">
              ⚠ used more than once
            </span>
          )}
        </div>
      )}
      {/* Weapons + Drones section */}
      {(allWeapons.length > 0 || (droneOptions && droneOptions.length > 0)) && (
        <div className="border-t border-gray-800">
          <button
            onClick={() => setWeaponsOpen(v => !v)}
            className="w-full text-left px-3 py-1.5 text-xs text-gray-500 hover:text-gray-300 transition-colors flex items-center gap-1"
          >
            <span>{weaponsOpen ? "▲" : "▼"}</span>
            <span>Loadout</span>
            {!weaponsOpen && (
              <span className="text-gray-700 ml-1 truncate">
                {[
                  ...allWeapons
                    .filter((w, i, arr) => arr.findIndex(x => x.name === w.name) === i)
                    .filter(w => (weaponCounts[w.name] ?? 0) !== weaponDefaultCount(w.name))
                    .map(w => `${w.name} ×${weaponCounts[w.name] ?? 0}`),
                  ...(droneOptions ?? [])
                    .filter(d => (droneCounts[d.name] ?? 0) > 0)
                    .map(d => `${d.name} ×${droneCounts[d.name]}`),
                ].join(", ") || "default loadout"}
              </span>
            )}
          </button>
          {weaponsOpen && (
            <div className="px-3 pb-3 space-y-3">
              {/* Weapons */}
              {(["ranged", "melee"] as const).map(type => {
                // One control per weapon — multi-profile weapons (e.g. a pulse
                // blast cannon with focused/dispersed) share a name and are
                // selected as a unit; their profiles show in the stat block.
                const group = allWeapons.filter(
                  (w, i, arr) => w.type === type && arr.findIndex(x => x.name === w.name) === i
                );
                if (group.length === 0) return null;
                return (
                  <div key={type}>
                    <div className={`text-xs font-bold uppercase mb-1.5 ${type === "ranged" ? "text-blue-400" : "text-red-400"}`}>
                      {type === "ranged" ? "Ranged" : "Melee"}
                    </div>
                    {group.map(w => {
                      const count = weaponCounts[w.name] ?? 0;
                      const max = weaponMaxCount(w.name);
                      const profiles = allWeapons.filter(x => x.name === w.name && x.profile).map(x => x.profile);
                      const wgCost = wargearCostFor(w.name);
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
                              disabled={count >= max}
                              className="w-6 h-6 bg-gray-700 hover:bg-gray-600 disabled:opacity-30 rounded text-white text-xs font-bold"
                            >+</button>
                          </div>
                          <div className="flex-1 min-w-0">
                            <span className={`text-xs ${count > 0 ? "text-gray-200" : "text-gray-600"}`}>{w.name}</span>
                            {profiles.length > 0 && (
                              <span className="text-gray-600 text-xs ml-1">({profiles.join(" / ")})</span>
                            )}
                            {wgCost > 0 && (
                              <span className={`text-xs ml-1 ${count > 0 ? "text-amber-500" : "text-gray-600"}`}>
                                +{wgCost}pts{count > 0 ? ` ×${count} = ${wgCost * count}` : " ea"}
                              </span>
                            )}
                          </div>
                          {max > unit.model_count && (
                            <span className="text-gray-600 text-xs shrink-0" title="Max copies for this unit">/{max}</span>
                          )}
                          {profiles.length === 0 && (
                            <span className="text-gray-600 text-xs font-mono shrink-0">
                              {w.attacks}A {w.strength}S {w.ap}AP {w.damage}D
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
              {/* Weapons quick-set */}
              {allWeapons.length > 0 && (
                <div className="flex gap-2 pt-1 border-t border-gray-800">
                  <button
                    onClick={() => {
                      const full: Record<string, number> = {};
                      allWeapons.forEach(w => { full[w.name] = weaponDefaultCount(w.name); });
                      setWeaponCounts(full);
                      onWeaponsChange(unit.id, null);
                    }}
                    className="text-xs text-gray-500 hover:text-white transition-colors"
                  >
                    Default loadout
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
              )}
              {/* Drones */}
              {droneOptions && droneOptions.length > 0 && (
                <div className="pt-1 border-t border-gray-800">
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
                  <div className="flex gap-2 pt-1 border-t border-gray-800 mt-1">
                    <button
                      onClick={() => {
                        const none: Record<string, number> = {};
                        droneOptions.forEach(d => { none[d.name] = 0; });
                        setDroneCounts(none);
                        onDronesChange(unit.id, null);
                      }}
                      className="text-xs text-gray-500 hover:text-white transition-colors"
                    >
                      Clear drones
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
      {/* Full Stats */}
      {stats && (
        <div className="border-t border-gray-800">
          <button
            onClick={() => setStatsOpen(v => !v)}
            className="w-full text-left px-3 py-1.5 text-xs text-gray-500 hover:text-gray-300 transition-colors flex items-center gap-1"
          >
            <span>{statsOpen ? "▲" : "▼"}</span>
            <span>Full Stats</span>
          </button>
          {statsOpen && (
            <div className="px-3 pb-3">
              <StatBlock stats={stats} selectedWeapons={unit.selected_weapons ? JSON.parse(unit.selected_weapons) : undefined} />
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

  const { contextValue: glossaryOpen, modal: glossaryModal } = useGlossaryModalState();
  const [army, setArmy] = useState<Army | null>(null);
  const [collection, setCollection] = useState<CollectionUnit[]>([]);
  const [loading, setLoading] = useState(true);
  const [unitSearch, setUnitSearch] = useState("");
  const [editingName, setEditingName] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPointLimit, setNewPointLimit] = useState("");
  const [startingMatch, setStartingMatch] = useState(false);
  const [cpStart, setCpStart] = useState(0);
  const [newSquadName, setNewSquadName] = useState("");
  const [creatingSquad, setCreatingSquad] = useState(false);
  const [editingSquadId, setEditingSquadId] = useState<number | null>(null);
  const [editingSquadName, setEditingSquadName] = useState("");
  const [showOtherFactions, setShowOtherFactions] = useState(false);
  const [collectionOpen, setCollectionOpen] = useState(true);
  const [factionDetachments, setFactionDetachments] = useState<Detachment[]>([]);
  const [battleSizes, setBattleSizes] = useState<BattleSize[]>([]);
  const [addDetachmentId, setAddDetachmentId] = useState("");
  const [detachmentError, setDetachmentError] = useState("");
  const [addingDetachment, setAddingDetachment] = useState(false);
  const [showDetachmentDetails, setShowDetachmentDetails] = useState(false);
  const [allFactions, setAllFactions] = useState<Faction[]>([]);
  const [editFactionId, setEditFactionId] = useState("");
  const [linkFactionId, setLinkFactionId] = useState("");
  const [linkingFaction, setLinkingFaction] = useState(false);
  const [stratagemGroups, setStratagemGroups] = useState<StratagemGroups | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [shares, setShares] = useState<ShareEntry[]>([]);
  const [shareUsers, setShareUsers] = useState<ShareUser[]>([]);
  const [sharingWith, setSharingWith] = useState("");

  const loadArmy = useCallback(async () => {
    const [armyRes, collRes, battleSizesRes, factionsRes] = await Promise.all([
      fetch(`/api/armies/${armyId}`),
      fetch("/api/units"),
      fetch("/api/battle-sizes"),
      fetch("/api/factions"),
    ]);
    const armyData = await armyRes.json();
    if (armyRes.ok && armyData.is_owner === false) {
      // Non-owners only ever get read-only access — send them straight to the
      // export view instead of the interactive builder (which has no per-control
      // ownership gating).
      router.replace(`/armies/${armyId}/export`);
      return;
    }
    const collData = await collRes.json();
    setArmy(armyData);
    setNewName(armyData.name);
    setNewPointLimit(String(armyData.point_limit));
    setEditFactionId(armyData.faction_id ? String(armyData.faction_id) : "");
    setCollection(Array.isArray(collData) ? collData : []);
    setBattleSizes(battleSizesRes.ok ? await battleSizesRes.json() : []);
    setAllFactions(factionsRes.ok ? await factionsRes.json() : []);
    if (armyData.faction_id) {
      const detRes = await fetch(`/api/detachments?faction_id=${armyData.faction_id}`);
      setFactionDetachments(detRes.ok ? await detRes.json() : []);
    } else {
      setFactionDetachments([]);
    }
    setLoading(false);
  }, [armyId, router]);

  useEffect(() => {
    loadArmy();
  }, [loadArmy]);

  async function openSharePanel() {
    setShareOpen(true);
    const [sharesRes, usersRes] = await Promise.all([
      fetch(`/api/armies/${armyId}/share`),
      fetch("/api/users/list"),
    ]);
    setShares(sharesRes.ok ? await sharesRes.json() : []);
    setShareUsers(usersRes.ok ? await usersRes.json() : []);
  }

  async function addShare(sharedWith: number) {
    const res = await fetch(`/api/armies/${armyId}/share`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shared_with: sharedWith }),
    });
    if (res.ok) {
      const entry: ShareEntry = await res.json();
      setShares((prev) => [...prev, entry]);
    }
  }

  async function removeShare(shareId: number) {
    await fetch(`/api/armies/${armyId}/share`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ share_id: shareId }),
    });
    setShares((prev) => prev.filter((s) => s.id !== shareId));
  }

  const detachmentIdsKey = army?.detachments.map(d => d.id).join(",") ?? "";

  useEffect(() => {
    const factionId = army?.faction_id;
    const params = new URLSearchParams({ faction_id: String(factionId ?? "") });
    if (detachmentIdsKey) params.set("detachment_ids", detachmentIdsKey);
    (factionId ? fetch(`/api/stratagems?${params.toString()}`) : Promise.resolve(null))
      .then(r => (r && r.ok ? r.json() : null))
      .then(setStratagemGroups);
  }, [army?.faction_id, detachmentIdsKey]);

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
        detachment_id: u.detachment_id,
        enhancement_id: u.enhancement_id,
      }),
    });
  }

  async function handleEnhancementChange(armyUnit: ArmyUnit, enhancementId: number | null) {
    const enh = enhancementId
      ? factionDetachments
          .flatMap(d => d.enhancements ?? [])
          .find(e => e.id === enhancementId)
      : null;
    await putUnit(armyUnit, { enhancement_id: enhancementId });
    setArmy(prev => prev ? {
      ...prev,
      units: prev.units.map(u => u.id === armyUnit.id ? {
        ...u,
        enhancement_id: enhancementId,
        enhancement_name: enh?.name ?? null,
        enhancement_points: enh?.points ?? null,
        enhancement_description: enh?.description ?? null,
      } : u),
    } : prev);
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

  async function handleDetachmentChange(armyUnitId: number, detachmentId: number | null) {
    const unit = army?.units.find(u => u.id === armyUnitId);
    if (!unit) return;
    // An assigned enhancement belongs to the old detachment — drop it on change.
    const keepEnhancement =
      unit.enhancement_id != null &&
      (factionDetachments.find(d => d.id === detachmentId)?.enhancements ?? []).some(e => e.id === unit.enhancement_id);
    const enhancement_id = keepEnhancement ? unit.enhancement_id : null;
    await putUnit(unit, { detachment_id: detachmentId, enhancement_id });
    setArmy(prev => prev ? {
      ...prev,
      units: prev.units.map(u => u.id === armyUnitId ? {
        ...u,
        detachment_id: detachmentId,
        enhancement_id,
        ...(enhancement_id === null ? { enhancement_name: null, enhancement_points: null, enhancement_description: null } : {}),
      } : u)
    } : prev);
  }

  async function handleAddDetachment() {
    if (!addDetachmentId) return;
    setAddingDetachment(true);
    setDetachmentError("");
    try {
      const res = await fetch(`/api/armies/${armyId}/detachments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ detachment_id: parseInt(addDetachmentId, 10) }),
      });
      if (res.ok) {
        setAddDetachmentId("");
        await loadArmy();
      } else {
        setDetachmentError((await res.json()).error ?? "Failed to add detachment");
      }
    } finally {
      setAddingDetachment(false);
    }
  }

  async function handleRemoveDetachment(detachmentId: number) {
    await fetch(`/api/armies/${armyId}/detachments`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ detachment_id: detachmentId }),
    });
    await loadArmy();
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
    const selectedFaction = allFactions.find((f) => String(f.id) === editFactionId);
    await fetch(`/api/armies/${armyId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: newName,
        point_limit: parseInt(newPointLimit, 10) || army?.point_limit || 2000,
        faction: selectedFaction?.name ?? army?.faction ?? null,
        faction_id: selectedFaction?.id ?? null,
      }),
    });
    setEditingName(false);
    await loadArmy();
  }

  async function handleLinkFaction() {
    if (!linkFactionId) return;
    const selectedFaction = allFactions.find((f) => String(f.id) === linkFactionId);
    if (!selectedFaction) return;
    setLinkingFaction(true);
    try {
      await fetch(`/api/armies/${armyId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: army?.name,
          point_limit: army?.point_limit,
          faction: selectedFaction.name,
          faction_id: selectedFaction.id,
        }),
      });
      setLinkFactionId("");
      await loadArmy();
    } finally {
      setLinkingFaction(false);
    }
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

  const eligibleBattleSizes = [...battleSizes].sort((a, b) => a.points - b.points).filter(b => b.points <= army.point_limit);
  const battleSize = eligibleBattleSizes.length > 0 ? eligibleBattleSizes[eligibleBattleSizes.length - 1] : battleSizes[0];
  const dpUsed = army.detachments.reduce((sum, d) => sum + d.dp_cost, 0);
  const dpBudget = battleSize?.dp_budget ?? null;
  // Core rules exception: at Incursion (2 DP), you can take a single 3 DP detachment
  // as your only detachment even though it exceeds the normal budget — so a first pick
  // is never blocked by DP cost alone; only a second+ pick must fit the real budget.
  const soloDetachmentException = army.detachments.length === 0;
  const addableDetachments = factionDetachments.filter(d => {
    if (army.detachments.some(sel => sel.id === d.id)) return false;
    if (d.unique_tag && army.detachments.some(sel => sel.unique_tag === d.unique_tag)) return false;
    if (!soloDetachmentException && dpBudget !== null && dpUsed + d.dp_cost > dpBudget) return false;
    return true;
  });

  const filteredCollection = collection.filter((u) => {
    const matchesSearch =
      !unitSearch ||
      u.name.toLowerCase().includes(unitSearch.toLowerCase()) ||
      (u.faction || "").toLowerCase().includes(unitSearch.toLowerCase());
    const matchesFaction =
      showOtherFactions || !army?.faction || normalizeFactionName(u.faction || "") === normalizeFactionName(army.faction);
    return matchesSearch && matchesFaction;
  });

  const hasOtherFactions = collection.some(
    (u) => army?.faction && normalizeFactionName(u.faction || "") !== normalizeFactionName(army.faction)
  );

  // Group units: one group per squad, plus "Unassigned"
  const unassigned = army.units.filter((u) => u.squad_id === null);
  const squadGroups = army.squads.map((sq) => ({
    squad: sq,
    units: army.units.filter((u) => u.squad_id === sq.id),
  }));

  const enhancementUsage = new Map<number, number>();
  for (const u of army.units) {
    if (u.enhancement_id) enhancementUsage.set(u.enhancement_id, (enhancementUsage.get(u.enhancement_id) ?? 0) + 1);
  }

  function renderUnitRows(units: ArmyUnit[]) {
    return units.map(unit => (
      <UnitRow
        key={unit.id}
        unit={unit}
        allArmyUnits={army!.units}
        squads={army!.squads}
        armyDetachments={army!.detachments}
        onSizeChange={handleSizeChange}
        onAssignSquad={handleAssignSquad}
        onRemove={handleRemoveUnit}
        onWeaponsChange={handleWeaponsChange}
        onDronesChange={handleDronesChange}
        onLabelChange={handleLabelChange}
        onDetachmentChange={handleDetachmentChange}
        factionDetachments={factionDetachments}
        onEnhancementChange={handleEnhancementChange}
        enhancementConflict={!!unit.enhancement_id && (enhancementUsage.get(unit.enhancement_id) ?? 0) > 1}
      />
    ));
  }

  return (
    <GlossaryModalContext.Provider value={glossaryOpen}>
    <div className="max-w-7xl mx-auto px-4 py-8">
      {/* Army header */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <Link href="/armies" className="text-gray-500 hover:text-gray-300 text-sm">
            ← Back to Armies
          </Link>
          <div className="flex gap-2">
            <button
              onClick={openSharePanel}
              className="text-xs bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 px-3 py-1 rounded transition-colors"
            >
              Share
            </button>
            <Link
              href={`/armies/${armyId}/export`}
              className="text-xs bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 px-3 py-1 rounded transition-colors"
            >
              Export / Print
            </Link>
          </div>
        </div>
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
              onChange={(e) => setNewPointLimit(e.target.value)}
              className="w-28 bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white focus:outline-none focus:border-amber-500"
              step={500}
            />
            <span className="text-gray-400 text-sm">pts limit</span>
            {allFactions.length > 0 && (
              <select
                value={editFactionId}
                onChange={(e) => setEditFactionId(e.target.value)}
                className="bg-gray-800 border border-gray-700 rounded px-3 py-2 text-gray-300 text-sm focus:outline-none focus:border-amber-500"
              >
                <option value="">No linked faction</option>
                {allFactions.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            )}
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
                    const primaryTier = selectPrimaryMFMTier(mfmTiers);
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
            {(() => {
              const enhancedCount = army.units.filter(u => u.enhancement_id).length;
              const limit = battleSize?.enhancement_limit ?? null;
              if (limit === null || enhancedCount <= limit) return null;
              return (
                <p className="text-amber-500 text-xs mt-1">
                  ⚠ {enhancedCount} enhancements assigned — {battleSize?.name} allows {limit}
                </p>
              );
            })()}
          </div>

          {/* Detachments */}
          {army.faction_id ? (
            <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 mb-4">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-white font-bold uppercase text-sm tracking-wide">Detachments</h2>
                {dpBudget !== null && (
                  <span className={`font-mono text-sm font-bold ${dpUsed > dpBudget && army.detachments.length > 1 ? "text-red-400" : "text-green-400"}`}>
                    {dpUsed} / {dpBudget} DP {battleSize ? `(${battleSize.name})` : ""}
                    {dpUsed > dpBudget && army.detachments.length === 1 && (
                      <span className="text-gray-500 font-normal text-xs ml-1">(solo detachment exception)</span>
                    )}
                  </span>
                )}
              </div>

              {(() => {
                const linkedFaction = allFactions.find(f => f.id === army.faction_id);
                if (!linkedFaction?.army_rule_name) return null;
                return (
                  <div className="bg-gray-800/60 border border-gray-700 rounded p-3 mb-3">
                    <div className="text-amber-400 font-bold text-xs uppercase mb-1">Army Rule — {linkedFaction.army_rule_name}</div>
                    <div className="text-gray-300 text-xs">{linkedFaction.army_rule_text}</div>
                  </div>
                );
              })()}

              {army.detachments.length > 0 && (
                <>
                  <div className="flex flex-wrap gap-2 mb-2">
                    {army.detachments.map(d => (
                      <div key={d.id} className="flex items-center gap-1.5 bg-gray-800 border border-gray-700 rounded px-2 py-1">
                        <span className="text-white text-sm">{d.name}</span>
                        <span className="text-amber-400 text-xs font-mono">{d.dp_cost}DP</span>
                        {d.unique_tag && (
                          <span className="text-gray-500 text-xs border border-gray-700 rounded px-1">{d.unique_tag}</span>
                        )}
                        <button
                          onClick={() => handleRemoveDetachment(d.id)}
                          className="text-gray-600 hover:text-red-400 text-xs ml-1"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>

                  <button
                    onClick={() => setShowDetachmentDetails(v => !v)}
                    className="text-xs text-gray-500 hover:text-amber-400 transition-colors mb-3"
                  >
                    {showDetachmentDetails ? "▲ Hide" : "▼ Show"} detachment rules, enhancements &amp; stratagems
                  </button>

                  {showDetachmentDetails && (
                    <div className="space-y-3 mb-3">
                      {army.detachments.map(d => {
                        const full = factionDetachments.find(fd => fd.id === d.id);
                        const stratagems = stratagemGroups?.byDetachment[d.id] ?? [];
                        return (
                          <div key={d.id} className="bg-gray-800/60 border border-gray-700 rounded p-3">
                            <div className="text-white font-bold text-sm mb-1">
                              {d.name}
                              {d.force_disposition && (
                                <span className="text-gray-500 font-normal text-xs ml-2">{d.force_disposition}</span>
                              )}
                            </div>
                            {d.rule_name && (
                              <div className="text-xs mb-2">
                                <span className="text-amber-400 font-bold">{d.rule_name}: </span>
                                <span className="text-gray-300">{d.rule_text}</span>
                              </div>
                            )}
                            {full && full.enhancements && full.enhancements.length > 0 && (
                              <div className="space-y-1 mb-2">
                                <div className="text-gray-500 text-xs font-bold uppercase">Enhancements</div>
                                {full.enhancements.map(e => {
                                  const on = army.units.filter(u => u.enhancement_id === e.id).map(u => u.label?.trim() || u.name);
                                  return (
                                    <div key={e.id} className="text-xs">
                                      <span className="text-white font-medium">{e.name}</span>
                                      <span className="text-amber-400 font-mono ml-1">{e.points}pts</span>
                                      {on.length > 0 && <span className="text-green-400 ml-1">· on {on.join(", ")}</span>}
                                      {e.description && <span className="text-gray-500 ml-1">— {e.description}</span>}
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                            {stratagems.length > 0 && (
                              <div className="space-y-1">
                                <div className="text-gray-500 text-xs font-bold uppercase">Stratagems ({stratagems.length})</div>
                                {stratagems.map(s => (
                                  <DetachmentStratagemCard key={s.id} s={s} />
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              )}

              {factionDetachments.length === 0 ? (
                <p className="text-gray-500 text-xs">
                  No detachments synced for this faction yet. An admin can sync it from the Admin page.
                </p>
              ) : (
                <div className="flex gap-2 items-center flex-wrap">
                  <select
                    value={addDetachmentId}
                    onChange={(e) => setAddDetachmentId(e.target.value)}
                    className="flex-1 min-w-48 bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-white text-sm focus:outline-none focus:border-amber-500"
                  >
                    <option value="">Select a detachment to add…</option>
                    {addableDetachments.map(d => (
                      <option key={d.id} value={d.id}>{d.name} — {d.dp_cost}DP</option>
                    ))}
                  </select>
                  <button
                    onClick={handleAddDetachment}
                    disabled={!addDetachmentId || addingDetachment}
                    className="bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white px-3 py-1.5 rounded text-sm font-medium transition-colors"
                  >
                    {addingDetachment ? "Adding…" : "+ Add"}
                  </button>
                </div>
              )}
              {detachmentError && <p className="text-red-400 text-xs mt-2">{detachmentError}</p>}
            </div>
          ) : (
            <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 mb-4">
              <h2 className="text-white font-bold uppercase text-sm tracking-wide mb-2">Detachments</h2>
              {allFactions.length === 0 ? (
                <p className="text-gray-500 text-xs">
                  No factions synced yet. An admin can sync one (e.g. your army&apos;s faction) from the Admin page —
                  then link it here to select detachments and track Detachment Points.
                </p>
              ) : (
                <>
                  <p className="text-gray-500 text-xs mb-2">
                    Link this army to a synced faction to select detachments and track Detachment Points.
                  </p>
                  <div className="flex gap-2 items-center flex-wrap">
                    <select
                      value={linkFactionId}
                      onChange={(e) => setLinkFactionId(e.target.value)}
                      className="flex-1 min-w-48 bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-white text-sm focus:outline-none focus:border-amber-500"
                    >
                      <option value="">Select a faction…</option>
                      {allFactions.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                    </select>
                    <button
                      onClick={handleLinkFaction}
                      disabled={!linkFactionId || linkingFaction}
                      className="bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white px-3 py-1.5 rounded text-sm font-medium transition-colors"
                    >
                      {linkingFaction ? "Linking…" : "Link Faction"}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

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

      {/* Share panel */}
      {shareOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 border border-gray-700 rounded-lg w-full max-w-md">
            <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between">
              <h3 className="text-white font-bold text-sm">Share Army (read-only)</h3>
              <button
                onClick={() => { setShareOpen(false); setShares([]); setSharingWith(""); }}
                className="text-gray-500 hover:text-white text-lg leading-none"
              >×</button>
            </div>
            <div className="p-4 space-y-4">
              <div>
                <p className="text-gray-400 text-xs uppercase font-bold mb-2">Shared with</p>
                {shares.length === 0 ? (
                  <p className="text-gray-600 text-sm">Not shared yet.</p>
                ) : (
                  <div className="space-y-1">
                    {shares.map((s) => (
                      <div key={s.id} className="flex items-center justify-between bg-gray-800 rounded px-3 py-2">
                        <span className="text-white text-sm">{s.shared_with_username}</span>
                        <button
                          onClick={() => removeShare(s.id)}
                          className="text-gray-600 hover:text-red-400 text-xs"
                        >Remove</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <p className="text-gray-400 text-xs uppercase font-bold mb-2">Add share</p>
                <div className="flex gap-2">
                  <select
                    value={sharingWith}
                    onChange={(e) => setSharingWith(e.target.value)}
                    className="flex-1 bg-gray-800 border border-gray-700 rounded px-2 py-2 text-white text-sm focus:outline-none focus:border-amber-500"
                  >
                    <option value="">— pick recipient —</option>
                    {shareUsers
                      .filter((u) => !shares.some((s) => s.shared_with === u.id))
                      .map((u) => (
                        <option key={u.id} value={u.id}>{u.username}</option>
                      ))}
                  </select>
                  <button
                    disabled={!sharingWith}
                    onClick={() => { addShare(parseInt(sharingWith)); setSharingWith(""); }}
                    className="bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white text-sm px-3 py-2 rounded"
                  >
                    Share
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {glossaryModal}
    </div>
    </GlossaryModalContext.Provider>
  );
}
