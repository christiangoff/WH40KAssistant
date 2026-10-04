"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  BOARD_WIDTH,
  BOARD_DEPTH,
  DEPLOY_DEPTH,
  OBJECTIVE_RADIUS,
  MAX_CHARGE_THREAT,
  parseBaseSize,
  mmToInches,
  dist,
  clampToBoard,
  type Point,
} from "@/lib/battleBoard";
import { PHASE_SEQUENCE, KEYWORD_REFERENCE } from "@/lib/rules/coreRulesReference";

interface SimArmy {
  id: number;
  name: string;
  faction: string | null;
  point_limit: number;
  unit_count: number;
}

interface SimMission {
  key: string;
  name: string;
  description: string;
}

interface DieRoll {
  stage: "hit" | "wound" | "save" | "damage" | "hazard";
  die: number;
  target: number | null;
  success: boolean;
  crit?: boolean;
}

interface LogEntry {
  round: number;
  phase: string;
  message: string;
  rolls?: DieRoll[];
}

const STAGE_LABEL: Record<DieRoll["stage"], string> = { hit: "H", wound: "W", save: "S", damage: "D", hazard: "!" };

// Honest scoping badge: which armies actually have hand-implemented,
// rules-accurate mechanics (lib/ruleHooks/) vs. the engine's generic
// approximation for everything else.
function RuleHookBadge({ labels }: { labels: string[] }) {
  if (labels.length === 0) {
    return <div className="text-gray-600 text-[10px] uppercase tracking-wide mt-1">Generic rules</div>;
  }
  return (
    <div className="text-amber-400 text-[10px] uppercase tracking-wide mt-1" title="This army's detachment/army rule is mechanically implemented, not approximated.">
      ⚡ Real rules: {labels.join(", ")}
    </div>
  );
}

function DiceRow({ rolls }: { rolls: DieRoll[] }) {
  return (
    <div className="flex flex-wrap gap-0.5 mt-0.5">
      {rolls.map((r, i) => (
        <span
          key={i}
          title={`${r.stage}${r.target != null ? ` (needed ${r.target}+)` : ""}: rolled ${r.die}${r.crit ? " — critical!" : ""}`}
          className={`inline-flex items-center justify-center w-4 h-4 rounded-sm text-[9px] font-bold leading-none ${
            r.crit ? "bg-amber-500 text-black" : r.success ? "bg-green-800 text-green-200" : "bg-gray-700 text-gray-400"
          }`}
        >
          {r.stage === "damage" ? r.die : `${STAGE_LABEL[r.stage]}${r.die}`}
        </span>
      ))}
    </div>
  );
}

interface ModelProfileLite {
  name?: string;
  base?: string;
}

interface UnitStatsLite {
  M: string;
  T: string;
  Sv: string;
  W: string;
  Ld: string;
  OC: string;
  invuln?: string;
  model_profiles?: ModelProfileLite[];
}

interface SpatialUnitView {
  armyUnitId: number;
  name: string;
  side: "a" | "b";
  stats: UnitStatsLite;
  models: { maxWounds: number; curWounds: number }[];
  oc: number;
  position: Point;
  moveInches: number;
  battleShocked: boolean;
  engaged: boolean;
  destroyed: boolean;
  startingModelCount: number;
}

interface PendingDecision {
  armyUnitId: number;
  unitName: string;
  position: Point;
  moveInches: number;
  kind: "movement" | "shooting" | "charge";
  targets?: { armyUnitId: number; name: string; position: Point; distance: number }[];
  spotCandidates?: { armyUnitId: number; name: string }[];
  stratagemOffers?: { key: string; name: string; cp: number; description: string }[];
  weaponTargets?: { weapon: string; targets: { armyUnitId: number; name: string; distance: number }[] }[];
}

interface SpatialState {
  round: number;
  maxRounds: number;
  cpA: number;
  cpB: number;
  vpA: number;
  vpB: number;
  playerSide: "a" | "b";
  winner?: "a" | "b" | "draw";
  unitsA: SpatialUnitView[];
  unitsB: SpatialUnitView[];
  objectives: { position: Point; vp: number }[];
}

interface StartResponse {
  battleId: number;
  state: SpatialState;
  log: LogEntry[];
  pending: PendingDecision[] | null;
  activeRuleHooks?: { a: string[]; b: string[] };
}

function aliveCount(u: SpatialUnitView): number {
  return u.models.filter((m) => m.curWounds > 0).length;
}

// Small grid of offsets (inches) so a unit's models render as a clustered
// formation around its anchor position instead of stacked on one point.
function tokenOffsets(count: number, spacing: number): Point[] {
  const cols = Math.max(1, Math.ceil(Math.sqrt(count)));
  const rows = Math.ceil(count / cols);
  const out: Point[] = [];
  for (let i = 0; i < count; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    out.push({ x: (col - (cols - 1) / 2) * spacing, y: (row - (rows - 1) / 2) * spacing });
  }
  return out;
}

export default function BoardBattleSimPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [armies, setArmies] = useState<SimArmy[]>([]);
  const [missions, setMissions] = useState<SimMission[]>([]);

  const [playerArmyId, setPlayerArmyId] = useState("");
  const [opponentArmyId, setOpponentArmyId] = useState("");
  const [missionKey, setMissionKey] = useState("");
  const [rounds, setRounds] = useState(5);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");

  const [battleId, setBattleId] = useState<number | null>(null);
  const [state, setState] = useState<SpatialState | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [pending, setPending] = useState<PendingDecision[]>([]);
  const [choices, setChoices] = useState<Record<number, string>>({});
  const [selectedUnitId, setSelectedUnitId] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [activeRuleHooks, setActiveRuleHooks] = useState<{ a: string[]; b: string[] }>({ a: [], b: [] });
  // Stratagem selection is staged separately from the shooting target choice
  // (a target still needs picking, or the unit might hold fire) and merged
  // into the final decision string on submit — see buildFinalChoices().
  const [stratChoices, setStratChoices] = useState<Record<number, string>>({});
  // Per-weapon target picks for units offered a weaponTargets split, keyed
  // "armyUnitId:weaponName" -> chosen armyUnitId or "hold_fire".
  const [weaponChoices, setWeaponChoices] = useState<Record<string, string>>({});

  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    async function load() {
      const meRes = await fetch("/api/auth/me");
      if (!meRes.ok) { router.push("/login"); return; }
      const me = await meRes.json();
      if (me.role !== "admin") { router.push("/"); return; }

      const [armiesRes, missionsRes] = await Promise.all([
        fetch("/api/admin/battle-sim/armies"),
        fetch("/api/admin/battle-sim/missions"),
      ]);
      if (armiesRes.ok) setArmies(await armiesRes.json());
      if (missionsRes.ok) {
        const m: SimMission[] = await missionsRes.json();
        setMissions(m);
        if (m.length > 0) setMissionKey(m[0].key);
      }
      setReady(true);
    }
    load();
  }, [router]);

  async function handleStart() {
    if (!playerArmyId || !opponentArmyId) return;
    setStarting(true);
    setError("");
    try {
      const res = await fetch("/api/admin/battle-sim/spatial", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          player_army_id: parseInt(playerArmyId, 10),
          opponent_army_id: parseInt(opponentArmyId, 10),
          mission_key: missionKey,
          rounds,
        }),
      });
      const body: StartResponse & { error?: string } = await res.json();
      if (!res.ok) { setError(body.error ?? "Failed to start battle"); return; }
      setBattleId(body.battleId);
      setState(body.state);
      setLog(body.log);
      setPending(body.pending ?? []);
      setActiveRuleHooks(body.activeRuleHooks ?? { a: [], b: [] });
      setChoices({});
      setStratChoices({});
      setWeaponChoices({});
      setSelectedUnitId(null);
    } catch {
      setError("Failed to start battle");
    } finally {
      setStarting(false);
    }
  }

  // Merges the plain target/hold choices with any staged stratagem picks
  // and per-weapon target splits into the final decision strings the engine
  // expects — see PendingDecision's field comments in lib/battleSimSpatial.ts.
  function buildFinalChoices(): Record<number, string> {
    const out: Record<number, string> = { ...choices };
    for (const p of pending) {
      if (p.weaponTargets && !out[p.armyUnitId]?.startsWith("spot:")) {
        const split: Record<string, string> = {};
        for (const wt of p.weaponTargets) split[wt.weapon] = weaponChoices[`${p.armyUnitId}:${wt.weapon}`] ?? "hold_fire";
        out[p.armyUnitId] = JSON.stringify(split);
      } else if (!p.weaponTargets) {
        const strat = stratChoices[p.armyUnitId];
        if (strat && out[p.armyUnitId] && !out[p.armyUnitId].startsWith("spot:")) {
          out[p.armyUnitId] = `strat:${strat}:${out[p.armyUnitId]}`;
        }
      }
    }
    return out;
  }

  async function handleSubmit() {
    if (!battleId) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/admin/battle-sim/spatial/${battleId}/decide`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decisions: buildFinalChoices() }),
      });
      const body: StartResponse & { error?: string } = await res.json();
      if (!res.ok) { setError(body.error ?? "Failed to advance"); return; }
      setState(body.state);
      setLog(body.log);
      setPending(body.pending ?? []);
      setActiveRuleHooks(body.activeRuleHooks ?? activeRuleHooks);
      setChoices({});
      setStratChoices({});
      setWeaponChoices({});
      setSelectedUnitId(null);
    } catch {
      setError("Failed to advance");
    } finally {
      setSubmitting(false);
    }
  }

  // Converts a pointer/mouse event's screen coordinates into board-space
  // (inches) via the SVG's own coordinate transform — works regardless of
  // how the SVG is scaled on screen, no manual pixel math needed.
  function eventToBoardPoint(e: React.MouseEvent): Point | null {
    const svg = svgRef.current;
    if (!svg) return null;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const local = pt.matrixTransform(ctm.inverse());
    return clampToBoard({ x: local.x, y: local.y });
  }

  const selectedPending = pending.find((p) => p.armyUnitId === selectedUnitId) ?? null;

  function handleBoardClick(e: React.MouseEvent) {
    if (!selectedPending || selectedPending.kind !== "movement") return;
    const click = eventToBoardPoint(e);
    if (!click) return;
    const d = dist(selectedPending.position, click);
    const finalPoint =
      d <= selectedPending.moveInches
        ? click
        : {
            x: selectedPending.position.x + ((click.x - selectedPending.position.x) * selectedPending.moveInches) / d,
            y: selectedPending.position.y + ((click.y - selectedPending.position.y) * selectedPending.moveInches) / d,
          };
    setChoices((prev) => ({ ...prev, [selectedPending.armyUnitId]: JSON.stringify(finalPoint) }));
  }

  function handleTargetClick(targetArmyUnitId: number) {
    if (!selectedPending || selectedPending.kind === "movement") return;
    if (!selectedPending.targets?.some((t) => t.armyUnitId === targetArmyUnitId)) return;
    setChoices((prev) => ({ ...prev, [selectedPending.armyUnitId]: String(targetArmyUnitId) }));
  }

  if (!ready) return <div className="max-w-5xl mx-auto px-4 py-8 text-gray-400">Loading…</div>;

  const mission = missions.find((m) => m.key === missionKey);

  // ─── Setup screen ───
  if (!state) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
        <div>
          <Link href="/admin/battle-sim" className="text-gray-500 hover:text-gray-300 text-sm">← Battle Simulator</Link>
          <h1 className="text-2xl font-bold text-amber-400 uppercase tracking-wide mt-1">Battle Board</h1>
          <p className="text-gray-500 text-sm mt-1">
            A real {BOARD_WIDTH}&quot;×{BOARD_DEPTH}&quot; board — models are drawn to their actual base size,
            and you move/target them directly on the board. Movement is capped by each unit&apos;s real Move
            stat, and Charge is a real 2D6&quot; roll against the real gap to close.
          </p>
        </div>

        <section className="bg-gray-900 border border-gray-800 rounded-lg p-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-gray-400 text-xs uppercase font-bold block mb-1">Your army</label>
              <select value={playerArmyId} onChange={(e) => setPlayerArmyId(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-2 text-white text-sm focus:outline-none focus:border-amber-500">
                <option value="">— pick an army —</option>
                {armies.map((a) => <option key={a.id} value={a.id}>{a.name} — {a.faction ?? "no faction"}, {a.unit_count} units</option>)}
              </select>
            </div>
            <div>
              <label className="text-gray-400 text-xs uppercase font-bold block mb-1">Computer&apos;s army</label>
              <select value={opponentArmyId} onChange={(e) => setOpponentArmyId(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-2 text-white text-sm focus:outline-none focus:border-amber-500">
                <option value="">— pick an army —</option>
                {armies.map((a) => <option key={a.id} value={a.id}>{a.name} — {a.faction ?? "no faction"}, {a.unit_count} units</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="text-gray-400 text-xs uppercase font-bold block mb-1">Mission</label>
            <select value={missionKey} onChange={(e) => setMissionKey(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-2 text-white text-sm focus:outline-none focus:border-amber-500">
              {missions.map((m) => <option key={m.key} value={m.key}>{m.name}</option>)}
            </select>
            {mission && <p className="text-gray-500 text-xs mt-1">{mission.description}</p>}
          </div>

          <div className="flex items-center gap-2">
            <label className="text-gray-400 text-xs uppercase font-bold">Battle rounds:</label>
            <input type="number" min={1} max={10} value={rounds}
              onChange={(e) => setRounds(parseInt(e.target.value, 10) || 5)}
              className="w-16 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-white text-sm focus:outline-none focus:border-amber-500" />
          </div>

          <button onClick={handleStart} disabled={starting || !playerArmyId || !opponentArmyId}
            className="bg-red-700 hover:bg-red-600 disabled:opacity-50 text-white px-4 py-2 rounded font-medium text-sm transition-colors">
            {starting ? "Deploying…" : "⚔ Begin Battle"}
          </button>
          {error && <p className="text-red-400 text-xs">{error}</p>}
        </section>
      </div>
    );
  }

  // ─── Board screen ───
  const playerArmyName = armies.find((a) => a.id === parseInt(playerArmyId, 10))?.name ?? "Your army";
  const oppArmyName = armies.find((a) => a.id === parseInt(opponentArmyId, 10))?.name ?? "Computer";
  const allUnits = [...state.unitsA, ...state.unitsB].filter((u) => !u.destroyed && aliveCount(u) > 0);
  const validTargetIds = new Set(selectedPending?.targets?.map((t) => t.armyUnitId) ?? []);

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <Link href="/admin/battle-sim" className="text-gray-500 hover:text-gray-300 text-sm">← Battle Simulator</Link>
          <h1 className="text-xl font-bold text-amber-400 uppercase tracking-wide mt-1">
            {playerArmyName} <span className="text-gray-600">vs</span> {oppArmyName}
          </h1>
        </div>
        <div className="text-right text-sm">
          <div className="text-gray-400">Round {state.round} / {state.maxRounds}</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-3">
          <div className="text-white font-bold text-sm">{playerArmyName} (you)</div>
          <div className="text-green-400 font-mono text-lg">{state.playerSide === "a" ? state.vpA : state.vpB} VP</div>
          <RuleHookBadge labels={activeRuleHooks[state.playerSide]} />
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-3">
          <div className="text-white font-bold text-sm">{oppArmyName} (computer)</div>
          <div className="text-red-400 font-mono text-lg">{state.playerSide === "a" ? state.vpB : state.vpA} VP</div>
          <RuleHookBadge labels={activeRuleHooks[state.playerSide === "a" ? "b" : "a"]} />
        </div>
      </div>

      {state.winner && (
        <div className="bg-amber-950 border border-amber-700 rounded-lg p-4 text-center">
          <div className="text-amber-400 font-bold text-lg uppercase">
            {state.winner === "draw" ? "Draw" : state.winner === state.playerSide ? "Victory!" : "Defeat"}
          </div>
          <button onClick={() => { setState(null); setBattleId(null); setLog([]); setPending([]); }}
            className="mt-2 bg-gray-700 hover:bg-gray-600 text-white px-4 py-1.5 rounded text-sm">
            Play Again
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
        {/* Board */}
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-2">
          <svg
            ref={svgRef}
            viewBox={`0 0 ${BOARD_WIDTH} ${BOARD_DEPTH}`}
            className="w-full bg-[#1a2418] rounded cursor-crosshair"
            style={{ aspectRatio: `${BOARD_WIDTH} / ${BOARD_DEPTH}` }}
            onClick={handleBoardClick}
          >
            {/* Deployment zones */}
            <rect x={0} y={0} width={BOARD_WIDTH} height={DEPLOY_DEPTH}
              fill={state.playerSide === "b" ? "rgba(34,197,94,0.08)" : "rgba(239,68,68,0.08)"} />
            <rect x={0} y={BOARD_DEPTH - DEPLOY_DEPTH} width={BOARD_WIDTH} height={DEPLOY_DEPTH}
              fill={state.playerSide === "a" ? "rgba(34,197,94,0.08)" : "rgba(239,68,68,0.08)"} />

            {/* Objectives */}
            {state.objectives.map((o, i) => (
              <circle key={i} cx={o.position.x} cy={o.position.y} r={OBJECTIVE_RADIUS}
                fill="rgba(251,191,36,0.12)" stroke="rgba(251,191,36,0.6)" strokeWidth={0.15} strokeDasharray="0.6,0.4" />
            ))}

            {/* Movement range ring for the selected unit */}
            {selectedPending?.kind === "movement" && (
              <circle cx={selectedPending.position.x} cy={selectedPending.position.y} r={selectedPending.moveInches}
                fill="none" stroke="#fbbf24" strokeWidth={0.15} strokeDasharray="0.4,0.3" />
            )}
            {/* Charge threat ring */}
            {selectedPending?.kind === "charge" && (
              <circle cx={selectedPending.position.x} cy={selectedPending.position.y} r={MAX_CHARGE_THREAT}
                fill="none" stroke="#f87171" strokeWidth={0.1} strokeDasharray="0.4,0.3" />
            )}

            {/* Chosen movement destination preview */}
            {selectedPending?.kind === "movement" && choices[selectedPending.armyUnitId] && (() => {
              try {
                const p: Point = JSON.parse(choices[selectedPending.armyUnitId]);
                return <circle cx={p.x} cy={p.y} r={0.6} fill="#fbbf24" opacity={0.7} />;
              } catch { return null; }
            })()}

            {/* Units */}
            {allUnits.map((u) => {
              const isMine = u.side === state.playerSide;
              const isSelected = u.armyUnitId === selectedUnitId;
              const isPendingUnit = pending.some((p) => p.armyUnitId === u.armyUnitId);
              const isValidTarget = validTargetIds.has(u.armyUnitId);
              const base = parseBaseSize(u.stats.model_profiles?.[0]?.base);
              const rx = mmToInches(base.widthMm) / 2;
              const ry = mmToInches(base.depthMm) / 2;
              const alive = aliveCount(u);
              const offsets = tokenOffsets(alive, Math.max(rx, ry) * 2.3);
              const fill = isMine ? "#4ade80" : "#f87171";

              return (
                <g
                  key={u.armyUnitId}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (isValidTarget) handleTargetClick(u.armyUnitId);
                    else if (isMine && isPendingUnit) setSelectedUnitId(u.armyUnitId);
                  }}
                  style={{ cursor: isValidTarget || (isMine && isPendingUnit) ? "pointer" : "default" }}
                >
                  {offsets.map((off, i) => {
                    const cx = u.position.x + off.x;
                    const cy = u.position.y + off.y;
                    return base.shape === "circle" ? (
                      <circle key={i} cx={cx} cy={cy} r={rx} fill={fill}
                        stroke={isSelected ? "#fff" : isValidTarget ? "#fbbf24" : "#00000055"}
                        strokeWidth={isSelected || isValidTarget ? 0.25 : 0.08} opacity={0.9} />
                    ) : (
                      <ellipse key={i} cx={cx} cy={cy} rx={rx} ry={ry} fill={fill}
                        stroke={isSelected ? "#fff" : isValidTarget ? "#fbbf24" : "#00000055"}
                        strokeWidth={isSelected || isValidTarget ? 0.25 : 0.08} opacity={0.9} />
                    );
                  })}
                  {u.battleShocked && (
                    <text x={u.position.x} y={u.position.y - Math.max(rx, ry) - 0.5} fontSize={1.4} textAnchor="middle" fill="#fbbf24">⚠</text>
                  )}
                  {isPendingUnit && isMine && (
                    <circle cx={u.position.x} cy={u.position.y} r={Math.max(rx, ry) + 0.6} fill="none" stroke="#fbbf24" strokeWidth={0.12} strokeDasharray="0.3,0.2" />
                  )}
                </g>
              );
            })}
          </svg>
          <p className="text-gray-600 text-xs mt-1">
            {selectedPending?.kind === "movement" && "Click the board to move this unit (clamped to its Move range)."}
            {selectedPending?.kind === "shooting" && "Click a highlighted enemy to target it."}
            {selectedPending?.kind === "charge" && "Click a highlighted enemy to charge it."}
            {!selectedPending && pending.length > 0 && "Click one of your highlighted units to give it orders."}
          </p>
        </div>

        {/* Orders panel */}
        <div className="space-y-3">
          {pending.length > 0 && !state.winner && (
            <section className="bg-gray-900 border border-amber-800 rounded-lg p-3 space-y-2">
              <div className="text-amber-400 font-bold text-xs uppercase tracking-wide">
                Your {pending[0].kind} — {pending.length} unit{pending.length === 1 ? "" : "s"}
              </div>
              {pending.map((p) => {
                const choice = choices[p.armyUnitId];
                let choiceLabel = "—";
                if (p.weaponTargets && choice?.startsWith("spot:")) {
                  choiceLabel = `spotting ${p.spotCandidates?.find((s) => `spot:${s.armyUnitId}` === choice)?.name ?? ""}`;
                } else if (p.weaponTargets) {
                  const picked = p.weaponTargets.filter((wt) => (weaponChoices[`${p.armyUnitId}:${wt.weapon}`] ?? "hold_fire") !== "hold_fire").length;
                  choiceLabel = picked > 0 ? `${picked}/${p.weaponTargets.length} firing` : "hold fire";
                } else if (p.kind === "movement") choiceLabel = choice ? "moved" : "hold";
                else if (choice === "hold_fire") choiceLabel = "hold fire";
                else if (choice === "decline") choiceLabel = "decline";
                else if (choice?.startsWith("spot:")) choiceLabel = `spotting ${p.spotCandidates?.find((s) => `spot:${s.armyUnitId}` === choice)?.name ?? ""}`;
                else if (choice) choiceLabel = p.targets?.find((t) => String(t.armyUnitId) === choice)?.name ?? "—";
                if (stratChoices[p.armyUnitId] && !choiceLabel.startsWith("spot")) {
                  const s = p.stratagemOffers?.find((o) => o.key === stratChoices[p.armyUnitId]);
                  if (s) choiceLabel += ` +${s.name}`;
                }
                return (
                  <div key={p.armyUnitId}
                    onClick={() => setSelectedUnitId(p.armyUnitId)}
                    className={`text-xs rounded p-2 cursor-pointer transition-colors ${p.armyUnitId === selectedUnitId ? "bg-amber-900/40 border border-amber-700" : "bg-gray-800/60 border border-transparent hover:border-gray-700"}`}>
                    <div className="flex items-center justify-between">
                      <span className="text-white">{p.unitName}</span>
                      <span className="text-gray-500">{choiceLabel}</span>
                    </div>
                    {p.armyUnitId === selectedUnitId && p.kind !== "movement" && p.weaponTargets && (
                      <div className="mt-1 space-y-1">
                        {choice?.startsWith("spot:") ? (
                          <div className="text-sky-300 text-[11px]">Spotting {p.spotCandidates?.find((s) => `spot:${s.armyUnitId}` === choice)?.name} instead of shooting.
                            <button onClick={(e) => { e.stopPropagation(); setChoices((prev) => { const n = { ...prev }; delete n[p.armyUnitId]; return n; }); }}
                              className="ml-2 underline text-gray-400 hover:text-gray-200">cancel</button>
                          </div>
                        ) : (
                          <>
                            {p.weaponTargets.map((wt) => {
                              const key = `${p.armyUnitId}:${wt.weapon}`;
                              const val = weaponChoices[key] ?? "hold_fire";
                              return (
                                <div key={wt.weapon} className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                                  <span className="text-gray-400 w-28 truncate" title={wt.weapon}>{wt.weapon}</span>
                                  <select value={val} onChange={(e) => setWeaponChoices((prev) => ({ ...prev, [key]: e.target.value }))}
                                    className="bg-gray-800 border border-gray-700 rounded px-1 py-0.5 text-white text-[11px] flex-1">
                                    <option value="hold_fire">Hold fire</option>
                                    {wt.targets.map((t) => <option key={t.armyUnitId} value={String(t.armyUnitId)}>{t.name} ({t.distance}&quot;)</option>)}
                                  </select>
                                </div>
                              );
                            })}
                            {p.spotCandidates && p.spotCandidates.length > 0 && (
                              <div className="flex flex-wrap gap-1 pt-1" onClick={(e) => e.stopPropagation()}>
                                {p.spotCandidates.map((s) => (
                                  <button key={`spot-${s.armyUnitId}`}
                                    onClick={() => setChoices((prev) => ({ ...prev, [p.armyUnitId]: `spot:${s.armyUnitId}` }))}
                                    className="px-2 py-0.5 rounded bg-sky-950 border border-sky-800 hover:border-sky-600 text-sky-300"
                                    title="For the Greater Good: mark this enemy Spotted instead of shooting with any weapon.">
                                    🎯 Spot {s.name} instead
                                  </button>
                                ))}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    )}
                    {p.armyUnitId === selectedUnitId && p.kind !== "movement" && !p.weaponTargets && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        <button onClick={(e) => { e.stopPropagation(); setChoices((prev) => ({ ...prev, [p.armyUnitId]: p.kind === "shooting" ? "hold_fire" : "decline" })); }}
                          className="px-2 py-0.5 rounded bg-gray-700 hover:bg-gray-600 text-gray-300">
                          {p.kind === "shooting" ? "Hold fire" : "Decline"}
                        </button>
                        {p.targets?.map((t) => (
                          <button key={t.armyUnitId} onClick={(e) => { e.stopPropagation(); handleTargetClick(t.armyUnitId); }}
                            className={`px-2 py-0.5 rounded ${choice === String(t.armyUnitId) ? "bg-amber-600 text-white" : "bg-gray-700 hover:bg-gray-600 text-gray-300"}`}>
                            {t.name} ({t.distance}&quot;)
                          </button>
                        ))}
                        {p.spotCandidates?.map((s) => (
                          <button key={`spot-${s.armyUnitId}`}
                            onClick={(e) => { e.stopPropagation(); setChoices((prev) => ({ ...prev, [p.armyUnitId]: `spot:${s.armyUnitId}` })); }}
                            className={`px-2 py-0.5 rounded ${choice === `spot:${s.armyUnitId}` ? "bg-sky-600 text-white" : "bg-sky-950 border border-sky-800 hover:border-sky-600 text-sky-300"}`}
                            title="For the Greater Good: mark this enemy Spotted instead of shooting.">
                            🎯 Spot {s.name}
                          </button>
                        ))}
                      </div>
                    )}
                    {p.armyUnitId === selectedUnitId && p.kind === "shooting" && (p.stratagemOffers?.length ?? 0) > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1" onClick={(e) => e.stopPropagation()}>
                        {p.stratagemOffers!.map((s) => {
                          const active = stratChoices[p.armyUnitId] === s.key;
                          return (
                            <button key={s.key} title={s.description}
                              onClick={() => setStratChoices((prev) => { const n = { ...prev }; if (active) delete n[p.armyUnitId]; else n[p.armyUnitId] = s.key; return n; })}
                              className={`px-2 py-0.5 rounded ${active ? "bg-purple-600 text-white" : "bg-purple-950 border border-purple-800 hover:border-purple-600 text-purple-300"}`}>
                              ⚡ {s.name} ({s.cp}CP)
                            </button>
                          );
                        })}
                      </div>
                    )}
                    {p.armyUnitId === selectedUnitId && p.kind === "movement" && (
                      <div className="flex gap-1 mt-1">
                        <button onClick={(e) => { e.stopPropagation(); setChoices((prev) => { const n = { ...prev }; delete n[p.armyUnitId]; return n; }); }}
                          className="px-2 py-0.5 rounded bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs">
                          Reset to hold
                        </button>
                        <span className="text-gray-600 text-xs self-center">M{p.moveInches}&quot; — click the board</span>
                      </div>
                    )}
                  </div>
                );
              })}
              <button onClick={handleSubmit} disabled={submitting}
                className="w-full bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white px-3 py-2 rounded font-medium text-sm transition-colors">
                {submitting ? "Resolving…" : "Confirm Orders"}
              </button>
              {error && <p className="text-red-400 text-xs">{error}</p>}
            </section>
          )}

          <section className="bg-gray-900 border border-gray-800 rounded-lg p-3">
            <div className="text-gray-500 text-xs uppercase font-bold mb-2">Battle Log</div>
            <div className="max-h-[40vh] overflow-y-auto space-y-1 font-mono text-[11px]">
              {log.map((entry, i) => (
                <div key={i} className="text-gray-300">
                  <span className="text-gray-600">[R{entry.round} {entry.phase}]</span> {entry.message}
                  {entry.rolls && entry.rolls.length > 0 && <DiceRow rolls={entry.rolls} />}
                </div>
              ))}
            </div>
          </section>

          <details className="bg-gray-900 border border-gray-800 rounded-lg p-3 text-xs">
            <summary className="text-gray-500 uppercase font-bold cursor-pointer select-none">Rules Reference</summary>
            <div className="mt-2 space-y-3 max-h-[40vh] overflow-y-auto">
              <div>
                <div className="text-gray-400 font-bold mb-1">Phase Sequence</div>
                <div className="space-y-1.5">
                  {PHASE_SEQUENCE.map((r) => (
                    <div key={r.title}><span className="text-white">{r.title}:</span> <span className="text-gray-400">{r.text}</span></div>
                  ))}
                </div>
              </div>
              <div>
                <div className="text-gray-400 font-bold mb-1">Weapon Keywords (mechanically enforced)</div>
                <div className="space-y-1.5">
                  {KEYWORD_REFERENCE.map((r) => (
                    <div key={r.title}><span className="text-white">{r.title}:</span> <span className="text-gray-400">{r.text}</span></div>
                  ))}
                </div>
              </div>
            </div>
          </details>
        </div>
      </div>
    </div>
  );
}
