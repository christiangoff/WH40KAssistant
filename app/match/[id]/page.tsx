"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
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

// ─── Weapons table ──────────────────────────────────────────────────────────

// Parse the army unit's saved weapon selection into a name→count map (null = no
// selection saved, i.e. default loadout). Legacy string[] means the whole squad
// carries each named weapon.
function selectedWeaponCounts(head: MatchUnit): Record<string, number> | null {
  if (!head.selected_weapons) return null;
  try {
    const p = JSON.parse(head.selected_weapons);
    if (Array.isArray(p)) return Object.fromEntries((p as string[]).map(n => [n, head.model_count]));
    return p as Record<string, number>;
  } catch {
    return null;
  }
}

function WeaponsMini({ stats, counts }: { stats: UnitStats; counts: Record<string, number> | null }) {
  const list = counts
    ? stats.weapons.filter(w => (counts[w.name] ?? 0) > 0)
    : stats.weapons;
  if (list.length === 0) return null;
  const ranged = list.filter(w => w.type === "ranged");
  const melee = list.filter(w => w.type === "melee");

  const section = (label: string, ws: WeaponProfile[], color: string, rng: (w: WeaponProfile) => string) =>
    ws.length === 0 ? null : (
      <>
        <tr><td colSpan={7} className={`${color} text-[10px] font-bold uppercase pt-1.5 pb-0.5`}>{label}</td></tr>
        {ws.map((w, i) => (
          <tr key={weaponLabel(w) + i} className="border-t border-gray-800/60 align-top">
            <td className="py-0.5 pr-2">
              <div className="flex items-baseline gap-1">
                {counts && <span className="text-amber-400 text-[11px] font-bold font-mono shrink-0">{counts[w.name] ?? 0}×</span>}
                <span className="text-white text-xs">{weaponLabel(w)}</span>
              </div>
              {w.abilities && (
                <div className="flex flex-wrap gap-0.5 mt-0.5">
                  {w.abilities.split(", ").map((ab, j) => (
                    <span key={j} className="text-amber-300 text-[10px] bg-gray-800 border border-gray-700 px-1 rounded"><Linkified text={ab} /></span>
                  ))}
                </div>
              )}
            </td>
            <td className="text-gray-400 text-[11px] text-center font-mono px-1">{rng(w)}</td>
            <td className="text-gray-300 text-[11px] text-center font-mono px-1">{w.attacks}</td>
            <td className="text-gray-300 text-[11px] text-center font-mono px-1">{w.bsWs}</td>
            <td className="text-gray-300 text-[11px] text-center font-mono px-1">{w.strength}</td>
            <td className="text-gray-300 text-[11px] text-center font-mono px-1">{w.ap}</td>
            <td className="text-gray-300 text-[11px] text-center font-mono px-1">{w.damage}</td>
          </tr>
        ))}
      </>
    );

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="text-gray-500 text-[10px]">
            <th className="text-left pb-1 pr-2">Weapon</th>
            <th className="px-1">Rng</th><th className="px-1">A</th><th className="px-1">BS/WS</th>
            <th className="px-1">S</th><th className="px-1">AP</th><th className="px-1">D</th>
          </tr>
        </thead>
        <tbody>
          {section("Ranged", ranged, "text-blue-400", w => w.range)}
          {section("Melee", melee, "text-red-400", () => "—")}
        </tbody>
      </table>
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

  const total = groups.core.length +
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

type RowPatch = { id: number; current_wounds?: number; is_destroyed?: 0 | 1 };

// The match stores one match_units row per model. Group them back into one entry
// per army unit so the UI shows a single card with a models counter.
function groupByArmyUnit(units: MatchUnit[]): MatchUnit[][] {
  const groups = new Map<number, MatchUnit[]>();
  for (const u of units) {
    const key = u.army_unit_id ?? -u.id; // orphaned rows (army unit deleted) stand alone
    const arr = groups.get(key);
    if (arr) arr.push(u);
    else groups.set(key, [u]);
  }
  return [...groups.values()].map(rows => [...rows].sort((a, b) => a.id - b.id));
}

function Stepper({
  label, value, max, onDec, onInc, canDec, canInc, big, barColor,
}: {
  label: string; value: number; max: number;
  onDec: () => void; onInc: () => void; canDec: boolean; canInc: boolean;
  big?: boolean; barColor?: string;
}) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  const btn = big ? "w-11 h-11 text-2xl" : "w-8 h-8 text-lg";
  return (
    <div className="flex-1 min-w-[7rem]">
      <div className="flex items-baseline justify-between mb-1">
        <span className="text-gray-400 text-[10px] font-bold uppercase tracking-wide">{label}</span>
        <span className={`text-white font-mono font-bold ${big ? "text-lg" : "text-xs"}`}>{value} / {max}</span>
      </div>
      {barColor && (
        <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden mb-1.5">
          <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
        </div>
      )}
      <div className="flex items-center gap-1.5">
        <button
          onClick={onDec}
          disabled={!canDec}
          className={`${btn} bg-red-800 hover:bg-red-700 disabled:opacity-25 disabled:cursor-not-allowed rounded-lg text-white font-bold transition-colors`}
        >−</button>
        <div className="flex-1 text-center">
          <span className={`text-white font-mono font-bold ${big ? "text-2xl" : "text-lg"}`}>{value}</span>
        </div>
        <button
          onClick={onInc}
          disabled={!canInc}
          className={`${btn} bg-green-800 hover:bg-green-700 disabled:opacity-25 disabled:cursor-not-allowed rounded-lg text-white font-bold transition-colors`}
        >+</button>
      </div>
    </div>
  );
}

function UnitGroupCard({
  rows,
  isActive,
  open,
  onToggle,
  onPatch,
}: {
  rows: MatchUnit[];
  isActive: boolean;
  open: boolean;
  onToggle: () => void;
  onPatch: (patches: RowPatch[]) => void;
}) {
  const [showAbilities, setShowAbilities] = useState(false);
  const head = rows[0];
  const stats: UnitStats | null = head.stats_json ? JSON.parse(head.stats_json) : null;

  const modelsMax = rows.length;
  const alive = rows.filter(r => r.is_destroyed === 0);
  const modelsAlive = alive.length;
  const wpm = head.max_wounds || 1;
  const destroyed = modelsAlive === 0;
  const multiModel = modelsMax > 1;
  const multiWound = wpm > 1;

  // Model currently taking damage: first damaged living model, else the last one.
  const lead = alive.find(r => r.current_wounds < r.max_wounds) ?? alive[alive.length - 1] ?? null;
  const leadWounds = lead ? lead.current_wounds : 0;
  const anyDamaged = alive.some(r => r.current_wounds < r.max_wounds);

  const name = head.unit_name.replace(/\s+\d+$/, "");
  const counts = selectedWeaponCounts(head);

  let woundColor = "bg-green-600";
  const woundPct = wpm > 0 ? (leadWounds / wpm) * 100 : 0;
  if (woundPct <= 25) woundColor = "bg-red-600";
  else if (woundPct <= 50) woundColor = "bg-yellow-600";

  const loseModel = () => {
    const target = alive.find(r => r.current_wounds < r.max_wounds) ?? alive[alive.length - 1];
    if (target) onPatch([{ id: target.id, is_destroyed: 1, current_wounds: 0 }]);
  };
  const regainModel = () => {
    const dead = rows.filter(r => r.is_destroyed === 1).sort((a, b) => b.id - a.id)[0];
    if (dead) onPatch([{ id: dead.id, is_destroyed: 0, current_wounds: wpm }]);
  };
  const loseWound = () => {
    if (!lead) return;
    if (lead.current_wounds > 1) onPatch([{ id: lead.id, current_wounds: lead.current_wounds - 1 }]);
    else onPatch([{ id: lead.id, is_destroyed: 1, current_wounds: 0 }]);
  };
  const gainWound = () => {
    const d = alive.find(r => r.current_wounds < r.max_wounds);
    if (d) onPatch([{ id: d.id, current_wounds: d.current_wounds + 1 }]);
  };
  const toggleWhole = () => {
    onPatch(rows.map(r => (destroyed
      ? { id: r.id, is_destroyed: 0 as const, current_wounds: wpm }
      : { id: r.id, is_destroyed: 1 as const, current_wounds: 0 })));
  };

  const droneEntries = head.selected_drones
    ? Object.entries(JSON.parse(head.selected_drones) as Record<string, number>).filter(([, n]) => n > 0)
    : [];

  const core: [string, string][] = stats
    ? [
        ["M", stats.M], ["T", stats.T], ["SV", stats.Sv], ["W", stats.W],
        ["LD", stats.Ld], ["OC", stats.OC],
        ...(stats.invuln ? ([["INV", stats.invuln]] as [string, string][]) : []),
      ]
    : [];

  const statusChip = destroyed ? (
    <span className="bg-red-900 text-red-300 text-[10px] px-1.5 py-0.5 rounded font-medium">DESTROYED</span>
  ) : multiModel ? (
    <span className="flex items-center gap-1 text-xs font-mono">
      {anyDamaged && <span className="w-1.5 h-1.5 rounded-full bg-yellow-500 shrink-0" />}
      <span className={modelsAlive === modelsMax ? "text-gray-400" : modelsAlive <= modelsMax / 4 ? "text-red-400" : "text-yellow-400"}>
        {modelsAlive}/{modelsMax}
      </span>
    </span>
  ) : multiWound ? (
    <span className={`text-xs font-mono ${leadWounds === wpm ? "text-gray-400" : woundPct <= 25 ? "text-red-400" : woundPct <= 50 ? "text-yellow-400" : "text-green-400"}`}>
      {leadWounds}/{wpm}W
    </span>
  ) : null;

  return (
    <div className={`bg-gray-900 border rounded-lg overflow-hidden transition-opacity ${destroyed ? "border-red-900 opacity-60" : "border-gray-800"}`}>
      {/* Always-visible bar — click to expand */}
      <div className="flex items-center gap-2 px-3 py-2">
        <button onClick={onToggle} className="flex-1 flex items-center gap-2 min-w-0 text-left">
          <span className="text-gray-500 text-xs shrink-0 w-3">{open ? "▾" : "▸"}</span>
          <span className={`font-bold text-sm truncate ${destroyed ? "line-through text-gray-500" : "text-white"}`}>{name}</span>
          {head.enhancement_name && <span className="text-amber-400 text-xs shrink-0" title={head.enhancement_name}>{"🛡"}</span>}
          <span className="ml-auto shrink-0">{statusChip}</span>
        </button>
        <button
          onClick={toggleWhole}
          disabled={!isActive}
          className={`shrink-0 text-xs px-2 py-1 rounded transition-colors disabled:opacity-40 ${destroyed ? "bg-gray-700 hover:bg-gray-600 text-gray-300" : "bg-red-900 hover:bg-red-800 text-red-200"}`}
        >
          {destroyed ? "Restore" : "Destroy"}
        </button>
      </div>

      {open && (
        <div className="border-t border-gray-800">
          {core.length > 0 && !destroyed && (
            <div className="flex gap-x-2.5 gap-y-0.5 px-3 py-2 flex-wrap">
              {core.map(([l, v]) => (
                <span key={l} className="text-[11px] font-mono whitespace-nowrap">
                  <span className="text-gray-500">{l}</span> <span className="text-gray-200">{v || "–"}</span>
                </span>
              ))}
            </div>
          )}

          {head.enhancement_name && (
            <div className="mx-3 mb-2 text-xs bg-amber-950/60 border border-amber-800/60 rounded px-2 py-1">
              <span className="text-amber-300 font-bold">{"🛡"} {head.enhancement_name}</span>
              {head.enhancement_description && (
                <span className="text-gray-300"> — <Linkified text={head.enhancement_description} /></span>
              )}
            </div>
          )}

          {/* Weapons the unit is actually equipped with */}
          {stats && !destroyed && (
            <div className="border-t border-gray-800 px-3 py-2">
              <WeaponsMini stats={stats} counts={counts} />
              {droneEntries.length > 0 && (
                <div className="mt-2 pt-2 border-t border-gray-800/60 space-y-0.5">
                  {droneEntries.map(([dn, c]) => (
                    <div key={dn} className="text-[11px] flex gap-1.5">
                      <span className="text-teal-400 font-bold font-mono shrink-0">{c}×</span>
                      <span className="text-teal-300">{dn}</span>
                      {DRONE_ABILITIES[dn] && <span className="text-gray-500">— {DRONE_ABILITIES[dn]}</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Abilities + keywords */}
          {stats && !destroyed && (stats.abilities.length > 0 || stats.keywords.length > 0) && (
            <>
              <button
                onClick={() => setShowAbilities(v => !v)}
                className="w-full border-t border-gray-800 px-3 py-1.5 text-left text-xs text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
              >
                {showAbilities ? "▲ Hide" : "▾ Abilities"}{stats.abilities.length > 0 ? ` (${stats.abilities.length})` : ""}
              </button>
              {showAbilities && (
                <div className="border-t border-gray-800 px-3 py-2 space-y-1.5">
                  {stats.abilities.map((a, i) => (
                    <div key={i} className="text-xs">
                      <span className="text-amber-300 font-bold">{a.name}: </span>
                      <span className="text-gray-300"><Linkified text={a.description} /></span>
                    </div>
                  ))}
                  {stats.keywords.length > 0 && (
                    <div className="flex flex-wrap gap-1 pt-1">
                      {stats.keywords.map((k, i) => (
                        <span key={i} className="text-[10px] bg-gray-800 text-gray-400 px-1.5 py-0.5 rounded"><Linkified text={k} /></span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {/* Casualty tracking */}
          {!destroyed && (multiModel || multiWound) && (
            <div className="border-t border-gray-800 bg-gray-950/40 px-3 py-2 flex gap-4 items-start">
              {multiModel && (
                <div className="flex-1 min-w-[7rem]">
                  <Stepper
                    label="Models" value={modelsAlive} max={modelsMax}
                    onDec={loseModel} onInc={regainModel}
                    canDec={isActive && modelsAlive > 0}
                    canInc={isActive && modelsAlive < modelsMax}
                  />
                  {modelsMax <= 40 && (
                    <div className="flex flex-wrap gap-0.5 mt-1.5">
                      {rows.map((r, i) => (
                        <span key={r.id} className={`w-2 h-2 rounded-sm ${i < modelsAlive ? "bg-green-500" : "bg-gray-700"}`} />
                      ))}
                    </div>
                  )}
                </div>
              )}
              {multiWound && (
                <Stepper
                  label={multiModel ? "Wounds · lead model" : "Wounds"}
                  value={leadWounds} max={wpm}
                  onDec={loseWound} onInc={gainWound}
                  canDec={isActive && !!lead}
                  canInc={isActive && anyDamaged}
                  big={!multiModel}
                  barColor={woundColor}
                />
              )}
            </div>
          )}
        </div>
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
  // Which unit cards are expanded on the Units tab (key = army_unit_id ?? match_unit id).
  const [expandedUnits, setExpandedUnits] = useState<Set<number>>(new Set());
  const toggleUnit = (key: number) => setExpandedUnits(prev => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

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
      .then(r => r.ok ? r.json() : { core: [], byDetachment: {} })
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

  // Apply one or more match_units row updates (model lost/regained, wound step,
  // whole-unit destroy). Optimistic; each row is its own PUT.
  async function patchRows(patches: RowPatch[]) {
    if (!match || patches.length === 0) return;
    setMatch(prev => prev ? {
      ...prev,
      units: prev.units.map(u => {
        const p = patches.find(x => x.id === u.id);
        return p ? { ...u, ...(p.current_wounds !== undefined ? { current_wounds: p.current_wounds } : {}), ...(p.is_destroyed !== undefined ? { is_destroyed: p.is_destroyed } : {}) } : u;
      }),
    } : prev);
    await Promise.all(patches.map(p =>
      fetch(`/api/matches/${matchId}/units/${p.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(p.current_wounds !== undefined ? { current_wounds: p.current_wounds } : {}),
          ...(p.is_destroyed !== undefined ? { is_destroyed: p.is_destroyed } : {}),
        }),
      })
    ));
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
  // Split rows by whether their unit (all its models) is wiped out.
  const unitGroups = groupByArmyUnit(match.units);
  const activeGroups = unitGroups.filter(g => g.some(r => r.is_destroyed === 0));
  const destroyedGroups = unitGroups.filter(g => g.every(r => r.is_destroyed === 1));
  const activeUnits = activeGroups.flat();
  const destroyedUnits = destroyedGroups.flat();

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
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-start">
          {groupByArmyUnit(squadUnits).map(g => {
            const key = g[0].army_unit_id ?? g[0].id;
            return (
              <UnitGroupCard
                key={key}
                rows={g}
                isActive={isActive}
                open={expandedUnits.has(key)}
                onToggle={() => toggleUnit(key)}
                onPatch={patchRows}
              />
            );
          })}
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
          <span className="text-gray-400">Units: </span>
          <span className="text-white font-bold">{unitGroups.length}</span>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded px-3 py-2">
          <span className="text-gray-400">Active: </span>
          <span className="text-green-400 font-bold">{activeGroups.length}</span>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded px-3 py-2">
          <span className="text-gray-400">Lost: </span>
          <span className="text-red-400 font-bold">{destroyedGroups.length}</span>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded px-3 py-2">
          <span className="text-gray-400">Models: </span>
          <span className="text-white font-bold">{match.units.filter(u => u.is_destroyed === 0).length}</span>
          <span className="text-gray-500">/{match.units.length}</span>
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
        ) : (
          <>
            <div className="flex justify-end gap-3 mb-2 text-xs">
              <button
                onClick={() => setExpandedUnits(new Set(unitGroups.map(g => g[0].army_unit_id ?? g[0].id)))}
                className="text-gray-500 hover:text-white transition-colors"
              >
                Expand all
              </button>
              <span className="text-gray-700">·</span>
              <button
                onClick={() => setExpandedUnits(new Set())}
                className="text-gray-500 hover:text-white transition-colors"
              >
                Collapse all
              </button>
            </div>
            {squads.length === 0 ? (
              <div className="space-y-4">
                {renderSquadSection(activeUnits, activeGroups.length > 0 && destroyedGroups.length > 0 ? `Active (${activeGroups.length})` : null, "border-gray-800")}
                {renderSquadSection(destroyedUnits, `Destroyed (${destroyedGroups.length})`, "border-red-900")}
              </div>
            ) : (
              <div className="space-y-4">
                {squads.map(({ id, name }) => (
                  <div key={id}>{renderSquadSection(match.units.filter(u => u.squad_id === id), name as string)}</div>
                ))}
                {renderSquadSection(unassigned, unassigned.length > 0 ? "Unassigned" : null, "border-gray-700")}
              </div>
            )}
          </>
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
