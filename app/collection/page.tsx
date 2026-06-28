"use client";

import { useEffect, useRef, useState } from "react";
import StatBlock from "@/components/StatBlock";
import { UnitStats, WeaponProfile } from "@/lib/wahapedia";

interface Unit {
  id: number;
  name: string;
  faction: string | null;
  wahapedia_url: string | null;
  quantity: number;
  stats_json: string | null;
  stats_fetched_at: number | null;
  notes: string | null;
  detachment: string | null;
}

const EMPTY_WEAPON: WeaponProfile = { name: "", type: "ranged", range: "", attacks: "", bsWs: "", strength: "", ap: "", damage: "", abilities: "" };

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

  // Edit stats state
  const [editMode, setEditMode] = useState(false);
  const [eName, setEName] = useState("");
  const [eFaction, setEFaction] = useState("");
  const [ePoints, setEPoints] = useState("");
  const [eM, setEM] = useState("");
  const [eT, setET] = useState("");
  const [eW, setEW] = useState("");
  const [eSv, setESv] = useState("");
  const [eLd, setELd] = useState("");
  const [eOC, setEOC] = useState("");
  const [eInvuln, setEInvuln] = useState("");
  const [eKeywords, setEKeywords] = useState("");
  const [eWeapons, setEWeapons] = useState<WeaponProfile[]>([]);
  const [eShowWeapons, setEShowWeapons] = useState(false);
  const [eSaving, setESaving] = useState(false);
  const [eError, setEError] = useState("");

  const stats: UnitStats | null = unit.stats_json ? JSON.parse(unit.stats_json) : null;

  function enterEdit() {
    setEName(unit.name);
    setEFaction(unit.faction || "");
    setEPoints(stats?.points_per_model?.toString() || "");
    setEM(stats?.M || "");
    setET(stats?.T || "");
    setEW(stats?.W || "");
    setESv(stats?.Sv || "");
    setELd(stats?.Ld || "");
    setEOC(stats?.OC || "");
    setEInvuln(stats?.invuln || "");
    setEKeywords(stats?.keywords?.join(", ") || "");
    setEWeapons(stats?.weapons?.length ? [...stats.weapons] : []);
    setEShowWeapons((stats?.weapons?.length || 0) > 0);
    setEError("");
    setEditMode(true);
  }

  async function handleEditSave() {
    if (!eName.trim()) { setEError("Name is required"); return; }
    setESaving(true);
    setEError("");
    const hasStats = eM || eT || eW || eSv || eLd || eOC;
    const newStats: UnitStats | null = hasStats ? {
      name: eName.trim(),
      faction: eFaction.trim(),
      M: eM || "–", T: eT || "–", W: eW || "–",
      Sv: eSv || "–", Ld: eLd || "–", OC: eOC || "–",
      invuln: eInvuln || undefined,
      keywords: eKeywords.split(",").map(k => k.trim()).filter(Boolean),
      abilities: stats?.abilities || [],
      weapons: eWeapons.filter(w => w.name.trim()),
      wargear_options: stats?.wargear_options || [],
      stratagems: stats?.stratagems || [],
      points_per_model: ePoints ? Number(ePoints) : undefined,
      points_table: stats?.points_table || [],
    } : null;
    try {
      await onUpdate(unit.id, {
        name: eName.trim(),
        faction: eFaction.trim() || null,
        stats_json: newStats ? JSON.stringify(newStats) : null,
      });
      setEditMode(false);
    } catch {
      setEError("Failed to save");
    } finally {
      setESaving(false);
    }
  }

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

  if (editMode) {
    return (
      <div className="bg-gray-900 border border-amber-700 rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between">
          <span className="text-amber-400 text-sm font-bold uppercase tracking-wide">Edit Unit</span>
          <button onClick={() => setEditMode(false)} className="text-gray-500 hover:text-white text-xs">Cancel</button>
        </div>
        <div className="p-4 space-y-3">
          {/* Name & Faction */}
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 sm:col-span-1">
              <label className="text-gray-400 text-xs block mb-1">Name *</label>
              <input value={eName} onChange={e => setEName(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-amber-500" />
            </div>
            <div className="col-span-2 sm:col-span-1">
              <label className="text-gray-400 text-xs block mb-1">Faction</label>
              <input value={eFaction} onChange={e => setEFaction(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-amber-500" />
            </div>
          </div>

          {/* Points */}
          <div className="w-32">
            <label className="text-gray-400 text-xs block mb-1">Pts / Model</label>
            <input type="number" min="0" value={ePoints} onChange={e => setEPoints(e.target.value)} placeholder="80"
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-amber-500" />
          </div>

          {/* Stats */}
          <div>
            <label className="text-gray-500 text-xs uppercase font-bold block mb-2">Stats</label>
            <div className="grid grid-cols-4 sm:grid-cols-7 gap-2">
              {[
                { label: "M", value: eM, set: setEM, placeholder: '6"' },
                { label: "T", value: eT, set: setET, placeholder: "4" },
                { label: "W", value: eW, set: setEW, placeholder: "4" },
                { label: "Sv", value: eSv, set: setESv, placeholder: "3+" },
                { label: "Ld", value: eLd, set: setELd, placeholder: "6+" },
                { label: "OC", value: eOC, set: setEOC, placeholder: "1" },
                { label: "Inv", value: eInvuln, set: setEInvuln, placeholder: "4++" },
              ].map(({ label, value, set, placeholder }) => (
                <div key={label}>
                  <div className="text-amber-400 text-xs font-bold text-center mb-1">{label}</div>
                  <input value={value} onChange={e => set(e.target.value)} placeholder={placeholder}
                    className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-white text-sm text-center font-mono focus:outline-none focus:border-amber-500" />
                </div>
              ))}
            </div>
          </div>

          {/* Keywords */}
          <div>
            <label className="text-gray-400 text-xs block mb-1">Keywords</label>
            <input value={eKeywords} onChange={e => setEKeywords(e.target.value)}
              placeholder="Infantry, Character, Adeptus Astartes"
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-amber-500" />
          </div>

          {/* Weapons */}
          <div>
            <button onClick={() => setEShowWeapons(v => !v)}
              className="text-gray-400 hover:text-white text-xs font-bold uppercase tracking-wide">
              {eShowWeapons ? "▲" : "▶"} Weapons ({eWeapons.length})
            </button>
            {eShowWeapons && (
              <div className="mt-2 space-y-3">
                {eWeapons.map((w, i) => (
                  <div key={i} className="bg-gray-800 rounded p-3">
                    <div className="grid grid-cols-2 gap-2 mb-2">
                      <div className="col-span-2 sm:col-span-1">
                        <label className="text-gray-500 text-xs block mb-0.5">Name</label>
                        <input value={w.name}
                          onChange={e => setEWeapons(p => p.map((x, j) => j === i ? { ...x, name: e.target.value } : x))}
                          className="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1 text-white text-sm focus:outline-none focus:border-amber-500" />
                      </div>
                      <div>
                        <label className="text-gray-500 text-xs block mb-0.5">Type</label>
                        <select value={w.type}
                          onChange={e => setEWeapons(p => p.map((x, j) => j === i ? { ...x, type: e.target.value as "ranged" | "melee" } : x))}
                          className="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1 text-white text-sm focus:outline-none focus:border-amber-500">
                          <option value="ranged">Ranged</option>
                          <option value="melee">Melee</option>
                        </select>
                      </div>
                    </div>
                    <div className="grid grid-cols-4 gap-2 mb-2">
                      {([
                        { label: "Range", key: "range" as const, placeholder: '24"' },
                        { label: "A", key: "attacks" as const, placeholder: "3" },
                        { label: "BS/WS", key: "bsWs" as const, placeholder: "3+" },
                        { label: "S", key: "strength" as const, placeholder: "4" },
                        { label: "AP", key: "ap" as const, placeholder: "-1" },
                        { label: "D", key: "damage" as const, placeholder: "1" },
                      ] as const).map(({ label, key, placeholder }) => (
                        <div key={key}>
                          <label className="text-gray-500 text-xs block mb-0.5">{label}</label>
                          <input value={w[key]}
                            onChange={e => setEWeapons(p => p.map((x, j) => j === i ? { ...x, [key]: e.target.value } : x))}
                            placeholder={placeholder}
                            className="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1 text-white text-sm text-center font-mono focus:outline-none focus:border-amber-500" />
                        </div>
                      ))}
                    </div>
                    <div className="flex items-start gap-2">
                      <div className="flex-1">
                        <label className="text-gray-500 text-xs block mb-0.5">Abilities</label>
                        <input value={w.abilities}
                          onChange={e => setEWeapons(p => p.map((x, j) => j === i ? { ...x, abilities: e.target.value } : x))}
                          placeholder="Devastating Wounds, Rapid Fire 1"
                          className="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1 text-white text-sm focus:outline-none focus:border-amber-500" />
                      </div>
                      <button onClick={() => setEWeapons(p => p.filter((_, j) => j !== i))}
                        className="text-gray-600 hover:text-red-400 text-xs mt-4">Remove</button>
                    </div>
                  </div>
                ))}
                <button onClick={() => setEWeapons(p => [...p, { ...EMPTY_WEAPON }])}
                  className="text-sm text-amber-400 hover:text-amber-300">+ Add Weapon</button>
              </div>
            )}
          </div>

          {eError && <p className="text-red-400 text-sm">{eError}</p>}
          <div className="flex gap-2 pt-1">
            <button onClick={handleEditSave} disabled={eSaving}
              className="bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white px-4 py-2 rounded font-medium text-sm transition-colors">
              {eSaving ? "Saving..." : "Save Changes"}
            </button>
            <button onClick={() => setEditMode(false)}
              className="bg-gray-700 hover:bg-gray-600 text-gray-300 px-3 py-2 rounded text-sm">
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
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
            <span className="text-gray-500 text-xs">Squads:</span>
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
              ...(stats.invuln ? [{ label: "Inv", value: stats.invuln }] : []),
            ].map((s) => (
              <div key={s.label} className="text-center">
                <div className="text-amber-400 text-xs font-bold">{s.label}</div>
                <div className="text-white text-sm font-mono">{s.value}</div>
              </div>
            ))}
            {stats.mfm_tiers && stats.mfm_tiers.length > 0 ? (
              <div className="ml-auto text-right space-y-0.5">
                {stats.mfm_tiers.map((tier) => (
                  <div key={tier.copies} className="text-xs leading-tight">
                    {stats.mfm_tiers!.length > 1 && (
                      <span className="text-gray-500 mr-1">
                        {tier.copies === "all" ? "" : tier.copies === "1st-2nd" ? "1–2:" : tier.copies === "3rd+" ? "3+:" : "2+:"}
                      </span>
                    )}
                    {tier.entries.map((e, i) => (
                      <span key={e.models} className={tier.copies === "3rd+" || tier.copies === "2nd+" ? "text-orange-400 font-mono" : "text-amber-400 font-mono"}>
                        {i > 0 && <span className="text-gray-600"> / </span>}
                        {e.models}m:{e.points}
                      </span>
                    ))}
                  </div>
                ))}
              </div>
            ) : stats.points_per_model ? (
              <div className="text-center ml-auto">
                <div className="text-amber-400 text-xs font-bold">PTS/MODEL</div>
                <div className="text-white text-sm font-mono">{stats.points_per_model}</div>
              </div>
            ) : null}
          </div>
        )}

        {!stats && (
          <div className="mt-2 text-gray-500 text-xs">No stats cached yet</div>
        )}

        {/* Detachment selector */}
        {stats?.stratagems && stats.stratagems.length > 0 && (() => {
          const detachments = Array.from(
            new Set(stats.stratagems.map(s => s.type).filter(t => t && !t.toLowerCase().includes("core")))
          ).sort();
          if (detachments.length === 0) return null;
          return (
            <div className="mt-2 flex items-center gap-2">
              <span className="text-gray-500 text-xs shrink-0">Default Detachment:</span>
              <select
                value={unit.detachment ?? ""}
                onChange={e => onUpdate(unit.id, { detachment: e.target.value || null })}
                className="flex-1 bg-gray-800 border border-gray-700 rounded px-2 py-0.5 text-xs text-white focus:outline-none focus:border-amber-500"
              >
                <option value="">— none —</option>
                {detachments.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
          );
        })()}

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
        <button
          onClick={enterEdit}
          className="text-xs text-gray-400 hover:text-amber-400 transition-colors"
        >
          Edit Stats
        </button>
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
          <StatBlock stats={stats} selectedDetachment={unit.detachment} />
        </div>
      )}
    </div>
  );
}

export default function CollectionPage() {
  const [units, setUnits] = useState<Unit[]>([]);
  const [loading, setLoading] = useState(true);
  const [formMode, setFormMode] = useState<null | "wahapedia" | "manual">(null);
  const [importUrl, setImportUrl] = useState("");
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState("");
  const [search, setSearch] = useState("");
  const [exportFaction, setExportFaction] = useState("");
  const [exportOpen, setExportOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [showPrintPanel, setShowPrintPanel] = useState(false);
  const [printIds, setPrintIds] = useState<Set<number>>(new Set());
  const [printFormat, setPrintFormat] = useState<"pdf" | "jpg">("pdf");
  const exportRef = useRef<HTMLDivElement>(null);
  const addRef = useRef<HTMLDivElement>(null);

  // Manual form state
  const [mName, setMName] = useState("");
  const [mFaction, setMFaction] = useState("");
  const [mQty, setMQty] = useState("1");
  const [mPoints, setMPoints] = useState("");
  const [mM, setMM] = useState("");
  const [mT, setMT] = useState("");
  const [mW, setMW] = useState("");
  const [mSv, setMSv] = useState("");
  const [mLd, setMLd] = useState("");
  const [mOC, setMOC] = useState("");
  const [mInvuln, setMInvuln] = useState("");
  const [mKeywords, setMKeywords] = useState("");
  const [mWeapons, setMWeapons] = useState<WeaponProfile[]>([]);
  const [showWeapons, setShowWeapons] = useState(false);
  const [mSubmitting, setMSubmitting] = useState(false);
  const [mError, setMError] = useState("");

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) {
        setExportOpen(false);
      }
      if (addRef.current && !addRef.current.contains(e.target as Node)) {
        setAddOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

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
      setFormMode(null);
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

  function resetManualForm() {
    setMName(""); setMFaction(""); setMQty("1"); setMPoints("");
    setMM(""); setMT(""); setMW(""); setMSv(""); setMLd(""); setMOC(""); setMInvuln("");
    setMKeywords(""); setMWeapons([]); setShowWeapons(false); setMError("");
  }

  async function handleManualSubmit() {
    if (!mName.trim()) { setMError("Name is required"); return; }
    setMSubmitting(true);
    setMError("");
    const hasStats = mM || mT || mW || mSv || mLd || mOC;
    const stats: UnitStats | null = hasStats ? {
      name: mName.trim(),
      faction: mFaction.trim(),
      M: mM || "–", T: mT || "–", W: mW || "–",
      Sv: mSv || "–", Ld: mLd || "–", OC: mOC || "–",
      invuln: mInvuln || undefined,
      keywords: mKeywords.split(",").map(k => k.trim()).filter(Boolean),
      abilities: [],
      weapons: mWeapons.filter(w => w.name.trim()),
      wargear_options: [],
      stratagems: [],
      points_per_model: mPoints ? Number(mPoints) : undefined,
      points_table: [],
    } : null;
    try {
      const res = await fetch("/api/units", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: mName.trim(),
          faction: mFaction.trim() || undefined,
          quantity: Number(mQty) || 1,
          stats_json: stats ? JSON.stringify(stats) : undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to add unit");
      }
      await loadUnits();
      resetManualForm();
      setFormMode(null);
    } catch (err) {
      setMError(err instanceof Error ? err.message : "Failed to add unit");
    } finally {
      setMSubmitting(false);
    }
  }

  const filtered = units.filter(
    (u) =>
      !search ||
      u.name.toLowerCase().includes(search.toLowerCase()) ||
      (u.faction || "").toLowerCase().includes(search.toLowerCase())
  );

  const factions = Array.from(new Set(units.map(u => u.faction).filter(Boolean))) as string[];

  function download(format: string) {
    if (format === "cards") {
      setExportOpen(false);
      if (!showPrintPanel) {
        setPrintIds(new Set(units.filter(u => u.stats_json).map(u => u.id)));
      }
      setShowPrintPanel(v => !v);
      return;
    }
    const params = new URLSearchParams({ format });
    if (exportFaction) params.set("faction", exportFaction);
    window.location.href = `/api/export?${params}`;
    setExportOpen(false);
  }

  const exportOptions = [
    {
      format: "cards",
      label: "Unit Cards (PDF / JPG)",
      description: "Select units and export as print-ready reference cards for offline play",
      icon: "🃏",
    },
    {
      format: "md",
      label: "AI / Markdown",
      description: "Full stats, weapons & wargear options — upload to Claude, ChatGPT, etc. for army suggestions",
      icon: "🤖",
    },
    {
      format: "csv",
      label: "Spreadsheet (CSV)",
      description: "One row per unit with key stats — open in Excel or Google Sheets",
      icon: "📊",
    },
    {
      format: "roster",
      label: "Army Roster (Text)",
      description: "Clean printable roster of all your built armies with points",
      icon: "📋",
    },
    {
      format: "json",
      label: "JSON Backup",
      description: "Complete data backup — all stats, weapons, and armies",
      icon: "💾",
    },
  ];

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
        <h1 className="text-2xl font-bold text-amber-400 uppercase tracking-wide">
          Collection
        </h1>
        <div className="flex items-center gap-2 flex-wrap">
          {factions.length > 1 && (
            <select
              value={exportFaction}
              onChange={e => setExportFaction(e.target.value)}
              className="bg-gray-800 border border-gray-700 rounded px-2 py-2 text-gray-300 text-sm focus:outline-none focus:border-amber-500"
            >
              <option value="">All Factions</option>
              {factions.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
          )}
          {/* Export dropdown */}
          <div className="relative" ref={exportRef}>
            <button
              onClick={() => setExportOpen(v => !v)}
              className="bg-gray-700 hover:bg-gray-600 text-gray-200 px-4 py-2 rounded font-medium transition-colors text-sm flex items-center gap-1.5"
            >
              Export
              <span className="text-gray-400 text-xs">{exportOpen ? "▲" : "▼"}</span>
            </button>
            {exportOpen && (
              <div className="absolute right-0 top-full mt-1 w-80 bg-gray-900 border border-gray-700 rounded-lg shadow-xl z-20 overflow-hidden">
                {exportOptions.map(opt => (
                  <button
                    key={opt.format}
                    onClick={() => download(opt.format)}
                    className="w-full text-left px-4 py-3 hover:bg-gray-800 transition-colors border-b border-gray-800 last:border-0"
                  >
                    <div className="flex items-center gap-2 mb-0.5">
                      <span>{opt.icon}</span>
                      <span className="text-white text-sm font-medium">{opt.label}</span>
                    </div>
                    <div className="text-gray-400 text-xs pl-6">{opt.description}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="relative" ref={addRef}>
            <button
              onClick={() => setAddOpen(v => !v)}
              className="bg-red-700 hover:bg-red-600 text-white px-4 py-2 rounded font-medium transition-colors text-sm flex items-center gap-1.5"
            >
              + Add Unit
              <span className="text-red-300 text-xs">{addOpen ? "▲" : "▼"}</span>
            </button>
            {addOpen && (
              <div className="absolute right-0 top-full mt-1 w-52 bg-gray-900 border border-gray-700 rounded-lg shadow-xl z-20 overflow-hidden">
                <button
                  onClick={() => { setFormMode("wahapedia"); setAddOpen(false); resetManualForm(); setImportError(""); }}
                  className="w-full text-left px-4 py-3 hover:bg-gray-800 transition-colors border-b border-gray-800"
                >
                  <div className="text-white text-sm font-medium">Import from Wahapedia</div>
                  <div className="text-gray-500 text-xs mt-0.5">Fetch stats automatically by URL</div>
                </button>
                <button
                  onClick={() => { setFormMode("manual"); setAddOpen(false); setImportUrl(""); setImportError(""); }}
                  className="w-full text-left px-4 py-3 hover:bg-gray-800 transition-colors"
                >
                  <div className="text-white text-sm font-medium">Add Manually</div>
                  <div className="text-gray-500 text-xs mt-0.5">Enter name, stats, and weapons yourself</div>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Unit Cards export panel */}
      {showPrintPanel && (
        <div className="bg-gray-900 border border-amber-700/40 rounded-lg p-4 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-amber-400 font-bold text-sm uppercase tracking-wide">Unit Cards Export</h2>
            <button onClick={() => setShowPrintPanel(false)} className="text-gray-500 hover:text-white text-xs">✕ Close</button>
          </div>

          {/* Format */}
          <div className="flex items-center gap-3 mb-4">
            <span className="text-gray-400 text-xs">Format:</span>
            <div className="flex bg-gray-800 rounded p-0.5">
              {(["pdf", "jpg"] as const).map(f => (
                <button
                  key={f}
                  onClick={() => setPrintFormat(f)}
                  className={`px-4 py-1.5 rounded text-xs font-bold uppercase transition-colors ${
                    printFormat === f ? "bg-amber-600 text-white" : "text-gray-400 hover:text-white"
                  }`}
                >
                  {f.toUpperCase()}
                </button>
              ))}
            </div>
            <span className="text-gray-500 text-xs">
              {printFormat === "pdf" ? "Opens browser print dialog — save as PDF" : "Downloads a JPG image per unit"}
            </span>
          </div>

          {/* Select all / none */}
          <div className="flex items-center gap-3 mb-2">
            <span className="text-gray-400 text-xs">{printIds.size} selected</span>
            <button
              onClick={() => setPrintIds(new Set(units.filter(u => u.stats_json).map(u => u.id)))}
              className="text-xs text-amber-400 hover:text-amber-300"
            >
              Select All
            </button>
            <span className="text-gray-700">·</span>
            <button
              onClick={() => setPrintIds(new Set())}
              className="text-xs text-gray-400 hover:text-white"
            >
              Deselect All
            </button>
          </div>

          {/* Unit list grouped by faction */}
          <div className="max-h-64 overflow-y-auto border border-gray-800 rounded mb-4">
            {(() => {
              const byFaction = new Map<string, typeof units>();
              for (const u of units.filter(u => u.stats_json)) {
                const f = u.faction || "Unknown";
                if (!byFaction.has(f)) byFaction.set(f, []);
                byFaction.get(f)!.push(u);
              }
              if (byFaction.size === 0) return (
                <div className="text-gray-500 text-sm text-center py-6">No units with stats yet.</div>
              );
              return Array.from(byFaction.entries()).map(([faction, factionUnits]) => (
                <div key={faction}>
                  <div className="px-3 py-1.5 bg-gray-800 text-amber-400 text-xs font-bold uppercase tracking-wide sticky top-0">
                    {faction}
                  </div>
                  {factionUnits.map(unit => (
                    <label key={unit.id} className="flex items-center gap-3 px-3 py-2 hover:bg-gray-800/50 cursor-pointer border-b border-gray-800/40 last:border-0">
                      <input
                        type="checkbox"
                        checked={printIds.has(unit.id)}
                        onChange={e => {
                          setPrintIds(prev => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(unit.id);
                            else next.delete(unit.id);
                            return next;
                          });
                        }}
                        className="w-4 h-4 accent-amber-500"
                      />
                      <span className="text-white text-sm">{unit.name}</span>
                    </label>
                  ))}
                </div>
              ));
            })()}
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                if (printIds.size === 0) return;
                window.open(`/print/units?ids=${Array.from(printIds).join(",")}`, "_blank");
              }}
              disabled={printIds.size === 0}
              className="bg-red-700 hover:bg-red-600 disabled:opacity-40 disabled:cursor-not-allowed text-white px-5 py-2 rounded font-medium text-sm transition-colors"
            >
              Open Export Page ({printIds.size} unit{printIds.size !== 1 ? "s" : ""})
            </button>
            <span className="text-gray-500 text-xs">Opens in a new tab · use the PDF or JPG button there</span>
          </div>
        </div>
      )}

      {/* Wahapedia import form */}
      {formMode === "wahapedia" && (
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
              onClick={() => { setFormMode(null); setImportError(""); }}
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

      {/* Manual add form */}
      {formMode === "manual" && (
        <div className="bg-gray-900 border border-gray-700 rounded-lg p-4 mb-6">
          <h2 className="text-white font-bold mb-4">Add Unit Manually</h2>

          {/* Basic info */}
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div className="col-span-2 sm:col-span-1">
              <label className="text-gray-400 text-xs block mb-1">Name *</label>
              <input
                value={mName}
                onChange={e => setMName(e.target.value)}
                placeholder="Space Marine Captain"
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-amber-500"
              />
            </div>
            <div className="col-span-2 sm:col-span-1">
              <label className="text-gray-400 text-xs block mb-1">Faction</label>
              <input
                value={mFaction}
                onChange={e => setMFaction(e.target.value)}
                placeholder="Space Marines"
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-amber-500"
              />
            </div>
            <div>
              <label className="text-gray-400 text-xs block mb-1">Quantity</label>
              <input
                type="number"
                min="1"
                value={mQty}
                onChange={e => setMQty(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-amber-500"
              />
            </div>
            <div>
              <label className="text-gray-400 text-xs block mb-1">Pts / Model</label>
              <input
                type="number"
                min="0"
                value={mPoints}
                onChange={e => setMPoints(e.target.value)}
                placeholder="80"
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-amber-500"
              />
            </div>
          </div>

          {/* Stats row */}
          <p className="text-gray-500 text-xs uppercase font-bold mb-2 mt-4">Stats (optional)</p>
          <div className="grid grid-cols-4 sm:grid-cols-7 gap-2 mb-3">
            {[
              { label: "M", value: mM, set: setMM, placeholder: '6"' },
              { label: "T", value: mT, set: setMT, placeholder: "4" },
              { label: "W", value: mW, set: setMW, placeholder: "4" },
              { label: "Sv", value: mSv, set: setMSv, placeholder: "3+" },
              { label: "Ld", value: mLd, set: setMLd, placeholder: "6+" },
              { label: "OC", value: mOC, set: setMOC, placeholder: "1" },
              { label: "Inv", value: mInvuln, set: setMInvuln, placeholder: "4++" },
            ].map(({ label, value, set, placeholder }) => (
              <div key={label}>
                <label className="text-amber-400 text-xs font-bold block mb-1 text-center">{label}</label>
                <input
                  value={value}
                  onChange={e => set(e.target.value)}
                  placeholder={placeholder}
                  className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-white text-sm text-center font-mono focus:outline-none focus:border-amber-500"
                />
              </div>
            ))}
          </div>

          {/* Keywords */}
          <div className="mb-3">
            <label className="text-gray-400 text-xs block mb-1">Keywords (comma separated)</label>
            <input
              value={mKeywords}
              onChange={e => setMKeywords(e.target.value)}
              placeholder="Infantry, Character, Adeptus Astartes"
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-amber-500"
            />
          </div>

          {/* Weapons */}
          <div className="mb-4">
            <button
              onClick={() => setShowWeapons(v => !v)}
              className="text-gray-400 hover:text-white text-xs font-bold uppercase tracking-wide"
            >
              {showWeapons ? "▲" : "▶"} Weapons ({mWeapons.length})
            </button>
            {showWeapons && (
              <div className="mt-2 space-y-3">
                {mWeapons.map((w, i) => (
                  <div key={i} className="bg-gray-800 rounded p-3">
                    <div className="grid grid-cols-2 gap-2 mb-2">
                      <div className="col-span-2 sm:col-span-1">
                        <label className="text-gray-500 text-xs block mb-0.5">Name</label>
                        <input
                          value={w.name}
                          onChange={e => setMWeapons(prev => prev.map((x, j) => j === i ? { ...x, name: e.target.value } : x))}
                          className="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1 text-white text-sm focus:outline-none focus:border-amber-500"
                        />
                      </div>
                      <div>
                        <label className="text-gray-500 text-xs block mb-0.5">Type</label>
                        <select
                          value={w.type}
                          onChange={e => setMWeapons(prev => prev.map((x, j) => j === i ? { ...x, type: e.target.value as "ranged" | "melee" } : x))}
                          className="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1 text-white text-sm focus:outline-none focus:border-amber-500"
                        >
                          <option value="ranged">Ranged</option>
                          <option value="melee">Melee</option>
                        </select>
                      </div>
                    </div>
                    <div className="grid grid-cols-4 gap-2 mb-2">
                      {[
                        { label: "Range", key: "range" as const, placeholder: '24"' },
                        { label: "A", key: "attacks" as const, placeholder: "3" },
                        { label: "BS/WS", key: "bsWs" as const, placeholder: "3+" },
                        { label: "S", key: "strength" as const, placeholder: "4" },
                        { label: "AP", key: "ap" as const, placeholder: "-1" },
                        { label: "D", key: "damage" as const, placeholder: "1" },
                      ].map(({ label, key, placeholder }) => (
                        <div key={key}>
                          <label className="text-gray-500 text-xs block mb-0.5">{label}</label>
                          <input
                            value={w[key]}
                            onChange={e => setMWeapons(prev => prev.map((x, j) => j === i ? { ...x, [key]: e.target.value } : x))}
                            placeholder={placeholder}
                            className="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1 text-white text-sm text-center font-mono focus:outline-none focus:border-amber-500"
                          />
                        </div>
                      ))}
                    </div>
                    <div className="flex items-start gap-2">
                      <div className="flex-1">
                        <label className="text-gray-500 text-xs block mb-0.5">Abilities</label>
                        <input
                          value={w.abilities}
                          onChange={e => setMWeapons(prev => prev.map((x, j) => j === i ? { ...x, abilities: e.target.value } : x))}
                          placeholder="Devastating Wounds, Rapid Fire 1"
                          className="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1 text-white text-sm focus:outline-none focus:border-amber-500"
                        />
                      </div>
                      <button
                        onClick={() => setMWeapons(prev => prev.filter((_, j) => j !== i))}
                        className="text-gray-600 hover:text-red-400 text-xs mt-4"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
                <button
                  onClick={() => setMWeapons(prev => [...prev, { ...EMPTY_WEAPON }])}
                  className="text-sm text-amber-400 hover:text-amber-300"
                >
                  + Add Weapon
                </button>
              </div>
            )}
          </div>

          {mError && <p className="text-red-400 text-sm mb-3">{mError}</p>}
          <div className="flex gap-2">
            <button
              onClick={handleManualSubmit}
              disabled={mSubmitting}
              className="bg-red-700 hover:bg-red-600 disabled:opacity-50 text-white px-4 py-2 rounded font-medium text-sm transition-colors"
            >
              {mSubmitting ? "Adding..." : "Add Unit"}
            </button>
            <button
              onClick={() => { setFormMode(null); resetManualForm(); }}
              className="bg-gray-700 hover:bg-gray-600 text-gray-300 px-3 py-2 rounded text-sm"
            >
              Cancel
            </button>
          </div>
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
            ? "No units yet. Add your first unit above!"
            : "No units match your search."}
        </div>
      ) : (
        (() => {
          const byFaction = new Map<string, typeof filtered>();
          for (const u of filtered) {
            const f = u.faction || "Unknown";
            if (!byFaction.has(f)) byFaction.set(f, []);
            byFaction.get(f)!.push(u);
          }
          return (
            <div className="space-y-8">
              {Array.from(byFaction.entries()).map(([faction, factionUnits]) => (
                <div key={faction}>
                  {byFaction.size > 1 && (
                    <h2 className="text-amber-400 font-bold uppercase tracking-wide text-sm mb-3 border-b border-gray-800 pb-1">
                      {faction}
                    </h2>
                  )}
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                    {factionUnits.map((unit) => (
                      <UnitCard
                        key={unit.id}
                        unit={unit}
                        onUpdate={handleUpdate}
                        onDelete={handleDelete}
                        onRefetchStats={handleRefetchStats}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          );
        })()
      )}
    </div>
  );
}
