"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import StatBlock from "@/components/StatBlock";
import { UnitStats, WeaponProfile, Stratagem } from "@/lib/wahapedia";

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
  model_count: number;
  detachment: string | null;
}

interface Match {
  id: number;
  army_id: number;
  army_name: string | null;
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
}

// ─── Sidebar: weapons ────────────────────────────────────────────────────────

function WeaponsSidebar({ units }: { units: MatchUnit[] }) {
  const activeUnits = units.filter(u => u.is_destroyed === 0 && u.stats_json);
  if (activeUnits.length === 0) return null;

  // Aggregate weapons across all active units: name → { profile, total count }
  const weaponMap = new Map<string, { weapon: WeaponProfile; count: number }>();
  for (const unit of activeUnits) {
    const stats: UnitStats = JSON.parse(unit.stats_json!);
    const selectedNames: string[] | null = unit.selected_weapons ? JSON.parse(unit.selected_weapons) : null;
    const weapons = selectedNames ? stats.weapons.filter(w => selectedNames.includes(w.name)) : stats.weapons;
    // Derive models-per-card from max_wounds ÷ W — works for both old (N models/card)
    // and new (1 model/card) match formats without needing au.model_count from the JOIN.
    const woundsPerModel = parseInt(stats.W || "1") || 1;
    const modelsInCard = Math.max(1, Math.round(unit.max_wounds / woundsPerModel));
    for (const w of weapons) {
      const entry = weaponMap.get(w.name);
      if (entry) entry.count += modelsInCard;
      else weaponMap.set(w.name, { weapon: w, count: modelsInCard });
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
                  <tr key={w.name} className="border-t border-gray-800/60">
                    <td className="py-0.5 pr-2">
                      <div className="flex items-center gap-1">
                        <span className="text-amber-400 text-[11px] font-bold font-mono shrink-0">{count}×</span>
                        <span className="text-white text-xs">{w.name}</span>
                      </div>
                      {w.abilities && (
                        <div className="flex flex-wrap gap-0.5 mt-0.5 pl-5">
                          {w.abilities.split(", ").map((ab, i) => (
                            <span key={i} className="text-amber-300 text-[10px] bg-gray-700 px-1 rounded">{ab}</span>
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
                  <tr key={w.name} className="border-t border-gray-800/60">
                    <td className="py-0.5 pr-2">
                      <div className="flex items-center gap-1">
                        <span className="text-amber-400 text-[11px] font-bold font-mono shrink-0">{count}×</span>
                        <span className="text-white text-xs">{w.name}</span>
                      </div>
                      {w.abilities && (
                        <div className="flex flex-wrap gap-0.5 mt-0.5 pl-5">
                          {w.abilities.split(", ").map((ab, i) => (
                            <span key={i} className="text-amber-300 text-[10px] bg-gray-700 px-1 rounded">{ab}</span>
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

function StratagemCard({ s, usable }: { s: Stratagem; usable: boolean }) {
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
          <div className="text-gray-400 text-xs italic pt-1">{s.type}</div>
          {s.legend && <div className="text-gray-500 text-[11px] italic">{s.legend}</div>}
          {s.when && (
            <div className="text-xs">
              <span className="text-amber-400 font-bold">WHEN: </span>
              <span className="text-gray-300">{s.when}</span>
            </div>
          )}
          {s.target && (
            <div className="text-xs">
              <span className="text-amber-400 font-bold">TARGET: </span>
              <span className="text-gray-300">{s.target}</span>
            </div>
          )}
          {s.effect && (
            <div className="text-xs">
              <span className="text-amber-400 font-bold">EFFECT: </span>
              <span className="text-gray-300">{s.effect}</span>
            </div>
          )}
          {s.restrictions && (
            <div className="text-xs">
              <span className="text-amber-400 font-bold">RESTRICTIONS: </span>
              <span className="text-gray-300">{s.restrictions}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StratagemsSidebar({ units, phase, activePlayer }: { units: MatchUnit[]; phase: string; activePlayer: string }) {
  const [search, setSearch] = useState("");

  // Collect unique stratagems across all units (dedupe by name)
  const stratagemMap = new Map<string, Stratagem>();
  for (const unit of units) {
    if (!unit.stats_json) continue;
    const stats: UnitStats = JSON.parse(unit.stats_json);
    for (const s of stats.stratagems ?? []) {
      if (!stratagemMap.has(s.name)) stratagemMap.set(s.name, s);
    }
  }
  const stratagems = Array.from(stratagemMap.values());

  const filtered = search
    ? stratagems.filter(s =>
        s.name.toLowerCase().includes(search.toLowerCase()) ||
        s.type.toLowerCase().includes(search.toLowerCase())
      )
    : stratagems;

  // Usable now float to top
  const usable = filtered.filter(s => s.when && isUsableNow(s.when, phase, activePlayer));
  const other  = filtered.filter(s => !s.when || !isUsableNow(s.when, phase, activePlayer));
  const sorted = [...usable, ...other];

  if (stratagems.length === 0) return null;

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
      <div className="px-3 py-2 border-b border-gray-800 bg-gray-800 flex items-center gap-2">
        <h3 className="text-amber-400 text-xs font-bold uppercase tracking-wide flex-1">
          Stratagems
          {usable.length > 0 && (
            <span className="ml-2 text-green-400 normal-case font-normal">({usable.length} available now)</span>
          )}
        </h3>
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Filter..."
          className="bg-gray-700 border border-gray-600 rounded px-2 py-0.5 text-xs text-white focus:outline-none focus:border-amber-500 w-24"
        />
      </div>
      <div className="p-2 space-y-1 max-h-[50vh] overflow-y-auto">
        {sorted.map((s, i) => (
          <StratagemCard key={i} s={s} usable={s.when ? isUsableNow(s.when, phase, activePlayer) : false} />
        ))}
        {sorted.length === 0 && (
          <div className="text-gray-500 text-xs px-1">No stratagems match.</div>
        )}
      </div>
    </div>
  );
}

// ─── Stratagems tab ──────────────────────────────────────────────────────────

function StratagemGroup({ label, stratagems, phase, activePlayer, defaultOpen = false, highlighted = false }: {
  label: string;
  stratagems: Stratagem[];
  phase: string;
  activePlayer: string;
  defaultOpen?: boolean;
  highlighted?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const usableCount = stratagems.filter(s => s.when && isUsableNow(s.when, phase, activePlayer)).length;

  return (
    <div className={`border rounded-lg overflow-hidden ${highlighted ? "border-amber-700" : "border-gray-800"}`}>
      <button
        onClick={() => setOpen(v => !v)}
        className={`w-full flex items-center gap-2 px-3 py-2 transition-colors text-left ${highlighted ? "bg-amber-950 hover:bg-amber-900" : "bg-gray-800 hover:bg-gray-750"}`}
      >
        <span className={`font-bold text-xs uppercase tracking-wide flex-1 ${highlighted ? "text-amber-300" : "text-amber-400"}`}>{label}</span>
        {usableCount > 0 && (
          <span className="text-green-400 text-xs font-medium">{usableCount} now</span>
        )}
        <span className="text-gray-500 text-xs">{stratagems.length}</span>
        <span className="text-gray-500 text-xs ml-1">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="p-2 space-y-1">
          {stratagems.map((s, i) => (
            <StratagemCard key={i} s={s} usable={s.when ? isUsableNow(s.when, phase, activePlayer) : false} />
          ))}
        </div>
      )}
    </div>
  );
}

function StrategemsTab({ units, phase, activePlayer }: {
  units: MatchUnit[];
  phase: string;
  activePlayer: string;
}) {
  const [search, setSearch] = useState("");

  // Detachments assigned to units in this army
  const activeDetachments = new Set(
    units.map(u => u.detachment).filter((d): d is string => !!d)
  );

  // Dedupe stratagems by name, group by stratagem type (detachment)
  const seenNames = new Set<string>();
  const typeMap = new Map<string, Stratagem[]>();
  for (const unit of units) {
    if (!unit.stats_json) continue;
    const stats: UnitStats = JSON.parse(unit.stats_json);
    for (const s of stats.stratagems ?? []) {
      if (seenNames.has(s.name)) continue;
      seenNames.add(s.name);
      const group = s.type || "Other";
      if (!typeMap.has(group)) typeMap.set(group, []);
      typeMap.get(group)!.push(s);
    }
  }

  const allStratagems = Array.from(typeMap.values()).flat();
  const totalUsable = allStratagems.filter(s => s.when && isUsableNow(s.when, phase, activePlayer)).length;

  const isCore = (label: string) => label.toLowerCase().includes("core");
  const isActive = (label: string) => activeDetachments.has(label);

  // Sort: Core first, active detachments next, rest alphabetical
  const sortedGroups = Array.from(typeMap.entries()).sort(([a], [b]) => {
    if (isCore(a) && !isCore(b)) return -1;
    if (!isCore(a) && isCore(b)) return 1;
    if (isActive(a) && !isActive(b)) return -1;
    if (!isActive(a) && isActive(b)) return 1;
    return a.localeCompare(b);
  });

  const filterGroup = (stratagems: Stratagem[]) => {
    const filtered = search
      ? stratagems.filter(s =>
          s.name.toLowerCase().includes(search.toLowerCase()) ||
          s.type.toLowerCase().includes(search.toLowerCase()) ||
          (s.effect && s.effect.toLowerCase().includes(search.toLowerCase()))
        )
      : stratagems;
    const usable = filtered.filter(s => s.when && isUsableNow(s.when, phase, activePlayer));
    const other  = filtered.filter(s => !s.when || !isUsableNow(s.when, phase, activePlayer));
    return [...usable, ...other];
  };

  if (allStratagems.length === 0) {
    return <div className="text-gray-500 text-center py-16">No stratagems found for this army.</div>;
  }

  const noDetachmentSet = activeDetachments.size === 0;

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
        {totalUsable > 0 && (
          <span className="text-green-400 text-xs font-medium shrink-0">{totalUsable} available now</span>
        )}
        <span className="text-gray-500 text-xs shrink-0">{allStratagems.length} total</span>
      </div>

      {noDetachmentSet && (
        <div className="mb-3 text-xs text-amber-500 bg-amber-950 border border-amber-800 rounded px-3 py-2">
          No detachment assigned to any units. Set one per unit on the Army page to pin your detachment stratagems.
        </div>
      )}

      <div className="space-y-2">
        {sortedGroups.map(([label, stratagems]) => {
          const filtered = filterGroup(stratagems);
          if (filtered.length === 0 && search) return null;
          const pinOpen = isCore(label) || isActive(label) || sortedGroups.length === 1;
          return (
            <StratagemGroup
              key={label}
              label={label}
              stratagems={filtered.length > 0 ? filtered : stratagems}
              phase={phase}
              activePlayer={activePlayer}
              defaultOpen={pinOpen}
              highlighted={isActive(label)}
            />
          );
        })}
      </div>
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
                {(JSON.parse(unit.selected_weapons) as string[]).join(" · ")}
              </p>
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
            <div className="border-t border-gray-800 p-4">
              <StatBlock stats={stats} selectedWeapons={unit.selected_weapons ? JSON.parse(unit.selected_weapons) : undefined} />
            </div>
          )}
        </>
      )}
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
  const [activeTab, setActiveTab] = useState<"units" | "stratagems">("units");

  const loadMatch = useCallback(async () => {
    const res = await fetch(`/api/matches/${matchId}`);
    if (res.ok) setMatch(await res.json());
    setLoading(false);
  }, [matchId]);

  useEffect(() => { loadMatch(); }, [loadMatch]);

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
      <div className="flex gap-3 mb-4 text-sm">
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
          onClick={() => setActiveTab("stratagems")}
          className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
            activeTab === "stratagems"
              ? "text-amber-400 border-amber-400"
              : "text-gray-400 border-transparent hover:text-white"
          }`}
        >
          Stratagems
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
            {squads.map(({ id, name }) =>
              renderSquadSection(match.units.filter(u => u.squad_id === id), name as string)
            )}
            {renderSquadSection(unassigned, unassigned.length > 0 ? "Unassigned" : null, "border-gray-700")}
          </div>
        )
      )}

      {/* Stratagems tab */}
      {activeTab === "stratagems" && (
        <StrategemsTab units={match.units} phase={match.phase} activePlayer={match.active_player} />
      )}
    </div>
  );
}
