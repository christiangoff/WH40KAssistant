import { NextRequest, NextResponse } from "next/server";
import getDb from "@/lib/db";
import { getUserFromRequest } from "@/lib/auth";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { id } = await params;
    const db = getDb();

    const match = db.prepare(`
      SELECT m.*, a.name as army_name, a.point_limit
      FROM matches m LEFT JOIN armies a ON a.id = m.army_id
      WHERE m.id = ? AND a.user_id = ?
    `).get(id, user.id);
    if (!match) return NextResponse.json({ error: "Match not found" }, { status: 404 });

    const matchUnits = db.prepare(`
      SELECT mu.*, u.stats_json, u.faction, au.squad_id, aq.name AS squad_name, au.selected_weapons, au.selected_drones, au.model_count, au.detachment
      FROM match_units mu
      LEFT JOIN army_units au ON au.id = mu.army_unit_id
      LEFT JOIN units u ON u.id = au.unit_id
      LEFT JOIN army_squads aq ON aq.id = au.squad_id
      WHERE mu.match_id = ?
      ORDER BY CASE WHEN aq.id IS NULL THEN 1 ELSE 0 END, aq.id ASC, mu.id ASC
    `).all(id);

    return NextResponse.json({ ...match, units: matchUnits });
  } catch (error) {
    console.error("GET /api/matches/[id] error:", error);
    return NextResponse.json({ error: "Failed to fetch match" }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { id } = await params;
    const db = getDb();

    const existing = db.prepare(`
      SELECT m.id FROM matches m JOIN armies a ON a.id = m.army_id
      WHERE m.id = ? AND a.user_id = ?
    `).get(id, user.id);
    if (!existing) return NextResponse.json({ error: "Match not found" }, { status: 404 });

    const body = await request.json();
    const { cp_current, opponent, notes, ended_at, vp, vp_opponent, round, phase, active_player } = body;

    const updates: string[] = [];
    const values: unknown[] = [];

    if (cp_current !== undefined)    { updates.push("cp_current = ?");    values.push(cp_current); }
    if (opponent !== undefined)      { updates.push("opponent = ?");      values.push(opponent); }
    if (notes !== undefined)         { updates.push("notes = ?");         values.push(notes); }
    if (ended_at !== undefined)      { updates.push("ended_at = ?");      values.push(ended_at); }
    if (vp !== undefined)            { updates.push("vp = ?");            values.push(vp); }
    if (vp_opponent !== undefined)   { updates.push("vp_opponent = ?");   values.push(vp_opponent); }
    if (round !== undefined)         { updates.push("round = ?");         values.push(round); }
    if (phase !== undefined)         { updates.push("phase = ?");         values.push(phase); }
    if (active_player !== undefined) { updates.push("active_player = ?"); values.push(active_player); }

    if (updates.length > 0) {
      values.push(id);
      db.prepare(`UPDATE matches SET ${updates.join(", ")} WHERE id = ?`).run(...values);
    }

    return NextResponse.json(db.prepare("SELECT * FROM matches WHERE id = ?").get(id));
  } catch (error) {
    console.error("PUT /api/matches/[id] error:", error);
    return NextResponse.json({ error: "Failed to update match" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { id } = await params;
    const db = getDb();

    const existing = db.prepare(`
      SELECT m.id FROM matches m JOIN armies a ON a.id = m.army_id
      WHERE m.id = ? AND a.user_id = ?
    `).get(id, user.id);
    if (!existing) return NextResponse.json({ error: "Match not found" }, { status: 404 });

    db.prepare("DELETE FROM matches WHERE id = ?").run(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DELETE /api/matches/[id] error:", error);
    return NextResponse.json({ error: "Failed to delete match" }, { status: 500 });
  }
}
