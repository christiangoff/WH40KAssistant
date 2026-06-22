"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

interface Unit {
  id: number;
  name: string;
  faction: string | null;
  stats_json: string | null;
  notes: string | null;
}

interface Weapon {
  name: string;
  type: "ranged" | "melee";
  range: string;
  attacks: string;
  bsWs: string;
  strength: string;
  ap: string;
  damage: string;
  abilities: string;
}

interface Stratagem {
  name: string;
  cp: string;
  type: string;
  legend?: string;
  when?: string;
  target?: string;
  effect?: string;
  restrictions?: string;
}

interface Stats {
  M: string; T: string; Sv: string; W: string; Ld: string; OC: string;
  invuln?: string;
  keywords?: string[];
  abilities?: { name: string; description: string }[];
  weapons?: Weapon[];
  wargear_options?: string[];
  stratagems?: Stratagem[];
  points_per_model?: number;
  points_table?: { models: number; points: number }[];
}

const S = {
  bg: "#030712",
  bgMid: "#0d1117",
  bgCard: "#111827",
  border: "#1f2937",
  accent: "#fbbf24",
  accentText: "#fcd34d",
  text: "#f9fafb",
  muted: "#9ca3af",
  dim: "#6b7280",
  headerBg: "linear-gradient(135deg, #7f1d1d 0%, #991b1b 100%)",
  rangedBg: "#1e3a5f",
  meleeBg: "#4c0519",
  stratagemBg: "#1a1a2e",
  stratagemBorder: "#312e81",
} as const;

function WeaponTable({ group, label, headerBg, isRanged }: { group: Weapon[]; label: string; headerBg: string; isRanged: boolean }) {
  return (
    <div style={{ marginBottom: "10px" }}>
      <div style={{ background: headerBg, color: "#e2e8f0", fontSize: "10px", fontWeight: 700, textTransform: "uppercase", padding: "4px 8px", letterSpacing: "0.1em" }}>
        {label}
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px" }}>
        <thead>
          <tr style={{ background: S.bgMid, color: S.dim }}>
            {["Name", isRanged ? "Rng" : "—", "A", isRanged ? "BS" : "WS", "S", "AP", "D", "Abilities"].map((h, i) => (
              <th key={i} style={{ padding: "4px 6px", fontWeight: 600, textAlign: i === 0 || i === 7 ? "left" : "center", borderBottom: `1px solid ${S.border}` }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {group.map((w, i) => (
            <tr key={i} style={{ background: i % 2 === 0 ? S.bg : S.bgMid }}>
              <td style={{ padding: "5px 6px", color: S.text, fontWeight: 600 }}>{w.name}</td>
              <td style={{ padding: "5px 6px", textAlign: "center", color: S.muted }}>{w.range || "—"}</td>
              <td style={{ padding: "5px 6px", textAlign: "center", color: S.muted }}>{w.attacks}</td>
              <td style={{ padding: "5px 6px", textAlign: "center", color: S.muted }}>{w.bsWs}</td>
              <td style={{ padding: "5px 6px", textAlign: "center", color: S.muted }}>{w.strength}</td>
              <td style={{ padding: "5px 6px", textAlign: "center", color: S.muted }}>{w.ap}</td>
              <td style={{ padding: "5px 6px", textAlign: "center", color: S.muted }}>{w.damage}</td>
              <td style={{ padding: "5px 6px", color: S.accentText, fontSize: "10px" }}>{w.abilities || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StratagemRow({ s }: { s: Stratagem }) {
  return (
    <div style={{ background: S.stratagemBg, border: `1px solid ${S.stratagemBorder}`, borderRadius: "4px", padding: "8px 10px", marginBottom: "5px" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: "8px", marginBottom: "4px" }}>
        <span style={{ background: "#312e81", color: S.accentText, fontSize: "11px", fontWeight: 700, fontFamily: "monospace", padding: "1px 6px", borderRadius: "3px", flexShrink: 0 }}>
          {s.cp}CP
        </span>
        <span style={{ color: S.text, fontSize: "11px", fontWeight: 700 }}>{s.name}</span>
        <span style={{ color: S.dim, fontSize: "9px", marginLeft: "auto", whiteSpace: "nowrap" }}>{s.type}</span>
      </div>
      {s.when   && <div style={{ fontSize: "10px", lineHeight: 1.4, color: S.muted, marginBottom: "2px" }}><span style={{ color: S.accentText, fontWeight: 700 }}>WHEN: </span>{s.when}</div>}
      {s.target && <div style={{ fontSize: "10px", lineHeight: 1.4, color: S.muted, marginBottom: "2px" }}><span style={{ color: S.accentText, fontWeight: 700 }}>TARGET: </span>{s.target}</div>}
      {s.effect        && <div style={{ fontSize: "10px", lineHeight: 1.4, color: S.muted }}><span style={{ color: S.accentText, fontWeight: 700 }}>EFFECT: </span>{s.effect}</div>}
      {s.restrictions  && <div style={{ fontSize: "10px", lineHeight: 1.4, color: S.muted }}><span style={{ color: S.accentText, fontWeight: 700 }}>RESTRICTIONS: </span>{s.restrictions}</div>}
    </div>
  );
}

function DataCard({ unit, refCallback }: { unit: Unit; refCallback: (el: HTMLDivElement | null) => void }) {
  const stats: Stats | null = unit.stats_json ? JSON.parse(unit.stats_json) : null;
  const ranged = stats?.weapons?.filter(w => w.type === "ranged") ?? [];
  const melee  = stats?.weapons?.filter(w => w.type === "melee")  ?? [];

  const pts = stats?.points_table?.length
    ? stats.points_table.map(p => `${p.models}m: ${p.points}pts`).join("  ·  ")
    : stats?.points_per_model ? `${stats.points_per_model} pts/model` : null;

  const coreStats = [
    { label: "M",   value: stats?.M },
    { label: "T",   value: stats?.T },
    { label: "Sv",  value: stats?.Sv },
    { label: "W",   value: stats?.W },
    { label: "Ld",  value: stats?.Ld },
    { label: "OC",  value: stats?.OC },
    ...(stats?.invuln ? [{ label: "INV", value: stats.invuln }] : []),
  ];

  const sections: boolean[] = [
    ranged.length > 0 || melee.length > 0,
    (stats?.abilities?.length ?? 0) > 0,
    (stats?.wargear_options?.length ?? 0) > 0,
    (stats?.stratagems?.length ?? 0) > 0,
    !!unit.notes,
  ];
  const lastIdx = sections.lastIndexOf(true);

  function border(idx: number) {
    return idx < lastIdx ? `1px solid ${S.border}` : undefined;
  }

  return (
    <div
      ref={refCallback}
      style={{ backgroundColor: S.bg, color: S.text, width: "100%", fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif", boxSizing: "border-box" }}
    >
      {/* Header */}
      <div style={{ background: S.headerBg, padding: "18px 24px", borderBottom: `3px solid ${S.accent}` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "16px" }}>
          <div style={{ flex: 1 }}>
            {unit.faction && (
              <div style={{ color: S.accentText, fontSize: "11px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.15em", marginBottom: "5px" }}>
                {unit.faction}
              </div>
            )}
            <div style={{ color: "#fff", fontSize: "28px", fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.04em", lineHeight: 1.05 }}>
              {unit.name}
            </div>
          </div>
          {pts && (
            <div style={{ background: "rgba(0,0,0,0.45)", border: `1px solid rgba(251,191,36,0.4)`, borderRadius: "6px", padding: "7px 12px", textAlign: "right", flexShrink: 0 }}>
              <div style={{ color: S.accentText, fontSize: "9px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em" }}>Points</div>
              <div style={{ color: "#fff", fontSize: "12px", fontWeight: 600, marginTop: "2px", whiteSpace: "nowrap" }}>{pts}</div>
            </div>
          )}
        </div>
      </div>

      {/* Core stats */}
      {stats && (
        <div style={{ padding: "12px 24px", borderBottom: `1px solid ${S.border}`, background: S.bgMid }}>
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${coreStats.length}, 1fr)`, gap: "6px" }}>
            {coreStats.map(s => (
              <div key={s.label} style={{ background: S.bgCard, border: `1px solid ${S.border}`, borderRadius: "4px", padding: "7px 4px", textAlign: "center" }}>
                <div style={{ color: S.accent, fontSize: "9px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "3px" }}>{s.label}</div>
                <div style={{ color: "#fff", fontSize: "19px", fontWeight: 900, fontFamily: "monospace" }}>{s.value || "—"}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Weapons */}
      {(ranged.length > 0 || melee.length > 0) && (
        <div style={{ padding: "12px 24px", borderBottom: border(0) }}>
          {ranged.length > 0 && <WeaponTable group={ranged} label="Ranged Weapons" headerBg={S.rangedBg} isRanged={true} />}
          {melee.length  > 0 && <WeaponTable group={melee}  label="Melee Weapons"  headerBg={S.meleeBg}  isRanged={false} />}
        </div>
      )}

      {/* Abilities */}
      {stats?.abilities && stats.abilities.length > 0 && (
        <div style={{ padding: "12px 24px", borderBottom: border(1) }}>
          <div style={{ color: S.accent, fontSize: "10px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "6px" }}>Abilities</div>
          {stats.abilities.map((a, i) => (
            <div key={i} style={{ background: S.bgCard, borderRadius: "4px", padding: "7px 10px", fontSize: "11px", lineHeight: 1.5, marginBottom: "4px" }}>
              <span style={{ color: S.accentText, fontWeight: 700 }}>{a.name}: </span>
              <span style={{ color: S.muted }}>{a.description}</span>
            </div>
          ))}
        </div>
      )}

      {/* Wargear options */}
      {stats?.wargear_options && stats.wargear_options.length > 0 && (
        <div style={{ padding: "12px 24px", borderBottom: border(2) }}>
          <div style={{ color: S.accent, fontSize: "10px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "6px" }}>Wargear Options</div>
          <div style={{ background: S.bgCard, borderRadius: "4px", padding: "8px 10px" }}>
            {stats.wargear_options.map((o, i) => (
              <div key={i} style={{ color: S.muted, fontSize: "11px", lineHeight: 1.6 }}>{o}</div>
            ))}
          </div>
        </div>
      )}

      {/* Stratagems */}
      {stats?.stratagems && stats.stratagems.length > 0 && (
        <div style={{ padding: "12px 24px", borderBottom: border(3) }}>
          <div style={{ color: S.accent, fontSize: "10px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "8px" }}>
            Stratagems ({stats.stratagems.length})
          </div>
          {stats.stratagems.map((s, i) => <StratagemRow key={i} s={s} />)}
        </div>
      )}

      {/* Keywords */}
      {stats?.keywords && stats.keywords.length > 0 && (
        <div style={{ padding: "10px 24px", borderBottom: unit.notes ? `1px solid ${S.border}` : undefined }}>
          <span style={{ color: S.accent, fontSize: "10px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", marginRight: "8px" }}>Keywords:</span>
          <span style={{ color: S.dim, fontSize: "11px" }}>{stats.keywords.join(", ")}</span>
        </div>
      )}

      {/* Notes */}
      {unit.notes && (
        <div style={{ padding: "10px 24px" }}>
          <div style={{ background: S.bgCard, borderLeft: `3px solid ${S.accent}`, padding: "7px 12px", borderRadius: "0 4px 4px 0", fontSize: "11px" }}>
            <span style={{ color: S.accentText, fontWeight: 700, textTransform: "uppercase", fontSize: "10px" }}>Notes: </span>
            <span style={{ color: S.muted }}>{unit.notes}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function PrintContent() {
  const searchParams = useSearchParams();
  const idsParam = searchParams.get("ids") ?? "";

  const [units, setUnits] = useState<Unit[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    const ids = idsParam.split(",").map(Number).filter(Boolean);
    fetch("/api/units")
      .then(r => r.json())
      .then((all: Unit[]) => {
        setUnits(ids.length ? (all as Unit[]).filter(u => ids.includes(u.id)) : all);
        setLoading(false);
      });
  }, [idsParam]);

  async function downloadJpgs() {
    setExporting(true);
    try {
      const html2canvas = (await import("html2canvas")).default;
      for (let i = 0; i < units.length; i++) {
        const el = cardRefs.current[i];
        if (!el) continue;
        const canvas = await html2canvas(el, {
          backgroundColor: S.bg,
          scale: 2,
          useCORS: true,
          logging: false,
        });
        const a = document.createElement("a");
        a.download = `${units[i].name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.jpg`;
        a.href = canvas.toDataURL("image/jpeg", 0.92);
        a.click();
        if (i < units.length - 1) await new Promise(r => setTimeout(r, 400));
      }
    } finally {
      setExporting(false);
    }
  }

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: S.bg, color: S.dim }}>
        Loading unit data…
      </div>
    );
  }

  return (
    <div style={{ background: S.bg, minHeight: "100vh" }}>
      <style>{`
        @media print {
          .print-controls { display: none !important; }
          nav { display: none !important; }
          main { padding: 0 !important; }
          body { margin: 0; padding: 0; background: #030712; }
          .card-page { page-break-after: always; break-after: page; }
          .card-page:last-child { page-break-after: avoid; break-after: avoid; }
          @page { margin: 10mm; size: A4; }
        }
      `}</style>

      {/* Controls — hidden on print */}
      <div className="print-controls" style={{ position: "sticky", top: 0, zIndex: 50, background: "#111827", borderBottom: `2px solid ${S.accent}`, padding: "10px 24px", display: "flex", alignItems: "center", gap: "12px" }}>
        <span style={{ color: S.accent, fontWeight: 700, fontSize: "14px", textTransform: "uppercase", letterSpacing: "0.05em" }}>Unit Cards</span>
        <span style={{ color: S.dim, fontSize: "13px" }}>{units.length} unit{units.length !== 1 ? "s" : ""}</span>
        <div style={{ marginLeft: "auto", display: "flex", gap: "8px" }}>
          <button onClick={() => window.print()}
            style={{ background: "#7f1d1d", color: "white", border: "none", borderRadius: "6px", padding: "7px 16px", fontWeight: 600, fontSize: "13px", cursor: "pointer" }}>
            Print / Save as PDF
          </button>
          <button onClick={downloadJpgs} disabled={exporting}
            style={{ background: "#374151", color: "white", border: "none", borderRadius: "6px", padding: "7px 16px", fontWeight: 600, fontSize: "13px", cursor: "pointer", opacity: exporting ? 0.6 : 1 }}>
            {exporting ? "Downloading…" : "Download JPGs"}
          </button>
        </div>
      </div>

      {/* Unit cards */}
      {units.map((unit, i) => (
        <div key={unit.id} className="card-page" style={{ borderBottom: `2px dashed ${S.border}`, padding: "16px 0" }}>
          <DataCard unit={unit} refCallback={el => { cardRefs.current[i] = el; }} />
        </div>
      ))}

      {units.length === 0 && (
        <div style={{ minHeight: "60vh", display: "flex", alignItems: "center", justifyContent: "center", color: S.dim, fontSize: "14px" }}>
          No units found. Close this tab and select units to export.
        </div>
      )}
    </div>
  );
}

export default function PrintUnitsPage() {
  return (
    <Suspense fallback={
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#030712", color: "#6b7280" }}>
        Loading…
      </div>
    }>
      <PrintContent />
    </Suspense>
  );
}
