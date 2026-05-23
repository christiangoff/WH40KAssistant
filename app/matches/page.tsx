"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface Match {
  id: number;
  army_id: number;
  army_name: string | null;
  opponent: string | null;
  started_at: number;
  ended_at: number | null;
  cp_start: number;
  cp_current: number;
  notes: string | null;
}

interface Army {
  id: number;
  name: string;
}

export default function MatchesPage() {
  const [matches, setMatches] = useState<Match[]>([]);
  const [armies, setArmies] = useState<Army[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [selectedArmy, setSelectedArmy] = useState<number>(0);
  const [opponent, setOpponent] = useState("");
  const [cpStart, setCpStart] = useState(0);
  const [creating, setCreating] = useState(false);

  async function loadData() {
    const [matchesRes, armiesRes] = await Promise.all([
      fetch("/api/matches"),
      fetch("/api/armies"),
    ]);
    const matchesData = await matchesRes.json();
    const armiesData = await armiesRes.json();
    setMatches(Array.isArray(matchesData) ? matchesData : []);
    setArmies(Array.isArray(armiesData) ? armiesData : []);
    if (Array.isArray(armiesData) && armiesData.length > 0) {
      setSelectedArmy(armiesData[0].id);
    }
    setLoading(false);
  }

  useEffect(() => {
    loadData();
  }, []);

  async function handleDelete(matchId: number) {
    await fetch(`/api/matches/${matchId}`, { method: "DELETE" });
    setMatches((prev) => prev.filter((m) => m.id !== matchId));
  }

  async function handleCreate() {
    if (!selectedArmy) return;
    setCreating(true);
    try {
      const res = await fetch("/api/matches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          army_id: selectedArmy,
          opponent: opponent || null,
          cp_start: cpStart,
        }),
      });
      if (res.ok) {
        await loadData();
        setOpponent("");
        setCpStart(0);
        setShowCreate(false);
      }
    } finally {
      setCreating(false);
    }
  }

  function formatDate(ts: number) {
    return new Date(ts).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  const activeMatches = matches.filter((m) => !m.ended_at);
  const completedMatches = matches.filter((m) => m.ended_at);

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-amber-400 uppercase tracking-wide">
          Matches
        </h1>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="bg-red-700 hover:bg-red-600 text-white px-4 py-2 rounded font-medium transition-colors"
        >
          + New Match
        </button>
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="bg-gray-900 border border-gray-700 rounded-lg p-4 mb-6">
          <h2 className="text-white font-bold mb-3">Start New Match</h2>
          {armies.length === 0 ? (
            <p className="text-gray-400 text-sm">
              You need an army first.{" "}
              <Link href="/armies" className="text-amber-400 hover:underline">
                Create one.
              </Link>
            </p>
          ) : (
            <div className="flex flex-wrap gap-3 items-end">
              <div>
                <label className="text-gray-400 text-xs block mb-1">Army</label>
                <select
                  value={selectedArmy}
                  onChange={(e) => setSelectedArmy(parseInt(e.target.value))}
                  className="bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-amber-500"
                >
                  {armies.map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-gray-400 text-xs block mb-1">Opponent (optional)</label>
                <input
                  type="text"
                  value={opponent}
                  onChange={(e) => setOpponent(e.target.value)}
                  placeholder="Opponent name..."
                  className="bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-amber-500"
                />
              </div>
              <div>
                <label className="text-gray-400 text-xs block mb-1">Starting CP</label>
                <input
                  type="number"
                  value={cpStart}
                  onChange={(e) => setCpStart(parseInt(e.target.value) || 0)}
                  className="w-20 bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-amber-500"
                  min={0}
                />
              </div>
              <button
                onClick={handleCreate}
                disabled={creating}
                className="bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white px-4 py-2 rounded font-medium text-sm transition-colors"
              >
                {creating ? "Starting..." : "Start Match"}
              </button>
              <button
                onClick={() => setShowCreate(false)}
                className="bg-gray-700 hover:bg-gray-600 text-gray-300 px-3 py-2 rounded text-sm"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      )}

      {loading ? (
        <div className="text-gray-400">Loading...</div>
      ) : matches.length === 0 ? (
        <div className="text-center py-16 text-gray-500">
          No matches yet. Start a match from an army or from here!
        </div>
      ) : (
        <div className="space-y-6">
          {activeMatches.length > 0 && (
            <div>
              <h2 className="text-green-400 font-bold text-sm uppercase tracking-wide mb-3">
                Active Matches ({activeMatches.length})
              </h2>
              <div className="space-y-2">
                {activeMatches.map((match) => (
                  <MatchRow key={match.id} match={match} formatDate={formatDate} onDelete={handleDelete} />
                ))}
              </div>
            </div>
          )}

          {completedMatches.length > 0 && (
            <div>
              <h2 className="text-gray-500 font-bold text-sm uppercase tracking-wide mb-3">
                Completed Matches ({completedMatches.length})
              </h2>
              <div className="space-y-2">
                {completedMatches.map((match) => (
                  <MatchRow key={match.id} match={match} formatDate={formatDate} onDelete={handleDelete} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MatchRow({
  match,
  formatDate,
  onDelete,
}: {
  match: Match;
  formatDate: (ts: number) => string;
  onDelete: (id: number) => void;
}) {
  const isActive = !match.ended_at;

  return (
    <div className="relative bg-gray-900 border border-gray-800 hover:border-gray-600 rounded-lg transition-colors group">
      <Link href={`/match/${match.id}`} className="block p-4 pr-12">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              {isActive && (
                <span className="bg-green-800 text-green-300 text-xs px-2 py-0.5 rounded font-medium">
                  ACTIVE
                </span>
              )}
              <span className="text-white font-bold">
                {match.army_name || `Army #${match.army_id}`}
              </span>
              {match.opponent && (
                <span className="text-gray-400 text-sm">vs {match.opponent}</span>
              )}
            </div>
            <div className="text-gray-500 text-xs mt-1">{formatDate(match.started_at)}</div>
          </div>
          <div className="text-right shrink-0">
            <div className="text-amber-400 font-mono font-bold">
              {match.cp_current} CP
            </div>
            {!isActive && match.ended_at && (
              <div className="text-gray-500 text-xs">
                Ended {formatDate(match.ended_at)}
              </div>
            )}
          </div>
        </div>
      </Link>
      <button
        onClick={() => onDelete(match.id)}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all text-lg leading-none"
        title="Delete match"
      >
        ✕
      </button>
    </div>
  );
}
