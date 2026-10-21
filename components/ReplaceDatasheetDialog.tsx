"use client";

import { useEffect, useMemo, useState } from "react";

// Picker for a collection unit whose datasheet Wahapedia no longer publishes
// (retired/renamed/split in 11th edition, e.g. "Custodian Guard" -> three
// "Custodian Guard Sodality" sheets). Suggests same-faction catalog entries
// that share words with the old name, with a search box over the whole
// faction. Choosing one hands its URL back; the caller saves and re-fetches.

interface CatalogUnit {
  id: string;
  name: string;
  faction: string;
  wahapedia_url: string;
  source: string | null;
}

const factionSlug = (url: string) => url.match(/\/factions\/([^/]+)/i)?.[1]?.toLowerCase() ?? null;
const STOP = new Set(["with", "and", "the", "of", "on", "in", "squad"]);
const words = (s: string) =>
  new Set(
    s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/)
      .map((w) => (w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w))
      .filter((w) => w && !STOP.has(w))
  );

export default function ReplaceDatasheetDialog({
  unitName,
  unitUrl,
  onPick,
  onClose,
}: {
  unitName: string;
  unitUrl: string;
  onPick: (url: string) => Promise<void>;
  onClose: () => void;
}) {
  const [catalog, setCatalog] = useState<CatalogUnit[] | null>(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/catalog")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setCatalog)
      .catch(() => setError("Couldn't load the unit catalog."));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const slug = factionSlug(unitUrl);
  const factionUnits = useMemo(
    () => (catalog ?? []).filter((c) => factionSlug(c.wahapedia_url) === slug),
    [catalog, slug]
  );

  const suggestions = useMemo(() => {
    const old = words(unitName);
    return factionUnits
      .map((c) => {
        const w = words(c.name);
        return { c, score: [...old].filter((x) => w.has(x)).length };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || a.c.name.localeCompare(b.c.name))
      .slice(0, 6)
      .map((x) => x.c);
  }, [factionUnits, unitName]);

  const q = search.trim().toLowerCase();
  const results = q ? factionUnits.filter((c) => c.name.toLowerCase().includes(q)).slice(0, 30) : [];

  async function pick(c: CatalogUnit) {
    setSaving(c.id);
    try {
      await onPick(c.wahapedia_url);
      onClose();
    } catch {
      setError("Couldn't switch the datasheet. Try again.");
      setSaving(null);
    }
  }

  function row(c: CatalogUnit) {
    return (
      <li key={c.id}>
        <button
          onClick={() => pick(c)}
          disabled={saving !== null}
          className="w-full text-left px-3 py-2 rounded bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-sm text-white"
        >
          {c.name}
          {c.source && <span className="text-gray-500 text-xs"> · {c.source}</span>}
          {saving === c.id && <span className="text-amber-400 text-xs"> · switching…</span>}
        </button>
      </li>
    );
  }

  return (
    <div className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-gray-900 border border-gray-700 rounded-lg w-full max-w-md max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-gray-800 flex items-start justify-between gap-2">
          <div>
            <h2 className="text-white font-bold">Replace datasheet</h2>
            <p className="text-gray-400 text-xs mt-0.5">
              <span className="text-white">{unitName}</span> isn&apos;t an 11th-edition datasheet any more.
              Pick the unit that replaced it — its squad count and notes are kept.
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-xl leading-none" aria-label="Close">×</button>
        </div>

        <div className="p-4 overflow-y-auto space-y-4">
          {error && <p className="text-red-400 text-sm">{error}</p>}
          {!catalog && !error && <p className="text-gray-500 text-sm">Loading catalog…</p>}
          {catalog && (
            <>
              {suggestions.length > 0 && (
                <section>
                  <h3 className="text-xs font-bold uppercase tracking-wide text-amber-400 mb-1.5">Suggested</h3>
                  <ul className="space-y-1">{suggestions.map(row)}</ul>
                </section>
              )}
              <section>
                <h3 className="text-xs font-bold uppercase tracking-wide text-gray-400 mb-1.5">Search this faction</h3>
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Unit name…"
                  className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-amber-500 mb-1.5"
                />
                {q && (results.length > 0
                  ? <ul className="space-y-1">{results.map(row)}</ul>
                  : <p className="text-gray-500 text-xs">No matching units.</p>)}
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
