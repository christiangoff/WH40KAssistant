"use client";

import { useEffect, useState } from "react";
import StatBlock from "@/components/StatBlock";
import { UnitStats } from "@/lib/wahapedia";

interface Unit {
  id: number;
  name: string;
  faction: string | null;
  wahapedia_url: string | null;
  quantity: number;
  stats_json: string | null;
  stats_fetched_at: number | null;
  notes: string | null;
}

function UnitCard({
  unit,
  onUpdate,
  onDelete,
  onRefetchStats,
}: {
  unit: Unit;
  onUpdate: (id: number, updates: Partial<Unit>) => Promise<void>;
  onDelete: (id: number) => void;
  onRefetchStats: (id: number) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editingNotes, setEditingNotes] = useState(false);
  const [notes, setNotes] = useState(unit.notes || "");
  const [quantity, setQuantity] = useState(unit.quantity);
  const [fetching, setFetching] = useState(false);

  const stats: UnitStats | null = unit.stats_json ? JSON.parse(unit.stats_json) : null;

  async function handleQuantityChange(delta: number) {
    const newQty = Math.max(0, quantity + delta);
    setQuantity(newQty);
    await onUpdate(unit.id, { quantity: newQty });
  }

  async function handleSaveNotes() {
    await onUpdate(unit.id, { notes });
    setEditingNotes(false);
  }

  async function handleRefetch() {
    setFetching(true);
    try {
      await onRefetchStats(unit.id);
    } finally {
      setFetching(false);
    }
  }

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
      {/* Card header */}
      <div className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <h3 className="text-white font-bold text-lg leading-tight truncate">
              {unit.name}
            </h3>
            {unit.faction && (
              <p className="text-amber-400 text-sm">{unit.faction}</p>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <span className="text-gray-500 text-xs">Models:</span>
            <button
              onClick={() => handleQuantityChange(-1)}
              className="w-7 h-7 bg-gray-700 hover:bg-gray-600 rounded text-white text-sm font-bold"
            >
              -
            </button>
            <span className="w-8 text-center text-white font-bold">{quantity}</span>
            <button
              onClick={() => handleQuantityChange(1)}
              className="w-7 h-7 bg-gray-700 hover:bg-gray-600 rounded text-white text-sm font-bold"
            >
              +
            </button>
          </div>
        </div>

        {/* Quick stats row */}
        {stats && (
          <div className="flex gap-3 mt-3">
            {[
              { label: "M", value: stats.M },
              { label: "T", value: stats.T },
              { label: "W", value: stats.W },
              { label: "Sv", value: stats.Sv },
            ].map((s) => (
              <div key={s.label} className="text-center">
                <div className="text-amber-400 text-xs font-bold">{s.label}</div>
                <div className="text-white text-sm font-mono">{s.value}</div>
              </div>
            ))}
            {stats.points_per_model && (
              <div className="text-center ml-auto">
                <div className="text-amber-400 text-xs font-bold">PTS/MODEL</div>
                <div className="text-white text-sm font-mono">{stats.points_per_model}</div>
              </div>
            )}
          </div>
        )}

        {!stats && (
          <div className="mt-2 text-gray-500 text-xs">No stats cached yet</div>
        )}

        {/* Notes */}
        {editingNotes ? (
          <div className="mt-3">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-gray-200 resize-none"
              rows={2}
              placeholder="Notes..."
            />
            <div className="flex gap-2 mt-1">
              <button
                onClick={handleSaveNotes}
                className="text-xs bg-amber-600 hover:bg-amber-500 text-white px-2 py-1 rounded"
              >
                Save
              </button>
              <button
                onClick={() => setEditingNotes(false)}
                className="text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 px-2 py-1 rounded"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          unit.notes && (
            <p
              onClick={() => setEditingNotes(true)}
              className="mt-2 text-gray-400 text-xs cursor-pointer hover:text-gray-300"
            >
              {unit.notes}
            </p>
          )
        )}
      </div>

      {/* Actions bar */}
      <div className="border-t border-gray-800 px-4 py-2 flex items-center gap-2 flex-wrap">
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-xs text-gray-400 hover:text-white transition-colors"
        >
          {expanded ? "▲ Hide Stats" : "▼ Full Stats"}
        </button>
        {!editingNotes && (
          <button
            onClick={() => setEditingNotes(true)}
            className="text-xs text-gray-400 hover:text-white transition-colors"
          >
            Notes
          </button>
        )}
        {unit.wahapedia_url && (
          <button
            onClick={handleRefetch}
            disabled={fetching}
            className="text-xs text-gray-400 hover:text-blue-400 transition-colors disabled:opacity-50"
          >
            {fetching ? "Fetching..." : "↻ Refresh Stats"}
          </button>
        )}
        {unit.wahapedia_url && (
          <a
            href={unit.wahapedia_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-gray-400 hover:text-amber-400 transition-colors ml-auto"
          >
            Wahapedia ↗
          </a>
        )}
        <button
          onClick={() => onDelete(unit.id)}
          className="text-xs text-gray-600 hover:text-red-400 transition-colors ml-auto"
        >
          Delete
        </button>
      </div>

      {/* Expanded stats */}
      {expanded && stats && (
        <div className="border-t border-gray-800 p-4">
          <StatBlock stats={stats} />
        </div>
      )}
    </div>
  );
}

export default function CollectionPage() {
  const [units, setUnits] = useState<Unit[]>([]);
  const [loading, setLoading] = useState(true);
  const [showImport, setShowImport] = useState(false);
  const [importUrl, setImportUrl] = useState("");
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState("");
  const [search, setSearch] = useState("");

  async function loadUnits() {
    const res = await fetch("/api/units");
    const data = await res.json();
    setUnits(Array.isArray(data) ? data : []);
    setLoading(false);
  }

  useEffect(() => {
    loadUnits();
  }, []);

  async function handleImport() {
    if (!importUrl.trim()) return;
    setImporting(true);
    setImportError("");

    try {
      // First create the unit with the URL
      const createRes = await fetch("/api/units", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Importing...",
          wahapedia_url: importUrl.trim(),
        }),
      });

      if (!createRes.ok) {
        const err = await createRes.json();
        throw new Error(err.error || "Failed to create unit");
      }

      const newUnit: Unit = await createRes.json();

      // Then fetch stats
      const statsRes = await fetch(`/api/units/${newUnit.id}/fetch-stats`, {
        method: "POST",
      });

      if (!statsRes.ok) {
        const err = await statsRes.json();
        throw new Error(err.error || "Failed to fetch stats");
      }

      await loadUnits();
      setImportUrl("");
      setShowImport(false);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setImporting(false);
    }
  }

  async function handleUpdate(id: number, updates: Partial<Unit>) {
    const unit = units.find((u) => u.id === id);
    if (!unit) return;

    await fetch(`/api/units/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...unit, ...updates }),
    });

    setUnits((prev) =>
      prev.map((u) => (u.id === id ? { ...u, ...updates } : u))
    );
  }

  async function handleDelete(id: number) {
    if (!confirm("Delete this unit from your collection?")) return;
    await fetch(`/api/units/${id}`, { method: "DELETE" });
    setUnits((prev) => prev.filter((u) => u.id !== id));
  }

  async function handleRefetchStats(id: number) {
    const res = await fetch(`/api/units/${id}/fetch-stats`, { method: "POST" });
    if (res.ok) {
      const updated: Unit = await res.json();
      setUnits((prev) => prev.map((u) => (u.id === id ? updated : u)));
    }
  }

  const filtered = units.filter(
    (u) =>
      !search ||
      u.name.toLowerCase().includes(search.toLowerCase()) ||
      (u.faction || "").toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-amber-400 uppercase tracking-wide">
          Collection
        </h1>
        <button
          onClick={() => setShowImport(!showImport)}
          className="bg-red-700 hover:bg-red-600 text-white px-4 py-2 rounded font-medium transition-colors"
        >
          + Import Unit
        </button>
      </div>

      {/* Import form */}
      {showImport && (
        <div className="bg-gray-900 border border-gray-700 rounded-lg p-4 mb-6">
          <h2 className="text-white font-bold mb-3">Import from Wahapedia</h2>
          <p className="text-gray-400 text-sm mb-3">
            Paste the Wahapedia URL for the unit (e.g.,{" "}
            <code className="bg-gray-800 px-1 rounded text-amber-300 text-xs">
              https://wahapedia.ru/wh40k10ed/factions/space-marines/Space-Marine-Captain/
            </code>
            )
          </p>
          <div className="flex gap-2">
            <input
              type="url"
              value={importUrl}
              onChange={(e) => setImportUrl(e.target.value)}
              placeholder="https://wahapedia.ru/wh40k10ed/factions/..."
              className="flex-1 bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-amber-500"
              onKeyDown={(e) => e.key === "Enter" && handleImport()}
            />
            <button
              onClick={handleImport}
              disabled={importing}
              className="bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white px-4 py-2 rounded font-medium text-sm transition-colors"
            >
              {importing ? "Importing..." : "Import"}
            </button>
            <button
              onClick={() => { setShowImport(false); setImportError(""); }}
              className="bg-gray-700 hover:bg-gray-600 text-gray-300 px-3 py-2 rounded text-sm"
            >
              Cancel
            </button>
          </div>
          {importError && (
            <p className="text-red-400 text-sm mt-2">{importError}</p>
          )}
        </div>
      )}

      {/* Search */}
      {units.length > 0 && (
        <div className="mb-4">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search units..."
            className="w-full max-w-sm bg-gray-900 border border-gray-700 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-amber-500"
          />
        </div>
      )}

      {/* Units grid */}
      {loading ? (
        <div className="text-gray-400">Loading...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-gray-500">
          {units.length === 0
            ? "No units yet. Import your first unit from Wahapedia!"
            : "No units match your search."}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((unit) => (
            <UnitCard
              key={unit.id}
              unit={unit}
              onUpdate={handleUpdate}
              onDelete={handleDelete}
              onRefetchStats={handleRefetchStats}
            />
          ))}
        </div>
      )}
    </div>
  );
}
