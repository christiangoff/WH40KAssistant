import { NextRequest, NextResponse } from "next/server";
import getDb from "@/lib/db";
import { getUserFromRequest } from "@/lib/auth";
import { activeRuleHookLabels, type SpatialBattleState } from "@/lib/battleSimSpatial";

// Admin-only: fetch one spatial battle's current state + full log.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const db = getDb();
  const row = db
    .prepare(
      `SELECT sb.*, pa.name AS player_army_name, oa.name AS opponent_army_name
       FROM sim_spatial_battles sb
       JOIN armies pa ON pa.id = sb.player_army_id
       JOIN armies oa ON oa.id = sb.opponent_army_id
       WHERE sb.id = ? AND sb.user_id = ?`
    )
    .get(id, user.id) as
    | { state_json: string; log_json: string; [k: string]: unknown }
    | undefined;
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { state_json, log_json, ...rest } = row;
  const state: SpatialBattleState = JSON.parse(state_json);
  const activeRuleHooks = { a: activeRuleHookLabels(state, "a"), b: activeRuleHookLabels(state, "b") };
  return NextResponse.json({ ...rest, state, log: JSON.parse(log_json), activeRuleHooks });
}

// Admin-only: abandon/delete an in-progress spatial battle.
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const db = getDb();
  const info = db.prepare(`DELETE FROM sim_spatial_battles WHERE id = ? AND user_id = ?`).run(id, user.id);
  if (info.changes === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
