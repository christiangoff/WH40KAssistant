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
  objectives: { zone: string; vp: number }[];
  scoringRounds: number[];
}

interface LogEntry {
  round: number;
  phase: string;
  message: string;
}

interface SimResult {
  vpA: number;
  vpB: number;
  cpA: number;
  cpB: number;
  winner: "a" | "b" | "draw";
  casualtiesA: number;
  casualtiesB: number;
  survivorsA: number;
  survivorsB: number;
}

interface PastBattle {
  id: number;
  army_a_name: string;
  army_b_name: string;
  mission_key: string;
  winner: string;
  vp_a: number;
  vp_b: number;
  created_at: number;
}

export default function BattleSimPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [armies, setArmies] = useState<SimArmy[]>([]);
  const [missions, setMissions] = useState<SimMission[]>([]);
  const [past, setPast] = useState<PastBattle[]>([]);

  const [armyAId, setArmyAId] = useState("");
  const [armyBId, setArmyBId] = useState("");
  const [missionKey, setMissionKey] = useState("");
  const [rounds, setRounds] = useState(5);

  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [result, setResult] = useState<SimResult | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      const meRes = await fetch("/api/auth/me");
      if (!meRes.ok) { router.push("/login"); return; }
      const me = await meRes.json();
      if (me.role !== "admin") { router.push("/"); return; }

      const [armiesRes, missionsRes, pastRes] = await Promise.all([
        fetch("/api/admin/battle-sim/armies"),
        fetch("/api/admin/battle-sim/missions"),
        fetch("/api/admin/battle-sim"),
      ]);
      if (armiesRes.ok) setArmies(await armiesRes.json());
      if (missionsRes.ok) {
        const m: SimMission[] = await missionsRes.json();
        setMissions(m);
        if (m.length > 0) setMissionKey(m[0].key);
      }
      if (pastRes.ok) setPast(await pastRes.json());
      setReady(true);
    }
    load();
  }, [router]);

  async function loadPast() {
    const res = await fetch("/api/admin/battle-sim");
    if (res.ok) setPast(await res.json());
  }

  async function handleRun() {
    if (!armyAId || !armyBId) return;
    setRunning(true);
    setLog([]);
    setResult(null);
    setError("");
    try {
      const res = await fetch("/api/admin/battle-sim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ army_a_id: parseInt(armyAId, 10), army_b_id: parseInt(armyBId, 10), mission_key: missionKey, rounds }),
      });
      if (!res.ok || !res.body) {
        setError((await res.json().catch(() => ({}))).error ?? "Simulation failed to start");
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const msg = JSON.parse(line);
          if (msg.type === "log") setLog((prev) => [...prev, { round: msg.round, phase: msg.phase, message: msg.message }]);
          else if (msg.type === "done") setResult(msg.result);
          else if (msg.type === "error") setError(msg.error);
        }
      }
      await loadPast();
    } catch {
      setError("Simulation failed");
    } finally {
      setRunning(false);
    }
  }

  if (!ready) return <div className="max-w-4xl mx-auto px-4 py-8 text-gray-400">Loading…</div>;

  const armyA = armies.find((a) => a.id === parseInt(armyAId, 10));
  const armyB = armies.find((a) => a.id === parseInt(armyBId, 10));
  const mission = missions.find((m) => m.key === missionKey);

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
      <div>
        <Link href="/admin" className="text-gray-500 hover:text-gray-300 text-sm">← Admin</Link>
        <h1 className="text-2xl font-bold text-amber-400 uppercase tracking-wide mt-1">Battle Simulator</h1>
        <p className="text-gray-500 text-sm mt-1">
          Uses each army&apos;s real stats, weapons, and points. Position is abstracted into five
          zones (not literal inches/line-of-sight), and detachment rules, stratagems, and weapon
          special abilities aren&apos;t executed mechanically — this is a plausible game, not a
          rules-accurate one.
        </p>
      </div>

      <Link
        href="/admin/battle-sim/play"
        className="block bg-red-950 border border-red-800 hover:border-red-600 rounded-lg p-4 transition-colors"
      >
        <div className="text-amber-400 font-bold text-sm uppercase tracking-wide">⚔ Play a Battle</div>
        <p className="text-gray-400 text-sm mt-1">
          Pick one of your armies and control it phase by phase against a computer opponent (another
          of your armies) — Movement and Shooting decisions are yours; the computer plays its own
          turn automatically.
        </p>
      </Link>

      <section className="bg-gray-900 border border-gray-800 rounded-lg p-4 space-y-3">
        <div className="text-gray-400 font-bold text-xs uppercase tracking-wide">Quick Auto-Resolve</div>
        <p className="text-gray-500 text-xs -mt-1">
          Runs the whole battle for you and shows the final log — no decisions, just a result.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="text-gray-400 text-xs uppercase font-bold block mb-1">Army A</label>
            <select
              value={armyAId}
              onChange={(e) => setArmyAId(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-2 text-white text-sm focus:outline-none focus:border-amber-500"
            >
              <option value="">— pick an army —</option>
              {armies.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} — {a.faction ?? "no faction"}, {a.unit_count} units
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-gray-400 text-xs uppercase font-bold block mb-1">Army B (opponent)</label>
            <select
              value={armyBId}
              onChange={(e) => setArmyBId(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-2 text-white text-sm focus:outline-none focus:border-amber-500"
            >
              <option value="">— pick an army —</option>
              {armies.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} — {a.faction ?? "no faction"}, {a.unit_count} units
                </option>
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
            {missions.map((m) => (
              <option key={m.key} value={m.key}>{m.name}</option>
            ))}
          </select>
          {mission && <p className="text-gray-500 text-xs mt-1">{mission.description}</p>}
        </div>

        <div className="flex items-center gap-2">
          <label className="text-gray-400 text-xs uppercase font-bold">Battle rounds:</label>
          <input
            type="number"
            min={1}
            max={10}
            value={rounds}
            onChange={(e) => setRounds(parseInt(e.target.value, 10) || 5)}
            className="w-16 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-white text-sm focus:outline-none focus:border-amber-500"
          />
        </div>

        <button
          onClick={handleRun}
          disabled={running || !armyAId || !armyBId}
          className="bg-red-700 hover:bg-red-600 disabled:opacity-50 text-white px-4 py-2 rounded font-medium text-sm transition-colors"
        >
          {running ? "⚔ Simulating…" : "⚔ Simulate Battle"}
        </button>
        {error && <p className="text-red-400 text-xs">{error}</p>}
      </section>

      {(log.length > 0 || result) && (
        <section className="bg-gray-900 border border-gray-800 rounded-lg p-4 space-y-3">
          {result && (
            <div className="bg-gray-800/60 border border-gray-700 rounded p-3">
              <div className="text-amber-400 font-bold text-sm uppercase mb-1">
                {result.winner === "draw" ? "Draw" : `${result.winner === "a" ? armyA?.name ?? "Army A" : armyB?.name ?? "Army B"} wins`}
              </div>
              <div className="grid grid-cols-2 gap-3 text-xs text-gray-300 mt-2">
                <div>
                  <div className="text-white font-bold">{armyA?.name ?? "Army A"}</div>
                  <div>{result.vpA} VP · {result.cpA} CP remaining</div>
                  <div className="text-gray-500">{result.survivorsA} models survived, {result.casualtiesA} lost</div>
                </div>
                <div>
                  <div className="text-white font-bold">{armyB?.name ?? "Army B"}</div>
                  <div>{result.vpB} VP · {result.cpB} CP remaining</div>
                  <div className="text-gray-500">{result.survivorsB} models survived, {result.casualtiesB} lost</div>
                </div>
              </div>
            </div>
          )}
          <div className="max-h-[50vh] overflow-y-auto space-y-1 font-mono text-xs">
            {log.map((entry, i) => (
              <div key={i} className="text-gray-300">
                <span className="text-gray-600">[R{entry.round} {entry.phase}]</span> {entry.message}
              </div>
            ))}
          </div>
        </section>
      )}

      {past.length > 0 && (
        <section className="bg-gray-900 border border-gray-800 rounded-lg p-4">
          <h2 className="text-white font-bold uppercase text-sm tracking-wide mb-3">Past Battles</h2>
          <div className="divide-y divide-gray-800">
            {past.map((b) => (
              <div key={b.id} className="py-2 flex items-center justify-between text-sm">
                <span className="text-gray-300">
                  {b.army_a_name} <span className="text-gray-600">vs</span> {b.army_b_name}
                </span>
                <span className="text-gray-500 text-xs">
                  {b.vp_a}–{b.vp_b} · {b.winner === "draw" ? "draw" : `${b.winner.toUpperCase()} won`}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
