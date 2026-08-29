"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import StatBlock from "@/components/StatBlock";
import { UnitStats, WeaponProfile, weaponLabel } from "@/lib/wahapedia";
import { GLOSSARY, GlossaryModalContext, GlossaryModal, Linkified } from "@/components/Glossary";

interface MatchUnit {
  id: number;
  match_id: number;
  army_unit_id: number;
  unit_name: string;
  max_wounds: number;
  current_wounds: number;
  is_destroyed: number;
  stats_json: string | null;
  faction: string | null;
  squad_id: number | null;
  squad_name: string | null;
  selected_weapons: string | null;
  selected_drones: string | null;
  model_count: number;
  detachment_id: number | null;
  enhancement_id: number | null;
  enhancement_name: string | null;
  enhancement_points: number | null;
  enhancement_description: string | null;
}

interface StratagemRow {
  id: number;
  scope: "core" | "faction" | "detachment";
  faction_id: number | null;
  detachment_id: number | null;
  name: string;
  cp: string;
  type: string;
  legend: string;
  when_text: string;
  target_text: string;
  effect_text: string;
  restrictions: string | null;
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
}

interface BattleSize {
  id: number;
  name: string;
  points: number;
  dp_budget: number;
  enhancement_limit: number;
}

interface StratagemGroups {
  core: StratagemRow[];
  faction: StratagemRow[];
  byDetachment: Record<number, StratagemRow[]>;
}

interface Enhancement {
  id: number;
  detachment_id: number;
  name: string;
  points: number;
  description: string;
}

interface Faction {
  id: number;
  name: string;
  army_rule_name: string | null;
  army_rule_text: string | null;
}

// Static ability descriptions for common T'au drone types
const DRONE_ABILITIES: Record<string, string> = {
  "Gun Drone":      "Twin pulse carbine: 18\", A2, 5+, S5, AP0, D1",
  "Shield Drone":   "4+ invulnerable save",
  "Marker Drone":   "Markerlight — each hit adds a Markerlight token to the target",
  "Guardian Drone": "+1 to armour saving throws for models in the bearer's unit",
  "Missile Drone":  "Missile pod: 36\", A2, 4+, S7, AP-1, D2",
}

interface Match {
  id: number;
  army_id: number;
  army_name: string | null;
  faction: string | null;
  faction_id: number | null;
  opponent: string | null;
  started_at: number;
  ended_at: number | null;
  cp_start: number;
  cp_current: number;
  vp: number;
  vp_opponent: number;
  round: number;
  phase: string;
  active_player: string;
  notes: string | null;
  point_limit: number | null;
  units: MatchUnit[];
  detachments: Detachment[];
}

// ─── Sidebar: weapons ────────────────────────────────────────────────────────

function WeaponsSidebar({ units }: { units: MatchUnit[] }) {
  const activeUnits = units.filter(u => u.is_destroyed === 0 && u.stats_json);
  if (activeUnits.length === 0) return null;

  // Deduplicate by army_unit_id: the match creates one row per model, but weapons
  // are stored per squad on the army unit. Count each army unit's weapons once.
  const byArmyUnit = new Map<number, MatchUnit>();
  for (const unit of activeUnits) {
    if (!byArmyUnit.has(unit.army_unit_id)) byArmyUnit.set(unit.army_unit_id, unit);
  }

  // Aggregate weapons across unique army units: name → { profile, total count }
  const weaponMap = new Map<string, { weapon: WeaponProfile; count: number }>();
  for (const unit of byArmyUnit.values()) {
    const stats: UnitStats = JSON.parse(unit.stats_json!);
    const parsedSW = unit.selected_weapons ? JSON.parse(unit.selected_weapons) : null;
    // weaponCountMap values are squad totals (e.g. {"Pulse Rifle": 8}).
    // Legacy string[] format is converted using model_count so each selected weapon = full squad.
    const weaponCountMap: Record<string, number> | null = parsedSW
      ? Array.isArray(parsedSW)
        ? Object.fromEntries((parsedSW as string[]).map(n => [n, unit.model_count]))
        : (parsedSW as Record<string, number>)
      : null;
    const weapons = weaponCountMap
      ? stats.weapons.filter(w => (weaponCountMap[w.name] ?? 0) > 0)
      : stats.weapons;
    for (const w of weapons) {
      // Use the stored count directly — it's already the total for the squad.
      // Fall back to model_count when no selection has been saved. Selection is
      // keyed on the base weapon name, but each firing profile gets its own row.
      const count = weaponCountMap ? (weaponCountMap[w.name] ?? 0) : unit.model_count;
      if (count <= 0) continue;
      const key = weaponLabel(w);
      const entry = weaponMap.get(key);
      if (entry) entry.count += count;
      else weaponMap.set(key, { weapon: w, count });
    }
  }

  if (weaponMap.size === 0) return null;

  const ranged = Array.from(weaponMap.values()).filter(e => e.weapon.type === "ranged");
  const melee  = Array.from(weaponMap.values()).filter(e => e.weapon.type === "melee");

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
      <div className="px-3 py-2 border-b border-gray-800 bg-gray-800">
        <h3 className="text-amber-400 text-xs font-bold uppercase tracking-wide">Weapons</h3>
      </div>
      <div className="px-3 py-2 overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr>
              <th className="text-left text-gray-500 text-[10px] pb-1 pr-2">#  Weapon</th>
              <th className="text-gray-500 text-[10px] pb-1 px-1 text-center">Rng</th>
              <th className="text-gray-500 text-[10px] pb-1 px-1 text-center">A</th>
              <th className="text-gray-500 text-[10px] pb-1 px-1 text-center">BS/WS</th>
              <th className="text-gray-500 text-[10px] pb-1 px-1 text-center">S</th>
              <th className="text-gray-500 text-[10px] pb-1 px-1 text-center">AP</th>
              <th className="text-gray-500 text-[10px] pb-1 px-1 text-center">D</th>
            </tr>
          </thead>
          <tbody>
            {ranged.length > 0 && (
              <>
                <tr><td colSpan={7} className="text-blue-400 text-[10px] font-bold uppercase pt-1 pb-0.5">Ranged</td></tr>
                {ranged.map(({ weapon: w, count }) => (
                  <tr key={weaponLabel(w)} className="border-t border-gray-800/60">
                    <td className="py-0.5 pr-2">
                      <div className="flex items-center gap-1">
                        <span className="text-amber-400 text-[11px] font-bold font-mono shrink-0">{count}×</span>
                        <span className="text-white text-xs">{weaponLabel(w)}</span>
                      </div>
                      {w.abilities && (
                        <div className="flex flex-wrap gap-0.5 mt-0.5 pl-5">
                          {w.abilities.split(", ").map((ab, i) => (
                            <span key={i} className="text-amber-300 text-[10px] bg-gray-700 px-1 rounded"><Linkified text={ab} /></span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="text-gray-400 text-[11px] text-center font-mono px-1">{w.range}</td>
                    <td className="text-gray-300 text-[11px] text-center font-mono px-1">{w.attacks}</td>
                    <td className="text-gray-300 text-[11px] text-center font-mono px-1">{w.bsWs}</td>
                    <td className="text-gray-300 text-[11px] text-center font-mono px-1">{w.strength}</td>
                    <td className="text-gray-300 text-[11px] text-center font-mono px-1">{w.ap}</td>
                    <td className="text-gray-300 text-[11px] text-center font-mono px-1">{w.damage}</td>
                  </tr>
                ))}
              </>
            )}
            {melee.length > 0 && (
              <>
                <tr><td colSpan={7} className="text-red-400 text-[10px] font-bold uppercase pt-2 pb-0.5">Melee</td></tr>
                {melee.map(({ weapon: w, count }) => (
                  <tr key={weaponLabel(w)} className="border-t border-gray-800/60">
                    <td className="py-0.5 pr-2">
                      <div className="flex items-center gap-1">
                        <span className="text-amber-400 text-[11px] font-bold font-mono shrink-0">{count}×</span>
                        <span className="text-white text-xs">{weaponLabel(w)}</span>
                      </div>
                      {w.abilities && (
                        <div className="flex flex-wrap gap-0.5 mt-0.5 pl-5">
                          {w.abilities.split(", ").map((ab, i) => (
                            <span key={i} className="text-amber-300 text-[10px] bg-gray-700 px-1 rounded"><Linkified text={ab} /></span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="text-gray-400 text-[11px] text-center font-mono px-1">—</td>
                    <td className="text-gray-300 text-[11px] text-center font-mono px-1">{w.attacks}</td>
                    <td className="text-gray-300 text-[11px] text-center font-mono px-1">{w.bsWs}</td>
                    <td className="text-gray-300 text-[11px] text-center font-mono px-1">{w.strength}</td>
                    <td className="text-gray-300 text-[11px] text-center font-mono px-1">{w.ap}</td>
                    <td className="text-gray-300 text-[11px] text-center font-mono px-1">{w.damage}</td>
                  </tr>
                ))}
              </>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Sidebar: stratagems ─────────────────────────────────────────────────────

function isUsableNow(when: string, phase: string, activePlayer: string): boolean {
  const w = when.toLowerCase();
  const p = phase.toLowerCase();
  if (!w.includes(p) && !w.includes("any phase")) return false;
  // Only check the player qualifier in the timing clause (text before the first comma),
  // not in the condition body which often contains "your army", "you make", etc.
  const timing = w.split(",")[0];
  if (timing.includes("your opponent")) return activePlayer === "opponent";
  if (timing.includes("your ")) return activePlayer === "mine";
  return true;
}

function StratagemCard({ s, usable }: { s: StratagemRow; usable: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`rounded overflow-hidden border-l-2 ${usable ? "bg-green-950 border-green-500" : "bg-gray-800 border-transparent"}`}>
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full text-left px-2 py-1.5 flex items-center gap-2 transition-colors"
      >
        <span className={`border text-xs px-1.5 py-0.5 rounded font-mono font-bold shrink-0 ${usable ? "bg-green-900 border-green-600 text-green-300" : "bg-gray-700 border-gray-600 text-amber-300"}`}>
          {s.cp}
        </span>
        <span className={`text-xs font-bold flex-1 text-left ${usable ? "text-green-100" : "text-white"}`}>{s.name}</span>
        {usable && <span className="text-green-400 text-[10px] font-bold shrink-0 uppercase tracking-wide">Now</span>}
        <span className="text-gray-500 text-xs shrink-0">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className={`px-2 pb-2 border-t space-y-1 ${usable ? "border-green-900" : "border-gray-700"}`}>
          {s.type && <div className="text-gray-400 text-xs italic pt-1">{s.type}</div>}
          {s.legend && <div className="text-gray-500 text-[11px] italic">{s.legend}</div>}
          {s.when_text && (
            <div className="text-xs">
              <span className="text-amber-400 font-bold">WHEN: </span>
              <span className="text-gray-300"><Linkified text={s.when_text} /></span>
            </div>
          )}
          {s.target_text && (
            <div className="text-xs">
              <span className="text-amber-400 font-bold">TARGET: </span>
              <span className="text-gray-300"><Linkified text={s.target_text} /></span>
            </div>
          )}
          {s.effect_text && (
            <div className="text-xs">
              <span className="text-amber-400 font-bold">EFFECT: </span>
              <span className="text-gray-300"><Linkified text={s.effect_text} /></span>
            </div>
          )}
          {s.restrictions && (
            <div className="text-xs">
              <span className="text-amber-400 font-bold">RESTRICTIONS: </span>
              <span className="text-gray-300"><Linkified text={s.restrictions} /></span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Stratagems tab ──────────────────────────────────────────────────────────

function StratagemSection({
  title, stratagems, enhancements, search, phase, activePlayer,
}: {
  title: string;
  stratagems: StratagemRow[];
  enhancements?: Enhancement[];
  search: string;
  phase: string;
  activePlayer: string;
}) {
  const filtered = search
    ? stratagems.filter(s =>
        s.name.toLowerCase().includes(search.toLowerCase()) ||
        (s.effect_text && s.effect_text.toLowerCase().includes(search.toLowerCase()))
      )
    : stratagems;
  if (filtered.length === 0 && !enhancements?.length) return null;

  const usable = filtered.filter(s => s.when_text && isUsableNow(s.when_text, phase, activePlayer));
  const other  = filtered.filter(s => !s.when_text || !isUsableNow(s.when_text, phase, activePlayer));
  const sorted = [...usable, ...other];

  return (
    <div className="mb-4">
      <h3 className="text-amber-300 text-xs font-bold uppercase tracking-wide mb-2 flex items-center gap-2">
        {title}
        <span className="text-gray-500 normal-case font-normal">({filtered.length})</span>
        {usable.length > 0 && (
          <span className="text-green-400 normal-case font-normal">{usable.length} available now</span>
        )}
      </h3>
      {enhancements && enhancements.length > 0 && (
        <div className="mb-2 space-y-1">
          {enhancements.map(e => (
            <div key={e.id} className="bg-gray-800/60 rounded px-2 py-1 text-xs">
              <span className="text-white font-medium">{e.name}</span>
              <span className="text-amber-400 font-mono ml-1">{e.points}pts</span>
              {e.description && <span className="text-gray-500 ml-1">— {e.description}</span>}
            </div>
          ))}
        </div>
      )}
      <div className="space-y-1">
        {sorted.map(s => (
          <StratagemCard key={s.id} s={s} usable={s.when_text ? isUsableNow(s.when_text, phase, activePlayer) : false} />
        ))}
      </div>
    </div>
  );
}

// ─── Detachment tab ───────────────────────────────────────────────────────────

function DetachmentTab({
  detachments, enhancementsByDetachment, assignedEnhancements, armyFaction,
}: {
  detachments: Detachment[];
  enhancementsByDetachment: Record<number, Enhancement[]>;
  assignedEnhancements: Record<number, string[]>;
  armyFaction: Faction | null;
}) {
  if (detachments.length === 0 && !armyFaction?.army_rule_name) {
    return (
      <div className="text-gray-500 text-center py-16">
        No detachments selected for this army. Pick one on the army&apos;s page.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {armyFaction?.army_rule_name && (
        <div className="bg-gray-900 border border-amber-800 rounded-lg p-4">
          <div className="text-amber-400 font-bold text-xs uppercase tracking-wide mb-1">
            Army Rule — {armyFaction.army_rule_name}
          </div>
          <div className="text-gray-300 text-sm"><Linkified text={armyFaction.army_rule_text} /></div>
        </div>
      )}
      {detachments.map(d => (
        <div key={d.id} className="bg-gray-900 border border-gray-800 rounded-lg p-4">
          <div className="flex items-center gap-2 flex-wrap mb-2">
            <h3 className="text-white font-bold text-base">{d.name}</h3>
            <span className="text-amber-400 text-xs font-mono bg-gray-800 border border-gray-700 rounded px-1.5 py-0.5">{d.dp_cost}DP</span>
            {d.unique_tag && (
              <span className="text-gray-400 text-xs border border-gray-700 rounded px-1.5 py-0.5">{d.unique_tag}</span>
            )}
            {d.force_disposition && (
              <span className="text-gray-500 text-xs">{d.force_disposition}</span>
            )}
          </div>

          {d.rule_name && (
            <div className="text-sm mb-3">
              <span className="text-amber-400 font-bold">{d.rule_name}: </span>
              <span className="text-gray-300"><Linkified text={d.rule_text} /></span>
            </div>
          )}

          {(enhancementsByDetachment[d.id]?.length ?? 0) > 0 && (
            <div>
              <div className="text-gray-500 text-xs font-bold uppercase mb-1">Enhancements</div>
              <div className="space-y-1.5">
                {enhancementsByDetachment[d.id].map(e => {
                  const on = assignedEnhancements[e.id] ?? [];
                  return (
                    <div key={e.id} className={`rounded p-2 text-xs ${on.length ? "bg-amber-950/50 border border-amber-800/60" : "bg-gray-800"}`}>
                      <span className="text-white font-medium">{e.name}</span>
                      <span className="text-amber-400 font-mono ml-1">{e.points}pts</span>
                      {on.length > 0 && <span className="text-green-400 ml-1">· on {on.join(", ")}</span>}
                      {e.description && <div className="text-gray-400 mt-0.5"><Linkified text={e.description} /></div>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Stratagems tab ──────────────────────────────────────────────────────────

function StrategemsTab({
  groups, detachments, enhancementsByDetachment, phase, activePlayer,
}: {
  groups: StratagemGroups | null;
  detachments: Detachment[];
  enhancementsByDetachment: Record<number, Enhancement[]>;
  phase: string;
  activePlayer: string;
}) {
  const [search, setSearch] = useState("");

  if (!groups) {
    return <div className="text-gray-500 text-center py-16">Loading stratagems…</div>;
  }

  const total = groups.core.length + groups.faction.length +
    Object.values(groups.byDetachment).reduce((sum, arr) => sum + arr.length, 0);

  if (total === 0) {
    return (
      <div className="text-gray-500 text-center py-16">
        No stratagems found. Sync this army&apos;s faction from the Admin page, or select a detachment on the army page.
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search stratagems..."
          className="flex-1 max-w-xs bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-white focus:outline-none focus:border-amber-500"
        />
        <span className="text-gray-500 text-xs shrink-0">{total} total</span>
      </div>

      <StratagemSection title="Core" stratagems={groups.core} search={search} phase={phase} activePlayer={activePlayer} />
      <StratagemSection title="Faction" stratagems={groups.faction} search={search} phase={phase} activePlayer={activePlayer} />
      {detachments.map(d => (
        <StratagemSection
          key={d.id}
          title={d.name}
          stratagems={groups.byDetachment[d.id] ?? []}
          enhancements={enhancementsByDetachment[d.id] ?? []}
          search={search}
          phase={phase}
          activePlayer={activePlayer}
        />
      ))}
    </div>
  );
}

// ─── Unit card ───────────────────────────────────────────────────────────────

function UnitCard({
  unit,
  onWoundChange,
  onDestroyed,
}: {
  unit: MatchUnit;
  onWoundChange: (id: number, wounds: number) => void;
  onDestroyed: (id: number, destroyed: boolean) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const stats: UnitStats | null = unit.stats_json ? JSON.parse(unit.stats_json) : null;
  const woundPct = unit.max_wounds > 0 ? (unit.current_wounds / unit.max_wounds) * 100 : 0;
  const isDestroyed = unit.is_destroyed === 1;

  let woundBarColor = "bg-green-600";
  if (woundPct <= 25) woundBarColor = "bg-red-600";
  else if (woundPct <= 50) woundBarColor = "bg-yellow-600";

  return (
    <div
      className={`bg-gray-900 border rounded-lg overflow-hidden transition-opacity ${
        isDestroyed ? "border-red-900 opacity-60" : "border-gray-800"
      }`}
    >
      <div className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              {isDestroyed && (
                <span className="bg-red-900 text-red-300 text-xs px-2 py-0.5 rounded font-medium">
                  DESTROYED
                </span>
              )}
              <h3 className={`font-bold text-base leading-tight ${isDestroyed ? "line-through text-gray-500" : "text-white"}`}>
                {unit.unit_name}
              </h3>
            </div>
            {unit.selected_weapons && (
              <p className="text-amber-400 text-xs mt-0.5">
                {(() => {
                  const sw = JSON.parse(unit.selected_weapons);
                  if (Array.isArray(sw)) return (sw as string[]).join(" · ");
                  return Object.entries(sw as Record<string, number>)
                    .filter(([, n]) => n > 0)
                    .map(([name, n]) => `${name} ×${n}`)
                    .join(" · ");
                })()}
              </p>
            )}
            {unit.selected_drones && (() => {
              const drones = Object.entries(JSON.parse(unit.selected_drones) as Record<string, number>)
                .filter(([, n]) => n > 0);
              if (drones.length === 0) return null;
              return (
                <p className="text-teal-400 text-xs mt-0.5">
                  {drones.map(([name, n]) => `${name} ×${n}`).join(" · ")}
                </p>
              );
            })()}
            {unit.enhancement_name && (
              <div className="mt-1 text-xs bg-amber-950/60 border border-amber-800/60 rounded px-2 py-1">
                <span className="text-amber-300 font-bold">🛡 {unit.enhancement_name}</span>
                {unit.enhancement_description && (
                  <span className="text-gray-300"> — <Linkified text={unit.enhancement_description} /></span>
                )}
              </div>
            )}
          </div>
          <button
            onClick={() => onDestroyed(unit.id, !isDestroyed)}
            className={`shrink-0 text-xs px-2 py-1 rounded transition-colors ${
              isDestroyed
                ? "bg-gray-700 hover:bg-gray-600 text-gray-300"
                : "bg-red-900 hover:bg-red-800 text-red-200"
            }`}
          >
            {isDestroyed ? "Restore" : "Destroy"}
          </button>
        </div>

        {!isDestroyed && (
          <div className="mt-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-gray-400 text-xs font-medium">WOUNDS</span>
              <span className="text-white font-mono text-sm font-bold">
                {unit.current_wounds} / {unit.max_wounds}
              </span>
            </div>
            <div className="h-3 bg-gray-800 rounded-full overflow-hidden mb-2">
              <div className={`h-full rounded-full transition-all ${woundBarColor}`} style={{ width: `${woundPct}%` }} />
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => onWoundChange(unit.id, unit.current_wounds - 1)}
                disabled={unit.current_wounds <= 0}
                className="w-10 h-10 bg-red-800 hover:bg-red-700 disabled:opacity-30 disabled:cursor-not-allowed rounded-lg text-white font-bold text-xl transition-colors"
              >
                −
              </button>
              <div className="flex-1 flex justify-center">
                <span className="text-white font-mono text-2xl font-bold">{unit.current_wounds}</span>
              </div>
              <button
                onClick={() => onWoundChange(unit.id, unit.current_wounds + 1)}
                disabled={unit.current_wounds >= unit.max_wounds}
                className="w-10 h-10 bg-green-800 hover:bg-green-700 disabled:opacity-30 disabled:cursor-not-allowed rounded-lg text-white font-bold text-xl transition-colors"
              >
                +
              </button>
            </div>
          </div>
        )}
      </div>

      {stats && (
        <>
          <button
            onClick={() => setExpanded(!expanded)}
            className="w-full border-t border-gray-800 px-4 py-2 text-left text-xs text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
          >
            {expanded ? "▲ Hide Stats" : "▼ Show Stats"}
          </button>
          {expanded && (
            <div className="border-t border-gray-800 p-4 space-y-4">
              <StatBlock stats={stats} selectedWeapons={unit.selected_weapons ? JSON.parse(unit.selected_weapons) : undefined} />
              {unit.selected_drones && (() => {
                const drones = Object.entries(JSON.parse(unit.selected_drones) as Record<string, number>)
                  .filter(([, n]) => n > 0);
                if (drones.length === 0) return null;
                return (
                  <div>
                    <div className="text-teal-400 text-xs font-bold uppercase tracking-wide mb-2">Drones</div>
                    <div className="space-y-1.5">
                      {drones.map(([name, count]) => (
                        <div key={name} className="flex gap-2 text-xs">
                          <span className="text-teal-400 font-bold font-mono shrink-0">{count}×</span>
                          <div>
                            <span className="text-white font-medium">{name}</span>
                            {DRONE_ABILITIES[name] && (
                              <span className="text-gray-400 ml-1">— {DRONE_ABILITIES[name]}</span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Glossary tab ────────────────────────────────────────────────────────────

function GlossaryTab() {
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<string>("All");

  const categories = ["All", "Weapon", "Unit", "Keyword", "Stat"];

  const filtered = [...GLOSSARY].sort((a, b) => a.term.localeCompare(b.term)).filter(g => {
    const matchesCat = activeCategory === "All" || g.category === activeCategory;
    const q = search.toLowerCase();
    const matchesSearch = !q || g.term.toLowerCase().includes(q) || g.description.toLowerCase().includes(q);
    return matchesCat && matchesSearch;
  });

  return (
    <div>
      <div className="flex flex-col sm:flex-row gap-2 mb-4">
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search rules..."
          className="flex-1 max-w-xs bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-white focus:outline-none focus:border-amber-500"
        />
        <div className="flex gap-1">
          {categories.map(c => (
            <button
              key={c}
              onClick={() => setActiveCategory(c)}
              className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                activeCategory === c
                  ? "bg-amber-600 text-white"
                  : "bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700"
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-1.5">
        {filtered.map(g => (
          <div key={g.term} className="bg-gray-900 border border-gray-800 rounded-lg px-3 py-2.5">
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className="text-amber-400 text-sm font-bold font-mono">{g.term}</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                g.category === "Weapon"  ? "bg-blue-900 text-blue-300" :
                g.category === "Unit"    ? "bg-green-900 text-green-300" :
                g.category === "Keyword" ? "bg-purple-900 text-purple-300" :
                                            "bg-gray-700 text-gray-400"
              }`}>{g.category}</span>
            </div>
            <p className="text-gray-300 text-xs mt-1 leading-relaxed">{g.description}</p>
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="text-gray-500 text-sm text-center py-8">No terms match your search.</div>
        )}
      </div>
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function MatchPage() {
  const params = useParams();
  const router = useRouter();
  const matchId = params.id as string;

  const [match, setMatch] = useState<Match | null>(null);
  const [loading, setLoading] = useState(true);
  const [ending, setEnding] = useState(false);
  const [activeTab, setActiveTab] = useState<"units" | "detachment" | "stratagems" | "glossary">("units");
  const [glossaryTerm, setGlossaryTerm] = useState<string | null>(null);
  const [showArmyInfo, setShowArmyInfo] = useState(false);
  const [stratagemGroups, setStratagemGroups] = useState<StratagemGroups | null>(null);
  const [battleSizes, setBattleSizes] = useState<BattleSize[]>([]);
  const [enhancementsByDetachment, setEnhancementsByDetachment] = useState<Record<number, Enhancement[]>>({});
  const [armyFaction, setArmyFaction] = useState<Faction | null>(null);
  const [armyFactionLoaded, setArmyFactionLoaded] = useState(false);

  const loadMatch = useCallback(async () => {
    const res = await fetch(`/api/matches/${matchId}`);
    if (res.ok) setMatch(await res.json());
    setLoading(false);
  }, [matchId]);

  useEffect(() => { loadMatch(); }, [loadMatch]);

  useEffect(() => { fetch("/api/battle-sizes").then(r => r.ok ? r.json() : []).then(setBattleSizes); }, []);

  const detachmentIdsKey = match?.detachments.map(d => d.id).join(",") ?? "";

  useEffect(() => {
    if (!match) return;
    const params = new URLSearchParams();
    if (match.faction_id) params.set("faction_id", String(match.faction_id));
    if (detachmentIdsKey) params.set("detachment_ids", detachmentIdsKey);
    fetch(`/api/stratagems?${params.toString()}`)
      .then(r => r.ok ? r.json() : { core: [], faction: [], byDetachment: {} })
      .then(setStratagemGroups);
  }, [match?.faction_id, detachmentIdsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const factionId = match?.faction_id;
    (factionId ? fetch(`/api/detachments?faction_id=${factionId}`).then(r => r.ok ? r.json() : []) : Promise.resolve([]))
      .then((dets: { id: number; enhancements: Enhancement[] }[]) => {
        const map: Record<number, Enhancement[]> = {};
        for (const d of dets) map[d.id] = d.enhancements;
        setEnhancementsByDetachment(map);
      });
  }, [match?.faction_id]);

  useEffect(() => {
    const factionId = match?.faction_id;
    (factionId ? fetch("/api/factions").then(r => r.ok ? r.json() : []) : Promise.resolve([]))
      .then((factions: Faction[]) => setArmyFaction(factions.find(f => f.id === factionId) ?? null))
      .catch(() => setArmyFaction(null))
      .finally(() => setArmyFactionLoaded(true));
  }, [match?.faction_id]);

  async function handleCpChange(delta: number) {
    if (!match) return;
    const newCp = Math.max(0, match.cp_current + delta);
    const res = await fetch(`/api/matches/${matchId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cp_current: newCp }),
    });
    if (res.ok) setMatch(prev => prev ? { ...prev, cp_current: newCp } : prev);
  }

  const PHASES = ["Command", "Movement", "Shooting", "Charge", "Fight"];

  async function handleRoundChange(delta: number) {
    if (!match) return;
    const newRound = Math.min(5, Math.max(1, match.round + delta));
    const res = await fetch(`/api/matches/${matchId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ round: newRound }),
    });
    if (res.ok) setMatch(prev => prev ? { ...prev, round: newRound } : prev);
  }

  async function handleTurnChange(active_player: "mine" | "opponent") {
    if (!match) return;
    const res = await fetch(`/api/matches/${match.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active_player }),
    });
    if (res.ok) setMatch(prev => prev ? { ...prev, active_player } : prev);
  }

  async function handlePhaseChange(phase: string) {
    if (!match) return;
    const res = await fetch(`/api/matches/${matchId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phase }),
    });
    if (res.ok) setMatch(prev => prev ? { ...prev, phase } : prev);
  }

  async function handleVpChange(field: "vp" | "vp_opponent", delta: number) {
    if (!match) return;
    const newVal = Math.max(0, match[field] + delta);
    const res = await fetch(`/api/matches/${matchId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: newVal }),
    });
    if (res.ok) setMatch(prev => prev ? { ...prev, [field]: newVal } : prev);
  }

  async function handleWoundChange(unitId: number, wounds: number) {
    if (!match) return;
    const unit = match.units.find(u => u.id === unitId);
    if (!unit) return;
    const clamped = Math.max(0, Math.min(unit.max_wounds, wounds));
    const res = await fetch(`/api/matches/${matchId}/units/${unitId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ current_wounds: clamped }),
    });
    if (res.ok) {
      setMatch(prev => prev
        ? { ...prev, units: prev.units.map(u => u.id === unitId ? { ...u, current_wounds: clamped } : u) }
        : prev);
    }
  }

  async function handleDestroyed(unitId: number, destroyed: boolean) {
    if (!match) return;
    const res = await fetch(`/api/matches/${matchId}/units/${unitId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_destroyed: destroyed }),
    });
    if (res.ok) {
      setMatch(prev => prev
        ? { ...prev, units: prev.units.map(u => u.id === unitId ? { ...u, is_destroyed: destroyed ? 1 : 0 } : u) }
        : prev);
    }
  }

  async function handleEndMatch() {
    if (!confirm("End this match? You can still view it afterwards.")) return;
    setEnding(true);
    try {
      await fetch(`/api/matches/${matchId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ended_at: Date.now() }),
      });
      router.push("/matches");
    } finally {
      setEnding(false);
    }
  }

  if (loading) return <div className="p-8 text-gray-400">Loading match...</div>;
  if (!match) return <div className="p-8 text-gray-400">Match not found</div>;

  const isActive = !match.ended_at;
  const activeUnits = match.units.filter(u => u.is_destroyed === 0);
  const destroyedUnits = match.units.filter(u => u.is_destroyed === 1);

  // enhancement id → distinct character names carrying it (one row per model, so dedupe by army_unit_id)
  const assignedEnhancements: Record<number, string[]> = {};
  {
    const seen = new Set<number>();
    for (const u of match.units) {
      if (!u.enhancement_id || u.army_unit_id == null || seen.has(u.army_unit_id)) continue;
      seen.add(u.army_unit_id);
      (assignedEnhancements[u.enhancement_id] ??= []).push(u.unit_name.replace(/\s+\d+$/, ""));
    }
  }

  const pointLimit = match.point_limit ?? 2000;
  const eligibleBattleSizes = [...battleSizes].sort((a, b) => a.points - b.points).filter(b => b.points <= pointLimit);
  const battleSize = eligibleBattleSizes.length > 0 ? eligibleBattleSizes[eligibleBattleSizes.length - 1] : battleSizes[0];
  const dpUsed = match.detachments.reduce((sum, d) => sum + d.dp_cost, 0);

  const squads = Array.from(
    new Map(
      match.units.filter(u => u.squad_name).map(u => [u.squad_id, u.squad_name])
    ).entries()
  ).map(([id, name]) => ({ id, name }));
  const unassigned = match.units.filter(u => u.squad_id === null);

  function renderSquadSection(squadUnits: MatchUnit[], label: string | null, borderColor = "border-amber-800") {
    if (squadUnits.length === 0) return null;
    return (
      <div className={`border ${borderColor} rounded-lg p-3`}>
        {label && (
          <h2 className={`text-sm font-bold uppercase tracking-wide mb-3 ${borderColor === "border-amber-800" ? "text-amber-400" : "text-gray-500"}`}>
            {label}
          </h2>
        )}
        <div className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {squadUnits.map(unit => (
              <UnitCard
                key={unit.id}
                unit={unit}
                onWoundChange={isActive ? handleWoundChange : () => {}}
                onDestroyed={isActive ? handleDestroyed : () => {}}
              />
            ))}
          </div>
          <WeaponsSidebar units={squadUnits} />
        </div>
      </div>
    );
  }

  const PHASE_ABBR: Record<string, string> = {
    Command: "Cmd", Movement: "Mov", Shooting: "Sht", Charge: "Chg", Fight: "Fgt",
  };

  return (
    <GlossaryModalContext.Provider value={setGlossaryTerm}>
    <div className="max-w-[1600px] mx-auto px-3 md:px-4 py-3 md:py-4">
      {/* Top bar */}
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-3 md:p-4 mb-3 md:mb-4 sticky top-0 z-10">

        {/* ── Mobile header: back + name + end ── */}
        <div className="flex items-center gap-2 md:hidden mb-2">
          <Link href="/matches" className="text-gray-500 hover:text-gray-300 text-lg leading-none shrink-0">←</Link>
          <div className="flex-1 min-w-0">
            <div className="text-white font-bold text-sm truncate">
              {match.army_name || `Army #${match.army_id}`}
              {match.opponent && <span className="text-gray-400 font-normal"> vs {match.opponent}</span>}
            </div>
          </div>
          {isActive && (
            <button onClick={handleEndMatch} disabled={ending}
              className="shrink-0 bg-red-900 hover:bg-red-800 disabled:opacity-50 text-red-200 px-2.5 py-1.5 rounded font-medium text-xs transition-colors border border-red-800">
              {ending ? "Ending…" : "End Match"}
            </button>
          )}
        </div>

        {/* ── Mobile counters: 3-column grid ── */}
        <div className="grid grid-cols-3 gap-2 md:hidden mb-2">
          {/* CP */}
          <div className="flex flex-col items-center bg-gray-800 rounded-lg py-2 px-1">
            <span className="text-gray-400 text-[10px] font-medium uppercase mb-1">CP</span>
            <div className="flex items-center gap-1">
              {isActive && (
                <button onClick={() => handleCpChange(-1)} disabled={match.cp_current <= 0}
                  className="w-8 h-8 bg-red-800 hover:bg-red-700 disabled:opacity-30 rounded text-white font-bold text-base transition-colors">−</button>
              )}
              <span className="text-amber-400 font-bold text-xl font-mono w-7 text-center">{match.cp_current}</span>
              {isActive && (
                <button onClick={() => handleCpChange(1)}
                  className="w-8 h-8 bg-green-800 hover:bg-green-700 rounded text-white font-bold text-base transition-colors">+</button>
              )}
            </div>
          </div>
          {/* My VP */}
          <div className="flex flex-col items-center bg-gray-800 rounded-lg py-2 px-1">
            <span className="text-green-400 text-[10px] font-medium uppercase mb-1">My VP</span>
            <div className="flex items-center gap-1">
              {isActive && (
                <button onClick={() => handleVpChange("vp", -1)} disabled={match.vp <= 0}
                  className="w-8 h-8 bg-red-800 hover:bg-red-700 disabled:opacity-30 rounded text-white font-bold text-base transition-colors">−</button>
              )}
              <span className="text-green-400 font-bold text-xl font-mono w-7 text-center">{match.vp}</span>
              {isActive && (
                <button onClick={() => handleVpChange("vp", 1)}
                  className="w-8 h-8 bg-green-800 hover:bg-green-700 rounded text-white font-bold text-base transition-colors">+</button>
              )}
            </div>
          </div>
          {/* Opp VP */}
          <div className="flex flex-col items-center bg-gray-800 rounded-lg py-2 px-1">
            <span className="text-red-400 text-[10px] font-medium uppercase mb-1">Opp VP</span>
            <div className="flex items-center gap-1">
              {isActive && (
                <button onClick={() => handleVpChange("vp_opponent", -1)} disabled={match.vp_opponent <= 0}
                  className="w-8 h-8 bg-red-800 hover:bg-red-700 disabled:opacity-30 rounded text-white font-bold text-base transition-colors">−</button>
              )}
              <span className="text-red-400 font-bold text-xl font-mono w-7 text-center">{match.vp_opponent}</span>
              {isActive && (
                <button onClick={() => handleVpChange("vp_opponent", 1)}
                  className="w-8 h-8 bg-green-800 hover:bg-green-700 rounded text-white font-bold text-base transition-colors">+</button>
              )}
            </div>
          </div>
        </div>

        {/* ── Desktop header row (existing layout) ── */}
        <div className="hidden md:flex items-center gap-4 flex-wrap">
          <Link href="/matches" className="text-gray-500 hover:text-gray-300 text-sm">← Matches</Link>
          <div className="flex-1 min-w-0">
            <div className="text-white font-bold truncate">
              {match.army_name || `Army #${match.army_id}`}
              {match.opponent && <span className="text-gray-400 font-normal"> vs {match.opponent}</span>}
            </div>
            {!isActive && (
              <div className="text-gray-500 text-xs">Match ended {new Date(match.ended_at!).toLocaleDateString()}</div>
            )}
          </div>
          {/* CP */}
          <div className="flex items-center gap-2 bg-gray-800 rounded-lg px-3 py-2">
            <span className="text-gray-400 text-xs font-medium uppercase">CP</span>
            {isActive && (
              <button onClick={() => handleCpChange(-1)} disabled={match.cp_current <= 0}
                className="w-7 h-7 bg-red-800 hover:bg-red-700 disabled:opacity-30 rounded text-white font-bold text-lg transition-colors">−</button>
            )}
            <span className="text-amber-400 font-bold text-2xl font-mono w-10 text-center">{match.cp_current}</span>
            {isActive && (
              <button onClick={() => handleCpChange(1)}
                className="w-7 h-7 bg-green-800 hover:bg-green-700 rounded text-white font-bold text-lg transition-colors">+</button>
            )}
          </div>
          {/* My VP */}
          <div className="flex items-center gap-2 bg-gray-800 rounded-lg px-3 py-2">
            <span className="text-green-400 text-xs font-medium uppercase">My VP</span>
            {isActive && (
              <button onClick={() => handleVpChange("vp", -1)} disabled={match.vp <= 0}
                className="w-7 h-7 bg-red-800 hover:bg-red-700 disabled:opacity-30 rounded text-white font-bold text-lg transition-colors">−</button>
            )}
            <span className="text-green-400 font-bold text-2xl font-mono w-10 text-center">{match.vp}</span>
            {isActive && (
              <button onClick={() => handleVpChange("vp", 1)}
                className="w-7 h-7 bg-green-800 hover:bg-green-700 rounded text-white font-bold text-lg transition-colors">+</button>
            )}
          </div>
          {/* Opp VP */}
          <div className="flex items-center gap-2 bg-gray-800 rounded-lg px-3 py-2">
            <span className="text-red-400 text-xs font-medium uppercase">Opp VP</span>
            {isActive && (
              <button onClick={() => handleVpChange("vp_opponent", -1)} disabled={match.vp_opponent <= 0}
                className="w-7 h-7 bg-red-800 hover:bg-red-700 disabled:opacity-30 rounded text-white font-bold text-lg transition-colors">−</button>
            )}
            <span className="text-red-400 font-bold text-2xl font-mono w-10 text-center">{match.vp_opponent}</span>
            {isActive && (
              <button onClick={() => handleVpChange("vp_opponent", 1)}
                className="w-7 h-7 bg-green-800 hover:bg-green-700 rounded text-white font-bold text-lg transition-colors">+</button>
            )}
          </div>
          {isActive && (
            <button onClick={handleEndMatch} disabled={ending}
              className="bg-red-900 hover:bg-red-800 disabled:opacity-50 text-red-200 px-4 py-2 rounded font-medium text-sm transition-colors border border-red-800">
              {ending ? "Ending..." : "End Match"}
            </button>
          )}
        </div>

        {/* ── Round + Turn + Phase (shared, scrollable on mobile) ── */}
        <div className="flex items-center gap-2 md:gap-3 mt-2 pt-2 border-t border-gray-800 overflow-x-auto pb-0.5">
          {/* Round */}
          <div className="flex items-center gap-1 shrink-0">
            <span className="text-gray-400 text-xs font-medium uppercase">R</span>
            {isActive && (
              <button onClick={() => handleRoundChange(-1)} disabled={match.round <= 1}
                className="w-6 h-6 bg-gray-700 hover:bg-gray-600 disabled:opacity-30 rounded text-white text-sm transition-colors">−</button>
            )}
            <span className="text-white font-bold text-lg font-mono w-6 text-center">{match.round}</span>
            {isActive && (
              <button onClick={() => handleRoundChange(1)} disabled={match.round >= 5}
                className="w-6 h-6 bg-gray-700 hover:bg-gray-600 disabled:opacity-30 rounded text-white text-sm transition-colors">+</button>
            )}
          </div>

          <div className="w-px h-5 bg-gray-700 shrink-0" />

          {/* Turn */}
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => isActive && handleTurnChange("mine")}
              className={`text-xs px-2.5 py-1 rounded font-medium transition-colors ${
                match.active_player === "mine" ? "bg-green-700 text-white" : "bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700"
              } ${!isActive ? "cursor-default" : ""}`}
            >
              Mine
            </button>
            <button
              onClick={() => isActive && handleTurnChange("opponent")}
              className={`text-xs px-2.5 py-1 rounded font-medium transition-colors ${
                match.active_player === "opponent" ? "bg-red-700 text-white" : "bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700"
              } ${!isActive ? "cursor-default" : ""}`}
            >
              Opp
            </button>
          </div>

          <div className="w-px h-5 bg-gray-700 shrink-0" />

          {/* Phase */}
          <div className="flex items-center gap-1 shrink-0">
            {PHASES.map(p => (
              <button
                key={p}
                onClick={() => isActive && handlePhaseChange(p)}
                className={`text-xs px-2 md:px-2.5 py-1 rounded font-medium transition-colors ${
                  match.phase === p ? "bg-amber-600 text-white" : "bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700"
                } ${!isActive ? "cursor-default" : ""}`}
              >
                <span className="md:hidden">{PHASE_ABBR[p]}</span>
                <span className="hidden md:inline">{p}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Summary bar */}
      <div className="flex gap-3 mb-4 text-sm flex-wrap">
        <div className="bg-gray-900 border border-gray-800 rounded px-3 py-2">
          <span className="text-gray-400">Total: </span>
          <span className="text-white font-bold">{match.units.length}</span>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded px-3 py-2">
          <span className="text-gray-400">Active: </span>
          <span className="text-green-400 font-bold">{activeUnits.length}</span>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded px-3 py-2">
          <span className="text-gray-400">Destroyed: </span>
          <span className="text-red-400 font-bold">{destroyedUnits.length}</span>
        </div>
      </div>

      {/* Army info: faction + detachments + DP, expandable to show the actual rule text */}
      {(match.faction || match.detachments.length > 0) && (
        <div className="bg-gray-900 border border-gray-800 rounded-lg px-3 py-2 mb-4 text-sm">
          <button
            onClick={() => setShowArmyInfo(v => !v)}
            className="w-full flex items-center gap-2 flex-wrap text-left"
          >
            <span className="text-gray-500 text-xs shrink-0">{showArmyInfo ? "▲" : "▼"}</span>
            {match.faction && (
              <span className="text-amber-300 font-bold">{match.faction}</span>
            )}
            {match.detachments.map(d => (
              <span key={d.id} className="flex items-center gap-1 bg-gray-800 border border-gray-700 rounded px-2 py-0.5">
                <span className="text-white text-xs">{d.name}</span>
                <span className="text-amber-400 text-[10px] font-mono">{d.dp_cost}DP</span>
              </span>
            ))}
            {battleSize && (
              <span className={`ml-auto font-mono text-xs font-bold ${dpUsed > battleSize.dp_budget && match.detachments.length > 1 ? "text-red-400" : "text-green-400"}`}>
                {dpUsed} / {battleSize.dp_budget} DP ({battleSize.name})
              </span>
            )}
          </button>
          {showArmyInfo && (
            <div className="mt-3 pt-3 border-t border-gray-800 space-y-3">
              {armyFaction?.army_rule_name ? (
                <div>
                  <div className="text-amber-400 font-bold text-xs uppercase tracking-wide mb-1">
                    Army Rule — {armyFaction.army_rule_name}
                  </div>
                  <div className="text-gray-300 text-xs"><Linkified text={armyFaction.army_rule_text} /></div>
                </div>
              ) : match.faction_id && !armyFactionLoaded ? (
                <div className="text-gray-500 text-xs">Loading army rule…</div>
              ) : match.faction_id ? (
                <div className="text-gray-500 text-xs">No army rule found for this faction — try syncing it again from the Admin page.</div>
              ) : null}
              {match.detachments.map(d => d.rule_name && (
                <div key={d.id}>
                  <div className="text-amber-400 font-bold text-xs uppercase tracking-wide mb-1">
                    {d.name} — {d.rule_name}
                  </div>
                  <div className="text-gray-300 text-xs"><Linkified text={d.rule_text} /></div>
                </div>
              ))}
              <div className="text-gray-600 text-[11px]">
                See the Detachment tab for enhancements and stratagems.
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tab switcher */}
      <div className="flex border-b border-gray-800 mb-4">
        <button
          onClick={() => setActiveTab("units")}
          className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
            activeTab === "units"
              ? "text-amber-400 border-amber-400"
              : "text-gray-400 border-transparent hover:text-white"
          }`}
        >
          Units
        </button>
        <button
          onClick={() => setActiveTab("detachment")}
          className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
            activeTab === "detachment"
              ? "text-amber-400 border-amber-400"
              : "text-gray-400 border-transparent hover:text-white"
          }`}
        >
          Detachment
        </button>
        <button
          onClick={() => setActiveTab("stratagems")}
          className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
            activeTab === "stratagems"
              ? "text-amber-400 border-amber-400"
              : "text-gray-400 border-transparent hover:text-white"
          }`}
        >
          Stratagems
        </button>
        <button
          onClick={() => setActiveTab("glossary")}
          className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
            activeTab === "glossary"
              ? "text-amber-400 border-amber-400"
              : "text-gray-400 border-transparent hover:text-white"
          }`}
        >
          Glossary
        </button>
      </div>

      {/* Units tab */}
      {activeTab === "units" && (
        match.units.length === 0 ? (
          <div className="text-center py-16 text-gray-500">No units in this match.</div>
        ) : squads.length === 0 ? (
          <div className="space-y-4">
            {renderSquadSection(activeUnits, activeUnits.length > 0 && destroyedUnits.length > 0 ? `Active (${activeUnits.length})` : null, "border-gray-800")}
            {renderSquadSection(destroyedUnits, `Destroyed (${destroyedUnits.length})`, "border-red-900")}
          </div>
        ) : (
          <div className="space-y-4">
            {squads.map(({ id, name }) => (
              <div key={id}>{renderSquadSection(match.units.filter(u => u.squad_id === id), name as string)}</div>
            ))}
            {renderSquadSection(unassigned, unassigned.length > 0 ? "Unassigned" : null, "border-gray-700")}
          </div>
        )
      )}

      {/* Detachment tab */}
      {activeTab === "detachment" && (
        <DetachmentTab detachments={match.detachments} enhancementsByDetachment={enhancementsByDetachment} assignedEnhancements={assignedEnhancements} armyFaction={armyFaction} />
      )}

      {/* Stratagems tab */}
      {activeTab === "stratagems" && (
        <StrategemsTab
          groups={stratagemGroups}
          detachments={match.detachments}
          enhancementsByDetachment={enhancementsByDetachment}
          phase={match.phase}
          activePlayer={match.active_player}
        />
      )}

      {/* Glossary tab */}
      {activeTab === "glossary" && <GlossaryTab />}

      {glossaryTerm && <GlossaryModal term={glossaryTerm} onClose={() => setGlossaryTerm(null)} />}
    </div>
    </GlossaryModalContext.Provider>
  );
}
