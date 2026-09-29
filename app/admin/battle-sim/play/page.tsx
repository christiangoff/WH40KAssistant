"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

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

interface LogEntry {
  round: number;
  phase: string;
  message: string;
}

interface PendingDecision {
  armyUnitId: number;
  unitName: string;
  zone: string;
  kind: "movement" | "shooting";
  targets?: { armyUnitId: number; name: string }[];
}

interface LiveUnit {
  armyUnitId: number;
  name: string;
  side: "a" | "b";
  zone: string;
  destroyed: boolean;
  battleShocked: boolean;
  models: { maxWounds: number; curWounds: number }[];
}

interface LiveState {
  round: number;
  maxRounds: number;
  cpA: number;
  cpB: number;
  vpA: number;
  vpB: number;
  playerSide: "a" | "b";
  winner?: "a" | "b" | "draw";
  unitsA: LiveUnit[];
  unitsB: LiveUnit[];
}

function aliveCount(u: LiveUnit): number {
  return u.models.filter((m) => m.curWounds > 0).length;
}

export default function PlayBattleSimPage() {
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
  const [state, setState] = useState<LiveState | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [pending, setPending] = useState<PendingDecision[]>([]);
  const [choices, setChoices] = useState<Record<number, string>>({});
  const [submitting, setSubmitting] = useState(false);

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
      const res = await fetch("/api/admin/battle-sim/live", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          player_army_id: parseInt(playerArmyId, 10),
          opponent_army_id: parseInt(opponentArmyId, 10),
          mission_key: missionKey,
          rounds,
        }),
      });
      const body = await res.json();
      if (!res.ok) { setError(body.error ?? "Failed to start battle"); return; }
      setBattleId(body.battleId);
      setState(body.state);
      setLog(body.log);
      setPending(body.pending ?? []);
      setChoices({});
    } catch {
      setError("Failed to start battle");
    } finally {
      setStarting(false);
    }
  }

  async function handleSubmitDecisions() {
    if (!battleId) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/admin/battle-sim/live/${battleId}/decide`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decisions: choices }),
      });
      const body = await res.json();
      if (!res.ok) { setError(body.error ?? "Failed to advance"); return; }
      setState(body.state);
      setLog(body.log);
      setPending(body.pending ?? []);
      setChoices({});
    } catch {
      setError("Failed to advance");
    } finally {
      setSubmitting(false);
    }
  }

  function setChoice(armyUnitId: number, value: string) {
    setChoices((prev) => ({ ...prev, [armyUnitId]: value }));
  }

  if (!ready) return <div className="max-w-4xl mx-auto px-4 py-8 text-gray-400">Loading…</div>;

  const mission = missions.find((m) => m.key === missionKey);
  const allDecided = pending.length > 0 && pending.every((p) => choices[p.armyUnitId] != null);

  // ─── Setup screen ───
  if (!state) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
        <div>
          <Link href="/admin/battle-sim" className="text-gray-500 hover:text-gray-300 text-sm">← Battle Simulator</Link>
          <h1 className="text-2xl font-bold text-amber-400 uppercase tracking-wide mt-1">Play a Battle</h1>
          <p className="text-gray-500 text-sm mt-1">
            Pick one of your armies to play and another for the computer to control. You decide
            Movement (advance/hold) and Shooting (targets) each of your turns; the computer plays
            its own turn automatically, and Fight resolves automatically once units are engaged.
          </p>
        </div>

        <section className="bg-gray-900 border border-gray-800 rounded-lg p-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-gray-400 text-xs uppercase font-bold block mb-1">Your army</label>
              <select
                value={playerArmyId}
                onChange={(e) => setPlayerArmyId(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-2 text-white text-sm focus:outline-none focus:border-amber-500"
              >
                <option value="">— pick an army —</option>
                {armies.map((a) => (
                  <option key={a.id} value={a.id}>{a.name} — {a.faction ?? "no faction"}, {a.unit_count} units</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-gray-400 text-xs uppercase font-bold block mb-1">Computer&apos;s army</label>
              <select
                value={opponentArmyId}
                onChange={(e) => setOpponentArmyId(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-2 text-white text-sm focus:outline-none focus:border-amber-500"
              >
                <option value="">— pick an army —</option>
                {armies.map((a) => (
                  <option key={a.id} value={a.id}>{a.name} — {a.faction ?? "no faction"}, {a.unit_count} units</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="text-gray-400 text-xs uppercase font-bold block mb-1">Mission</label>
            <select
              value={missionKey}
              onChange={(e) => setMissionKey(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-2 text-white text-sm focus:outline-none focus:border-amber-500"
            >
              {missions.map((m) => <option key={m.key} value={m.key}>{m.name}</option>)}
            </select>
            {mission && <p className="text-gray-500 text-xs mt-1">{mission.description}</p>}
          </div>

          <div className="flex items-center gap-2">
            <label className="text-gray-400 text-xs uppercase font-bold">Battle rounds:</label>
            <input
              type="number" min={1} max={10} value={rounds}
              onChange={(e) => setRounds(parseInt(e.target.value, 10) || 5)}
              className="w-16 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-white text-sm focus:outline-none focus:border-amber-500"
            />
          </div>

          <button
            onClick={handleStart}
            disabled={starting || !playerArmyId || !opponentArmyId}
            className="bg-red-700 hover:bg-red-600 disabled:opacity-50 text-white px-4 py-2 rounded font-medium text-sm transition-colors"
          >
            {starting ? "Deploying…" : "⚔ Begin Battle"}
          </button>
          {error && <p className="text-red-400 text-xs">{error}</p>}
        </section>
      </div>
    );
  }

  // ─── In-battle screen ───
  const playerArmyName = armies.find((a) => a.id === parseInt(playerArmyId, 10))?.name ?? "Your army";
  const oppArmyName = armies.find((a) => a.id === parseInt(opponentArmyId, 10))?.name ?? "Computer";
  const playerUnits = state.playerSide === "a" ? state.unitsA : state.unitsB;
  const oppUnits = state.playerSide === "a" ? state.unitsB : state.unitsA;
  const playerVp = state.playerSide === "a" ? state.vpA : state.vpB;
  const oppVp = state.playerSide === "a" ? state.vpB : state.vpA;
  const playerCp = state.playerSide === "a" ? state.cpA : state.cpB;

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/admin/battle-sim" className="text-gray-500 hover:text-gray-300 text-sm">← Battle Simulator</Link>
          <h1 className="text-xl font-bold text-amber-400 uppercase tracking-wide mt-1">
            {playerArmyName} <span className="text-gray-600">vs</span> {oppArmyName}
          </h1>
        </div>
        <div className="text-right text-sm">
          <div className="text-gray-400">Round {state.round} / {state.maxRounds}</div>
          <div className="text-amber-400 font-mono">{playerCp}CP</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-3">
          <div className="text-white font-bold text-sm">{playerArmyName} (you)</div>
          <div className="text-green-400 font-mono text-lg">{playerVp} VP</div>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-3">
          <div className="text-white font-bold text-sm">{oppArmyName} (computer)</div>
          <div className="text-red-400 font-mono text-lg">{oppVp} VP</div>
        </div>
      </div>

      {state.winner && (
        <div className="bg-amber-950 border border-amber-700 rounded-lg p-4 text-center">
          <div className="text-amber-400 font-bold text-lg uppercase">
            {state.winner === "draw" ? "Draw" : state.winner === state.playerSide ? "Victory!" : "Defeat"}
          </div>
          <button
            onClick={() => { setState(null); setBattleId(null); setLog([]); setPending([]); }}
            className="mt-2 bg-gray-700 hover:bg-gray-600 text-white px-4 py-1.5 rounded text-sm"
          >
            Play Again
          </button>
        </div>
      )}

      {!state.winner && pending.length > 0 && (
        <section className="bg-gray-900 border border-amber-800 rounded-lg p-4 space-y-3">
          <div className="text-amber-400 font-bold text-xs uppercase tracking-wide">
            Your {pending[0].kind === "movement" ? "Movement" : "Shooting"} — {pending.length} unit{pending.length === 1 ? "" : "s"} to decide
          </div>
          <div className="space-y-2">
            {pending.map((p) => (
              <div key={p.armyUnitId} className="flex items-center justify-between gap-2 flex-wrap bg-gray-800/60 rounded p-2">
                <span className="text-white text-sm">{p.unitName} <span className="text-gray-500 text-xs">({p.zone})</span></span>
                {p.kind === "movement" ? (
                  <div className="flex gap-1">
                    {(["advance", "hold"] as const).map((opt) => (
                      <button
                        key={opt}
                        onClick={() => setChoice(p.armyUnitId, opt)}
                        className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                          choices[p.armyUnitId] === opt ? "bg-amber-600 text-white" : "bg-gray-700 text-gray-300 hover:bg-gray-600"
                        }`}
                      >
                        {opt === "advance" ? "Advance" : "Hold"}
                      </button>
                    ))}
                  </div>
                ) : (
                  <select
                    value={choices[p.armyUnitId] ?? ""}
                    onChange={(e) => setChoice(p.armyUnitId, e.target.value)}
                    className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-white text-xs focus:outline-none focus:border-amber-500"
                  >
                    <option value="">— choose —</option>
                    <option value="hold_fire">Hold fire</option>
                    {p.targets?.map((t) => (
                      <option key={t.armyUnitId} value={t.armyUnitId}>{t.name}</option>
                    ))}
                  </select>
                )}
              </div>
            ))}
          </div>
          <button
            onClick={handleSubmitDecisions}
            disabled={submitting || !allDecided}
            className="bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white px-4 py-2 rounded font-medium text-sm transition-colors"
          >
            {submitting ? "Resolving…" : "Confirm Orders"}
          </button>
          {error && <p className="text-red-400 text-xs">{error}</p>}
        </section>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-3">
          <div className="text-gray-500 text-xs uppercase font-bold mb-2">Your units</div>
          <div className="space-y-1">
            {playerUnits.map((u) => (
              <div key={u.armyUnitId} className={`text-xs flex justify-between ${u.destroyed || aliveCount(u) === 0 ? "text-gray-600 line-through" : "text-gray-300"}`}>
                <span>{u.name} {u.battleShocked && <span className="text-amber-500">⚠</span>}</span>
                <span>{aliveCount(u)}/{u.models.length} · {u.zone}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-3">
          <div className="text-gray-500 text-xs uppercase font-bold mb-2">Computer&apos;s units</div>
          <div className="space-y-1">
            {oppUnits.map((u) => (
              <div key={u.armyUnitId} className={`text-xs flex justify-between ${u.destroyed || aliveCount(u) === 0 ? "text-gray-600 line-through" : "text-gray-300"}`}>
                <span>{u.name} {u.battleShocked && <span className="text-amber-500">⚠</span>}</span>
                <span>{aliveCount(u)}/{u.models.length} · {u.zone}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <section className="bg-gray-900 border border-gray-800 rounded-lg p-4">
        <div className="text-gray-500 text-xs uppercase font-bold mb-2">Battle Log</div>
        <div className="max-h-[40vh] overflow-y-auto space-y-1 font-mono text-xs">
          {log.map((entry, i) => (
            <div key={i} className="text-gray-300">
              <span className="text-gray-600">[R{entry.round} {entry.phase}]</span> {entry.message}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
