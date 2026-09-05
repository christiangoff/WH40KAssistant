"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { normalizeFactionName } from "@/lib/text";

interface Army {
  id: number;
  name: string;
  faction: string | null;
  point_limit: number;
  created_at: number;
  unit_count: number;
  total_points: number;
}

interface SharedArmy extends Army {
  owner_username: string;
}

interface Faction {
  id: number;
  name: string;
}

type SortKey = "recent" | "name" | "faction" | "points" | "limit" | "units";

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "recent", label: "Date created" },
  { value: "name", label: "Army name" },
  { value: "faction", label: "Faction" },
  { value: "points", label: "Points used" },
  { value: "limit", label: "Point size" },
  { value: "units", label: "Unit count" },
];

function sortArmies<T extends Army>(list: T[], key: SortKey, dir: "asc" | "desc"): T[] {
  const mul = dir === "asc" ? 1 : -1;
  return [...list].sort((a, b) => {
    switch (key) {
      case "name":
        return a.name.localeCompare(b.name) * mul;
      case "faction":
        // Factionless armies always sort last, regardless of direction.
        if (a.faction == null && b.faction == null) return 0;
        if (a.faction == null) return 1;
        if (b.faction == null) return -1;
        return a.faction.localeCompare(b.faction) * mul;
      case "points":
        return (a.total_points - b.total_points) * mul;
      case "limit":
        return (a.point_limit - b.point_limit) * mul;
      case "units":
        return (a.unit_count - b.unit_count) * mul;
      case "recent":
      default:
        return (a.created_at - b.created_at) * mul;
    }
  });
}

export default function ArmiesPage() {
  const [armies, setArmies] = useState<Army[]>([]);
  const [sharedArmies, setSharedArmies] = useState<SharedArmy[]>([]);
  const [factions, setFactions] = useState<Faction[]>([]);
  const [legacyFactions, setLegacyFactions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPointLimit, setNewPointLimit] = useState("");
  const [newFactionKey, setNewFactionKey] = useState("");
  const [creating, setCreating] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("recent");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const sortedArmies = sortArmies(armies, sortKey, sortDir);
  const sortedSharedArmies = sortArmies(sharedArmies, sortKey, sortDir);

  // Every faction the user can build for: the ones an admin has synced (full
  // detachment/DP support) plus any faction they already own models in.
  const factionOptions: { value: string; label: string; id: number | null; name: string }[] = [
    ...factions.map((f) => ({ value: `s:${f.id}`, label: f.name, id: f.id, name: f.name })),
    ...legacyFactions
      .filter((name) => !factions.some((f) => normalizeFactionName(f.name) === normalizeFactionName(name)))
      .map((name) => ({ value: `c:${name}`, label: name, id: null, name })),
  ].sort((a, b) => a.label.localeCompare(b.label));

  async function loadArmies() {
    const [armiesRes, unitsRes, factionsRes, sharedRes] = await Promise.all([
      fetch("/api/armies"),
      fetch("/api/units"),
      fetch("/api/factions"),
      fetch("/api/armies/shared"),
    ]);
    const armiesData = await armiesRes.json();
    const unitsData = await unitsRes.json();
    setArmies(Array.isArray(armiesData) ? armiesData : []);
    setSharedArmies(sharedRes.ok ? await sharedRes.json() : []);
    const fs = Array.from(new Set(
      (Array.isArray(unitsData) ? unitsData : [])
        .map((u: { faction: string | null }) => u.faction)
        .filter(Boolean)
    )) as string[];
    setLegacyFactions(fs);
    setFactions(factionsRes.ok ? await factionsRes.json() : []);
    setLoading(false);
  }

  useEffect(() => {
    loadArmies();
  }, []);

  async function handleCreate() {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const opt = factionOptions.find((o) => o.value === newFactionKey);
      const res = await fetch("/api/armies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newName.trim(),
          point_limit: parseInt(newPointLimit, 10) || 2000,
          faction: opt?.name ?? null,
          faction_id: opt?.id ?? null,
        }),
      });
      if (res.ok) {
        await loadArmies();
        setNewName("");
        setNewPointLimit("");
        setNewFactionKey("");
        setShowCreate(false);
      }
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(id: number, name: string) {
    if (!confirm(`Delete army "${name}"? This cannot be undone.`)) return;
    const res = await fetch(`/api/armies/${id}`, { method: "DELETE" });
    if (res.ok) {
      await loadArmies();
    }
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-amber-400 uppercase tracking-wide">
          Armies
        </h1>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="bg-red-700 hover:bg-red-600 text-white px-4 py-2 rounded font-medium transition-colors"
        >
          + Create Army
        </button>
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="bg-gray-900 border border-gray-700 rounded-lg p-4 mb-6">
          <h2 className="text-white font-bold mb-3">New Army</h2>
          <div className="flex flex-wrap gap-3">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Army name..."
              className="flex-1 min-w-48 bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-amber-500"
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            />
            {factionOptions.length > 0 && (
              <select
                value={newFactionKey}
                onChange={(e) => setNewFactionKey(e.target.value)}
                className="bg-gray-800 border border-gray-700 rounded px-3 py-2 text-gray-300 text-sm focus:outline-none focus:border-amber-500"
              >
                <option value="">Any Faction</option>
                {factionOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            )}
            <div className="flex items-center gap-2">
              <label className="text-gray-400 text-sm">Point Limit:</label>
              <input
                type="number"
                value={newPointLimit}
                onChange={(e) => setNewPointLimit(e.target.value)}
                placeholder="2000"
                className="w-24 bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-amber-500"
                min={0}
                step={500}
              />
            </div>
            <button
              onClick={handleCreate}
              disabled={creating}
              className="bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white px-4 py-2 rounded font-medium text-sm transition-colors"
            >
              {creating ? "Creating..." : "Create"}
            </button>
            <button
              onClick={() => setShowCreate(false)}
              className="bg-gray-700 hover:bg-gray-600 text-gray-300 px-3 py-2 rounded text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {!loading && (armies.length > 0 || sharedArmies.length > 0) && (
        <div className="flex items-center gap-2 mb-4">
          <label className="text-gray-500 text-sm">Sort by:</label>
          <select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
            className="bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-gray-300 text-sm focus:outline-none focus:border-amber-500"
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <button
            onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
            title={sortDir === "asc" ? "Ascending" : "Descending"}
            className="bg-gray-800 border border-gray-700 hover:bg-gray-700 rounded px-2 py-1.5 text-gray-300 text-sm transition-colors"
          >
            {sortDir === "asc" ? "↑" : "↓"}
          </button>
        </div>
      )}

      {loading ? (
        <div className="text-gray-400">Loading...</div>
      ) : armies.length === 0 ? (
        <div className="text-center py-16 text-gray-500">
          No armies yet. Create your first army!
        </div>
      ) : (
        <div className="space-y-3">
          {sortedArmies.map((army) => {
            const pct = Math.min(100, Math.round((army.total_points / army.point_limit) * 100));
            const overLimit = army.total_points > army.point_limit;

            return (
              <div
                key={army.id}
                className="bg-gray-900 border border-gray-800 rounded-lg p-4 hover:border-gray-700 transition-colors"
              >
                <div className="flex items-center justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-3 flex-wrap">
                      <Link
                        href={`/armies/${army.id}`}
                        className="text-white font-bold text-lg hover:text-amber-400 transition-colors"
                      >
                        {army.name}
                      </Link>
                      {army.faction && (
                        <span className="text-xs bg-gray-800 border border-gray-700 text-amber-300 px-2 py-0.5 rounded">
                          {army.faction}
                        </span>
                      )}
                      <span className="text-gray-500 text-sm">
                        {army.unit_count} unit{army.unit_count !== 1 ? "s" : ""}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-2">
                      <span
                        className={`text-sm font-mono font-bold ${
                          overLimit ? "text-red-400" : "text-green-400"
                        }`}
                      >
                        {army.total_points} / {army.point_limit} pts
                      </span>
                      <div className="flex-1 max-w-xs h-2 bg-gray-800 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${
                            overLimit ? "bg-red-600" : "bg-green-600"
                          }`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="text-gray-500 text-xs">{pct}%</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Link
                      href={`/armies/${army.id}`}
                      className="bg-gray-700 hover:bg-gray-600 text-white px-3 py-1.5 rounded text-sm transition-colors"
                    >
                      Edit
                    </Link>
                    <button
                      onClick={() => handleDelete(army.id, army.name)}
                      className="text-gray-600 hover:text-red-400 text-sm px-2 py-1.5 transition-colors"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {sharedArmies.length > 0 && (
        <div className="mt-8">
          <h2 className="text-gray-500 text-xs uppercase tracking-wide font-bold mb-3">
            Shared with you
          </h2>
          <div className="space-y-3">
            {sortedSharedArmies.map((army) => {
              const pct = Math.min(100, Math.round((army.total_points / army.point_limit) * 100));
              const overLimit = army.total_points > army.point_limit;

              return (
                <div
                  key={army.id}
                  className="bg-gray-900 border border-gray-800 rounded-lg p-4 hover:border-gray-700 transition-colors"
                >
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-3 flex-wrap">
                        <Link
                          href={`/armies/${army.id}/export`}
                          className="text-white font-bold text-lg hover:text-amber-400 transition-colors"
                        >
                          {army.name}
                        </Link>
                        {army.faction && (
                          <span className="text-xs bg-gray-800 border border-gray-700 text-amber-300 px-2 py-0.5 rounded">
                            {army.faction}
                          </span>
                        )}
                        <span className="text-gray-500 text-sm">
                          {army.unit_count} unit{army.unit_count !== 1 ? "s" : ""}
                        </span>
                        <span className="text-gray-500 text-sm">· by {army.owner_username}</span>
                      </div>
                      <div className="flex items-center gap-3 mt-2">
                        <span
                          className={`text-sm font-mono font-bold ${
                            overLimit ? "text-red-400" : "text-green-400"
                          }`}
                        >
                          {army.total_points} / {army.point_limit} pts
                        </span>
                        <div className="flex-1 max-w-xs h-2 bg-gray-800 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${
                              overLimit ? "bg-red-600" : "bg-green-600"
                            }`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="text-gray-500 text-xs">{pct}%</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Link
                        href={`/armies/${army.id}/export`}
                        className="bg-gray-700 hover:bg-gray-600 text-white px-3 py-1.5 rounded text-sm transition-colors"
                      >
                        View
                      </Link>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
