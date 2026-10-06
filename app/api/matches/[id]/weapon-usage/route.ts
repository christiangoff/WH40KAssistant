import { NextRequest, NextResponse } from "next/server";
import getDb from "@/lib/db";
import { getUserFromRequest } from "@/lib/auth";

// Admin-and-owner only (same ownership check as the rest of /api/matches):
// set how many copies of a ONE SHOT weapon have been used so far this match,
// for one army unit. Upserts on (match_id, army_unit_id, weapon_name) —
// see lib/db.ts's match_weapon_usage table comment for why it's scoped at
// the squad level rather than to a specific match_units (model) row.
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { id } = await params;
    const db = getDb();

    const match = db.prepare(`
      SELECT m.id FROM matches m JOIN armies a ON a.id = m.army_id
      WHERE m.id = ? AND a.user_id = ?
    `).get(id, user.id);
    if (!match) return NextResponse.json({ error: "Match not found" }, { status: 404 });

    const body = await request.json();
    const armyUnitId = parseInt(body.army_unit_id, 10);
    const weaponName = typeof body.weapon_name === "string" ? body.weapon_name : "";
    const usedCount = Math.max(0, parseInt(body.used_count, 10) || 0);
    if (!Number.isFinite(armyUnitId) || !weaponName) {
      return NextResponse.json({ error: "army_unit_id and weapon_name are required" }, { status: 400 });
    }

    const owned = db.prepare(`
      SELECT au.id FROM army_units au JOIN matches m ON m.army_id = au.army_id
      WHERE au.id = ? AND m.id = ?
    `).get(armyUnitId, id);
    if (!owned) return NextResponse.json({ error: "Army unit not found on this match" }, { status: 404 });

    db.prepare(`
      INSERT INTO match_weapon_usage (match_id, army_unit_id, weapon_name, used_count)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(match_id, army_unit_id, weapon_name) DO UPDATE SET used_count = excluded.used_count
    `).run(id, armyUnitId, weaponName, usedCount);

    return NextResponse.json({ army_unit_id: armyUnitId, weapon_name: weaponName, used_count: usedCount });
  } catch (error) {
    console.error("PUT /api/matches/[id]/weapon-usage error:", error);
    return NextResponse.json({ error: "Failed to update weapon usage" }, { status: 500 });
  }
}
