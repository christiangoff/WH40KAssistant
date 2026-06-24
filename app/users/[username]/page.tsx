"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { UnitStats } from "@/lib/wahapedia";

interface CollectionUnit {
  name: string;
  faction: string | null;
  quantity: number;
  stats_json: string | null;
}

interface FactionGroup {
  faction: string;
  units: CollectionUnit[];
  totalModels: number;
  totalPoints: number;
}

export default function UserProfilePage() {
  const params = useParams();
  const router = useRouter();
  const username = params.username as string;

  const [owner, setOwner] = useState<{ id: number; username: string } | null>(null);
  const [factionGroups, setFactionGroups] = useState<FactionGroup[]>([]);
  const [totals, setTotals] = useState({ units: 0, models: 0, points: 0 });
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    async function load() {
      // First resolve username → id via the users list
      const usersRes = await fetch("/api/users");
      if (!usersRes.ok) { router.push("/login"); return; }
      const users: { id: number; username: string }[] = await usersRes.json();
      const user = users.find(u => u.username.toLowerCase() === username.toLowerCase());
      if (!user) { setNotFound(true); setLoading(false); return; }

      const res = await fetch(`/api/users/${user.id}/collection`);
      if (!res.ok) { setNotFound(true); setLoading(false); return; }

      const { owner: o, units }: { owner: { id: number; username: string }; units: CollectionUnit[] } = await res.json();
      setOwner(o);

      // Group by faction
      const map = new Map<string, CollectionUnit[]>();
      for (const u of units) {
        const key = u.faction || "Unknown";
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push(u);
      }

      let totalModels = 0, totalPoints = 0;
      const groups: FactionGroup[] = Array.from(map.entries()).map(([faction, fUnits]) => {
        let gModels = 0, gPoints = 0;
        for (const u of fUnits) {
          gModels += u.quantity;
          if (u.stats_json) {
            const stats: UnitStats = JSON.parse(u.stats_json);
            gPoints += (stats.points_per_model ?? 0) * u.quantity;
          }
        }
        totalModels += gModels;
        totalPoints += gPoints;
        return { faction, units: fUnits, totalModels: gModels, totalPoints: gPoints };
      });

      setFactionGroups(groups);
      setTotals({ units: units.length, models: totalModels, points: totalPoints });
      setLoading(false);
    }
    load();
  }, [username, router]);

  if (loading) return <div className="p-8 text-gray-400">Loading…</div>;
  if (notFound) return (
    <div className="max-w-2xl mx-auto px-4 py-16 text-center">
      <div className="text-gray-500 text-lg mb-2">User not found</div>
      <Link href="/users" className="text-amber-400 hover:underline text-sm">← Back to Players</Link>
    </div>
  );

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <Link href="/users" className="text-gray-500 hover:text-gray-300 text-sm mb-4 block">← Players</Link>

      <div className="flex items-end gap-4 mb-6">
        <h1 className="text-3xl font-bold text-amber-400">{owner?.username}</h1>
        <span className="text-gray-500 text-sm pb-1">Collection</span>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        {[
          { label: "Unit Types", value: totals.units },
          { label: "Total Models", value: totals.models },
          { label: "Est. Points", value: totals.points > 0 ? totals.points.toLocaleString() : "—" },
        ].map(s => (
          <div key={s.label} className="bg-gray-900 border border-gray-800 rounded-lg p-4 text-center">
            <div className="text-2xl font-bold font-mono text-white">{s.value}</div>
            <div className="text-gray-500 text-xs uppercase tracking-wide mt-1">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Faction groups */}
      {factionGroups.length === 0 ? (
        <div className="text-gray-500 text-center py-12">No units in collection yet.</div>
      ) : (
        <div className="space-y-4">
          {factionGroups.map(({ faction, units, totalModels, totalPoints }) => (
            <div key={faction} className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
              <div className="px-4 py-3 bg-gray-800 flex items-center justify-between">
                <h2 className="text-amber-400 font-bold text-sm uppercase tracking-wide">{faction}</h2>
                <div className="flex gap-4 text-xs text-gray-500">
                  <span>{units.length} unit{units.length !== 1 ? "s" : ""}</span>
                  <span>{totalModels} model{totalModels !== 1 ? "s" : ""}</span>
                  {totalPoints > 0 && <span>~{totalPoints} pts</span>}
                </div>
              </div>
              <div className="divide-y divide-gray-800">
                {units.map((u, i) => {
                  const stats: UnitStats | null = u.stats_json ? JSON.parse(u.stats_json) : null;
                  const pts = stats?.points_per_model ? stats.points_per_model * u.quantity : null;
                  return (
                    <div key={i} className="px-4 py-2.5 flex items-center justify-between">
                      <div>
                        <span className="text-white text-sm">{u.name}</span>
                        {stats && (
                          <span className="ml-3 text-gray-600 text-xs font-mono">
                            M:{stats.M} T:{stats.T} W:{stats.W} Sv:{stats.Sv}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-4 text-right shrink-0">
                        {pts && <span className="text-gray-500 text-xs">{pts} pts</span>}
                        <span className="text-amber-400 font-bold font-mono text-sm w-8 text-right">{u.quantity}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
