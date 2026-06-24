"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface DashboardStats {
  unitCount: number;
  armyCount: number;
  activeMatchCount: number;
}

export default function Dashboard() {
  const [stats, setStats] = useState<DashboardStats>({
    unitCount: 0,
    armyCount: 0,
    activeMatchCount: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [unitsRes, armiesRes, matchesRes] = await Promise.all([
          fetch("/api/units"),
          fetch("/api/armies"),
          fetch("/api/matches"),
        ]);
        const units = await unitsRes.json();
        const armies = await armiesRes.json();
        const matches = await matchesRes.json();

        setStats({
          unitCount: Array.isArray(units) ? units.length : 0,
          armyCount: Array.isArray(armies) ? armies.length : 0,
          activeMatchCount: Array.isArray(matches)
            ? matches.filter((m: { ended_at: number | null }) => !m.ended_at).length
            : 0,
        });
      } catch (err) {
        console.error("Dashboard load error:", err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const cards = [
    {
      title: "Collection",
      value: stats.unitCount,
      label: "Units",
      href: "/collection",
      color: "border-amber-600",
      icon: "🗡️",
    },
    {
      title: "Armies",
      value: stats.armyCount,
      label: "Armies Built",
      href: "/armies",
      color: "border-red-700",
      icon: "⚔️",
    },
    {
      title: "Matches",
      value: stats.activeMatchCount,
      label: "Active Matches",
      href: "/matches",
      color: "border-blue-700",
      icon: "🎯",
    },
  ];

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="mb-10 text-center">
        <h1 className="text-4xl font-bold text-amber-400 tracking-widest uppercase mb-2">
          WH40K Assistant
        </h1>
        <p className="text-gray-400">
          Manage your collection, build armies, and track battles
        </p>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
        {cards.map((card) => (
          <Link
            key={card.href}
            href={card.href}
            className={`bg-gray-900 border-2 ${card.color} rounded-lg p-6 hover:bg-gray-800 transition-colors`}
          >
            <div className="flex items-center justify-between mb-4">
              <span className="text-3xl">{card.icon}</span>
              <span className="text-gray-400 text-sm font-medium uppercase tracking-wide">
                {card.title}
              </span>
            </div>
            {loading ? (
              <div className="h-8 w-16 bg-gray-800 rounded animate-pulse" />
            ) : (
              <div className="text-5xl font-bold text-white mb-1">{card.value}</div>
            )}
            <div className="text-gray-400 text-sm">{card.label}</div>
          </Link>
        ))}
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-6">
          <h2 className="text-amber-400 font-bold text-lg uppercase tracking-wide mb-4">
            Quick Actions
          </h2>
          <div className="space-y-3">
            <Link
              href="/collection"
              className="block bg-gray-800 hover:bg-gray-700 rounded px-4 py-3 text-gray-200 transition-colors"
            >
              + Import Unit from Wahapedia
            </Link>
            <Link
              href="/armies"
              className="block bg-gray-800 hover:bg-gray-700 rounded px-4 py-3 text-gray-200 transition-colors"
            >
              + Create New Army
            </Link>
            <Link
              href="/matches"
              className="block bg-gray-800 hover:bg-gray-700 rounded px-4 py-3 text-gray-200 transition-colors"
            >
              + Start New Match
            </Link>
          </div>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-lg p-6">
          <h2 className="text-amber-400 font-bold text-lg uppercase tracking-wide mb-4">
            Getting Started
          </h2>
          <ol className="space-y-2 text-gray-300 text-sm list-decimal list-inside">
            <li>Go to <strong className="text-white">Collection</strong> and import units from Wahapedia or set them up manually</li>
            <li>Go to <strong className="text-white">Armies</strong> and create an army list</li>
            <li>Add units from your collection to the army</li>
            <li>Click <strong className="text-white">Start Match</strong> to track a game</li>
            <li>Use the match tracker to manage CP and wounds</li>
          </ol>
        </div>
      </div>
    </div>
  );
}
