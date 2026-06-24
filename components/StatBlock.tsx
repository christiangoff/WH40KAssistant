"use client";

import { useState } from "react";
import { UnitStats, Stratagem } from "@/lib/wahapedia";

interface StatBlockProps {
  stats: UnitStats;
  selectedWeapons?: string[];
  selectedDetachment?: string | null;
}

function StratagemCard({ s }: { s: Stratagem }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="bg-gray-800 rounded overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full text-left px-3 py-2 flex items-center gap-2 hover:bg-gray-750 transition-colors"
      >
        <span className="bg-gray-700 border border-gray-600 text-amber-300 text-xs px-1.5 py-0.5 rounded font-mono font-bold shrink-0">
          {s.cp}
        </span>
        <span className="text-white text-xs font-bold flex-1">{s.name}</span>
        <span className="text-gray-500 text-xs shrink-0">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-1.5 border-t border-gray-700">
          <div className="text-gray-400 text-xs italic pt-2">{s.type}</div>
          {s.legend && <div className="text-gray-400 text-xs italic">{s.legend}</div>}
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

export default function StatBlock(props: StatBlockProps) {
  const { stats, selectedDetachment } = props;
  const [stratagemSearch, setStratagemSearch] = useState("");

  const displayWeapons = props.selectedWeapons && props.selectedWeapons.length > 0
    ? stats.weapons.filter(w => props.selectedWeapons!.includes(w.name))
    : stats.weapons;

  const coreStats = [
    { label: "M", value: stats.M },
    { label: "T", value: stats.T },
    { label: "Sv", value: stats.Sv },
    { label: "W", value: stats.W },
    { label: "Ld", value: stats.Ld },
    { label: "OC", value: stats.OC },
    ...(stats.invuln ? [{ label: "Inv", value: stats.invuln }] : []),
  ];

  const visibleStratagems = selectedDetachment
    ? (stats.stratagems || []).filter(s =>
        s.type.toLowerCase().includes("core") || s.type === selectedDetachment
      )
    : (stats.stratagems || []);

  const filteredStratagems = visibleStratagems.filter(
    (s) =>
      !stratagemSearch ||
      s.name.toLowerCase().includes(stratagemSearch.toLowerCase()) ||
      s.type.toLowerCase().includes(stratagemSearch.toLowerCase())
  );

  return (
    <div className="space-y-3">
      {/* Core stats */}
      <div className={`grid gap-1 text-center ${coreStats.length === 7 ? "grid-cols-7" : "grid-cols-6"}`}>
        {coreStats.map((s) => (
          <div key={s.label} className="bg-gray-800 rounded p-2">
            <div className="text-amber-400 text-xs font-bold uppercase">{s.label}</div>
            <div className="text-white font-mono font-bold">{s.value || "-"}</div>
          </div>
        ))}
      </div>

      {/* Weapons */}
      {displayWeapons && displayWeapons.length > 0 && (
        <div className="space-y-2">
          {(["ranged", "melee"] as const).map((type) => {
            const group = displayWeapons.filter((w) => w.type === type);
            if (group.length === 0) return null;
            const isRanged = type === "ranged";
            return (
              <div key={type}>
                <h4 className={`text-xs font-bold uppercase mb-1 flex items-center gap-1.5 ${isRanged ? "text-blue-400" : "text-red-400"}`}>
                  <span>{isRanged ? "⟁" : "⚔"}</span>
                  {isRanged ? "Ranged Weapons" : "Melee Weapons"}
                </h4>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs text-gray-300">
                    <thead>
                      <tr className={`text-gray-400 ${isRanged ? "bg-blue-950" : "bg-red-950"}`}>
                        <th className="text-left px-2 py-1">Name</th>
                        <th className="px-2 py-1">{isRanged ? "Rng" : "—"}</th>
                        <th className="px-2 py-1">A</th>
                        <th className="px-2 py-1">{isRanged ? "BS" : "WS"}</th>
                        <th className="px-2 py-1">S</th>
                        <th className="px-2 py-1">AP</th>
                        <th className="px-2 py-1">D</th>
                        <th className="text-left px-2 py-1">Abilities</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.map((w, i) => (
                        <tr key={i} className={i % 2 === 0 ? "bg-gray-800" : ""}>
                          <td className="px-2 py-1.5 text-white font-medium">{w.name}</td>
                          <td className="px-2 py-1.5 text-center">{w.range}</td>
                          <td className="px-2 py-1.5 text-center">{w.attacks}</td>
                          <td className="px-2 py-1.5 text-center">{w.bsWs}</td>
                          <td className="px-2 py-1.5 text-center">{w.strength}</td>
                          <td className="px-2 py-1.5 text-center">{w.ap}</td>
                          <td className="px-2 py-1.5 text-center">{w.damage}</td>
                          <td className="px-2 py-1.5">
                            {w.abilities ? (
                              <div className="flex flex-wrap gap-0.5">
                                {w.abilities.split(", ").map((ab, j) => (
                                  <span
                                    key={j}
                                    className="bg-gray-700 border border-gray-600 text-amber-300 text-xs px-1 py-0.5 rounded font-medium whitespace-nowrap"
                                  >
                                    [{ab}]
                                  </span>
                                ))}
                              </div>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Abilities */}
      {stats.abilities && stats.abilities.length > 0 && (
        <div>
          <h4 className="text-amber-400 text-xs font-bold uppercase mb-1">Abilities</h4>
          <div className="space-y-1">
            {stats.abilities.map((a, i) => (
              <div key={i} className="bg-gray-800 rounded p-2">
                <span className="text-amber-300 font-bold text-xs">{a.name}: </span>
                <span className="text-gray-300 text-xs">{a.description}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Wargear options */}
      {stats.wargear_options && stats.wargear_options.length > 0 && (
        <div>
          <h4 className="text-amber-400 text-xs font-bold uppercase mb-1">Wargear Options</h4>
          <div className="bg-gray-800 rounded p-2 space-y-1">
            {stats.wargear_options.map((opt, i) => {
              const isSubItem = opt.startsWith("  •");
              const isFootnote = opt.trimStart().startsWith("*");
              const text = opt.replace(/^\s+•\s*/, "").trim();
              return (
                <div
                  key={i}
                  className={`text-xs flex gap-1.5 ${
                    isFootnote
                      ? "text-gray-500 italic"
                      : isSubItem
                      ? "text-gray-300 pl-4"
                      : "text-gray-300"
                  }`}
                >
                  {isSubItem && <span className="text-gray-500 shrink-0">•</span>}
                  <span>{text}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Stratagems */}
      {visibleStratagems.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h4 className="text-amber-400 text-xs font-bold uppercase">
              Stratagems ({visibleStratagems.length})
            </h4>
            <input
              type="text"
              value={stratagemSearch}
              onChange={(e) => setStratagemSearch(e.target.value)}
              placeholder="Filter..."
              className="flex-1 bg-gray-800 border border-gray-700 rounded px-2 py-0.5 text-xs text-white focus:outline-none focus:border-amber-500"
            />
          </div>
          <div className="space-y-1 max-h-96 overflow-y-auto pr-0.5">
            {filteredStratagems.map((s, i) => (
              <StratagemCard key={i} s={s} />
            ))}
            {filteredStratagems.length === 0 && (
              <div className="text-gray-500 text-xs px-2">No stratagems match.</div>
            )}
          </div>
        </div>
      )}

      {/* Keywords */}
      {stats.keywords && stats.keywords.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {stats.keywords.map((kw, i) => (
            <span key={i} className="bg-gray-700 text-gray-300 text-xs px-2 py-0.5 rounded">
              {kw}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
