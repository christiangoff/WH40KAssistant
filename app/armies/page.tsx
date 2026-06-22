"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface Army {
  id: number;
  name: string;
  faction: string | null;
  point_limit: number;
  created_at: number;
  unit_count: number;
  total_points: number;
}

export default function ArmiesPage() {
  const [armies, setArmies] = useState<Army[]>([]);
  const [factions, setFactions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPointLimit, setNewPointLimit] = useState(2000);
  const [newFaction, setNewFaction] = useState("");
  const [creating, setCreating] = useState(false);

  async function loadArmies() {
    const [armiesRes, unitsRes] = await Promise.all([
      fetch("/api/armies"),
      fetch("/api/units"),
    ]);
    const armiesData = await armiesRes.json();
    const unitsData = await unitsRes.json();
    setArmies(Array.isArray(armiesData) ? armiesData : []);
    const fs = Array.from(new Set(
      (Array.isArray(unitsData) ? unitsData : [])
        .map((u: { faction: string | null }) => u.faction)
        .filter(Boolean)
    )) as string[];
    setFactions(fs);
    setLoading(false);
  }

  useEffect(() => {
    loadArmies();
  }, []);

  async function handleCreate() {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/armies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim(), point_limit: newPointLimit, faction: newFaction || null }),
      });
      if (res.ok) {
        await loadArmies();
        setNewName("");
        setNewPointLimit(2000);
        setNewFaction("");
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
            {factions.length > 0 && (
              <select
                value={newFaction}
                onChange={(e) => setNewFaction(e.target.value)}
                className="bg-gray-800 border border-gray-700 rounded px-3 py-2 text-gray-300 text-sm focus:outline-none focus:border-amber-500"
              >
                <option value="">Any Faction</option>
                {factions.map(f => <option key={f} value={f}>{f}</option>)}
              </select>
            )}
            <div className="flex items-center gap-2">
              <label className="text-gray-400 text-sm">Point Limit:</label>
              <input
                type="number"
                value={newPointLimit}
                onChange={(e) => setNewPointLimit(parseInt(e.target.value) || 2000)}
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

      {loading ? (
        <div className="text-gray-400">Loading...</div>
      ) : armies.length === 0 ? (
        <div className="text-center py-16 text-gray-500">
          No armies yet. Create your first army!
        </div>
      ) : (
        <div className="space-y-3">
          {armies.map((army) => {
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
    </div>
  );
}
