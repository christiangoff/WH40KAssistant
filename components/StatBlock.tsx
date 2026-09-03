"use client";

import { UnitStats, weaponLabel } from "@/lib/wahapedia";
import { Linkified } from "@/components/Glossary";

interface StatBlockProps {
  stats: UnitStats;
  /** Weapon selection — either a name list (legacy) or a name→count map. */
  selectedWeapons?: string[] | Record<string, number>;
}

export default function StatBlock(props: StatBlockProps) {
  const { stats } = props;

  const selNames = props.selectedWeapons
    ? Array.isArray(props.selectedWeapons)
      ? props.selectedWeapons
      : Object.entries(props.selectedWeapons).filter(([, n]) => n > 0).map(([k]) => k)
    : null;
  const displayWeapons = selNames && selNames.length > 0
    ? stats.weapons.filter(w => selNames.includes(w.name))
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
                          <td className="px-2 py-1.5 text-white font-medium">{weaponLabel(w)}</td>
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
                                    [<Linkified text={ab} />]
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
                <span className="text-gray-300 text-xs"><Linkified text={a.description} /></span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Unit composition */}
      {(stats.unit_composition || stats.equipped_with) && (
        <div>
          <h4 className="text-amber-400 text-xs font-bold uppercase mb-1">Unit Composition</h4>
          <div className="bg-gray-800 rounded p-2 text-xs text-gray-300 space-y-1">
            {stats.unit_composition && <div>{stats.unit_composition}</div>}
            {stats.equipped_with && <div className="text-gray-400">{stats.equipped_with}</div>}
          </div>
        </div>
      )}

      {/* Damaged */}
      {stats.damaged && (
        <div>
          <h4 className="text-red-400 text-xs font-bold uppercase mb-1">Damaged: {stats.damaged.threshold}</h4>
          <div className="bg-gray-800 rounded p-2 text-xs text-gray-300">{stats.damaged.effect}</div>
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

      {/* Keywords */}
      {stats.keywords && stats.keywords.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {stats.keywords.map((kw, i) => (
            <span key={i} className="bg-gray-700 text-gray-300 text-xs px-2 py-0.5 rounded">
              <Linkified text={kw} />
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
