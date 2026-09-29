import { NextRequest, NextResponse } from "next/server";
import getDb from "@/lib/db";
import { getUserFromRequest } from "@/lib/auth";
import { simulateBattle, MISSIONS, type SimLogEntry } from "@/lib/battleSim";

// Admin-only: past simulated battles, most recent first.
export async function GET(request: NextRequest) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const db = getDb();
  const battles = db
    .prepare(
      `SELECT sb.*, aa.name AS army_a_name, ab.name AS army_b_name
       FROM sim_battles sb
       JOIN armies aa ON aa.id = sb.army_a_id
       JOIN armies ab ON ab.id = sb.army_b_id
       ORDER BY sb.id DESC LIMIT 50`
    )
    .all();
  return NextResponse.json(battles);
}

// Admin-only: run a new simulated battle. Streams newline-delimited JSON —
// one line per log entry as the battle plays out, then a final "done" line
// with the persisted battle id and summary.
export async function POST(request: NextRequest) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const armyAId = parseInt(body.army_a_id, 10);
  const armyBId = parseInt(body.army_b_id, 10);
  const missionKey = typeof body.mission_key === "string" ? body.mission_key : MISSIONS[0].key;
  const rounds = Number.isFinite(body.rounds) ? Math.max(1, Math.min(10, body.rounds)) : 5;

  if (!Number.isFinite(armyAId) || !Number.isFinite(armyBId)) {
    return NextResponse.json({ error: "army_a_id and army_b_id are required" }, { status: 400 });
  }

  const db = getDb();
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      try {
        const log: SimLogEntry[] = [];
        const result = simulateBattle(db, { armyAId, armyBId, missionKey, rounds }, (entry) => {
          log.push(entry);
          send({ type: "log", ...entry });
        });

        const now = Date.now();
        const insertBattle = db.prepare(`
          INSERT INTO sim_battles
            (army_a_id, army_b_id, mission_key, rounds, winner, vp_a, vp_b, cp_a, cp_b,
             casualties_a, casualties_b, survivors_a, survivors_b, created_by, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const insertLog = db.prepare(
          `INSERT INTO sim_battle_log (battle_id, seq, round, phase, message) VALUES (?, ?, ?, ?, ?)`
        );

        const battleId = db.transaction(() => {
          const info = insertBattle.run(
            armyAId, armyBId, result.missionKey, result.rounds, result.winner,
            result.vpA, result.vpB, result.cpA, result.cpB,
            result.casualtiesA, result.casualtiesB, result.survivorsA, result.survivorsB,
            user.id, now
          );
          const id = info.lastInsertRowid as number;
          log.forEach((entry, i) => insertLog.run(id, i, entry.round, entry.phase, entry.message));
          return id;
        })();

        send({ type: "done", battleId, result });
      } catch (err) {
        send({ type: "error", error: err instanceof Error ? err.message : "Simulation failed" });
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" },
  });
}
