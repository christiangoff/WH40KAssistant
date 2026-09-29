import { NextRequest, NextResponse } from "next/server";
import getDb from "@/lib/db";
import { getUserFromRequest } from "@/lib/auth";
import { newSpatialBattle, advanceSpatialBattle } from "@/lib/battleSimSpatial";
import { MISSIONS } from "@/lib/battleSim";

// Admin-only: the current user's in-progress + recent spatial battles.
export async function GET(request: NextRequest) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const db = getDb();
  const battles = db
    .prepare(
      `SELECT sb.id, sb.mission_key, sb.status, sb.winner, sb.created_at, sb.updated_at,
              pa.name AS player_army_name, oa.name AS opponent_army_name
       FROM sim_spatial_battles sb
       JOIN armies pa ON pa.id = sb.player_army_id
       JOIN armies oa ON oa.id = sb.opponent_army_id
       WHERE sb.user_id = ?
       ORDER BY sb.updated_at DESC LIMIT 20`
    )
    .all(user.id);
  return NextResponse.json(battles);
}

// Admin-only: start a new spatial battle and advance it to the first
// decision point (or completion).
export async function POST(request: NextRequest) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const playerArmyId = parseInt(body.player_army_id, 10);
  const opponentArmyId = parseInt(body.opponent_army_id, 10);
  const missionKey = typeof body.mission_key === "string" ? body.mission_key : MISSIONS[0].key;
  const rounds = Number.isFinite(body.rounds) ? Math.max(1, Math.min(10, body.rounds)) : 5;
  const playerSide: "a" | "b" = body.player_side === "b" ? "b" : "a";

  if (!Number.isFinite(playerArmyId) || !Number.isFinite(opponentArmyId)) {
    return NextResponse.json({ error: "player_army_id and opponent_army_id are required" }, { status: 400 });
  }

  const db = getDb();
  const owned = db
    .prepare(`SELECT COUNT(*) AS n FROM armies WHERE id IN (?, ?) AND user_id = ?`)
    .get(playerArmyId, opponentArmyId, user.id) as { n: number };
  if (owned.n < (playerArmyId === opponentArmyId ? 1 : 2)) {
    return NextResponse.json({ error: "You can only play with armies you created" }, { status: 403 });
  }

  try {
    const { state: fresh, log: setupLog } = newSpatialBattle(db, {
      playerArmyId, opponentArmyId, missionKey, maxRounds: rounds, playerSide,
    });
    const { state, log, pending } = advanceSpatialBattle(fresh);
    const fullLog = [...setupLog, ...log];

    const now = Date.now();
    const info = db
      .prepare(
        `INSERT INTO sim_spatial_battles
           (user_id, player_army_id, opponent_army_id, mission_key, status, winner, state_json, log_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        user.id, playerArmyId, opponentArmyId, missionKey,
        state.winner ? "complete" : "in_progress", state.winner ?? null,
        JSON.stringify(state), JSON.stringify(fullLog), now, now
      );

    return NextResponse.json({ battleId: info.lastInsertRowid, state, log: fullLog, pending }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to start battle" }, { status: 500 });
  }
}
