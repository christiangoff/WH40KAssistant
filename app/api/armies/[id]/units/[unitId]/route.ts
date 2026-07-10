import { NextRequest, NextResponse } from "next/server";
import getDb from "@/lib/db";
import { getUserFromRequest } from "@/lib/auth";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; unitId: string }> }
) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { id, unitId } = await params;
    const db = getDb();

    const army = db.prepare("SELECT id FROM armies WHERE id = ? AND user_id = ?").get(id, user.id);
    if (!army) return NextResponse.json({ error: "Army not found" }, { status: 404 });

    const existing = db.prepare("SELECT id FROM army_units WHERE id = ? AND army_id = ?").get(unitId, id);
    if (!existing) return NextResponse.json({ error: "Army unit not found" }, { status: 404 });

    const { model_count, custom_points, squad_id, selected_weapons, label, detachment, selected_drones } = await request.json();

    db.prepare(`
      UPDATE army_units SET model_count = ?, custom_points = ?, squad_id = ?, selected_weapons = ?, label = ?, detachment = ?, selected_drones = ? WHERE id = ?
    `).run(model_count, custom_points ?? null, squad_id ?? null, selected_weapons ?? null, label ?? null, detachment ?? null, selected_drones ?? null, unitId);

    return NextResponse.json(db.prepare(`
      SELECT au.*, u.name, u.faction, u.stats_json, u.quantity as owned_models
      FROM army_units au JOIN units u ON u.id = au.unit_id WHERE au.id = ?
    `).get(unitId));
  } catch (error) {
    console.error("PUT /api/armies/[id]/units/[unitId] error:", error);
    return NextResponse.json({ error: "Failed to update army unit" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; unitId: string }> }
) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { id, unitId } = await params;
    const db = getDb();

    const army = db.prepare("SELECT id FROM armies WHERE id = ? AND user_id = ?").get(id, user.id);
    if (!army) return NextResponse.json({ error: "Army not found" }, { status: 404 });

    db.prepare("UPDATE match_units SET army_unit_id = NULL WHERE army_unit_id = ?").run(unitId);
    db.prepare("DELETE FROM army_units WHERE id = ? AND army_id = ?").run(unitId, id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DELETE /api/armies/[id]/units/[unitId] error:", error);
    return NextResponse.json({ error: "Failed to remove unit from army" }, { status: 500 });
  }
}
