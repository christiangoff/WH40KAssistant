import { NextRequest, NextResponse } from "next/server";
import getDb from "@/lib/db";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; unitId: string }> }
) {
  try {
    const { id, unitId } = await params;
    const db = getDb();
    const body = await request.json();
    const { model_count, custom_points, squad_id, selected_weapons, label } = body;

    const existing = db.prepare(
      "SELECT * FROM army_units WHERE id = ? AND army_id = ?"
    ).get(unitId, id);

    if (!existing) {
      return NextResponse.json({ error: "Army unit not found" }, { status: 404 });
    }

    db.prepare(`
      UPDATE army_units SET model_count = ?, custom_points = ?, squad_id = ?, selected_weapons = ?, label = ? WHERE id = ?
    `).run(model_count, custom_points ?? null, squad_id ?? null, selected_weapons ?? null, label ?? null, unitId);

    const armyUnit = db.prepare(`
      SELECT au.*, u.name, u.faction, u.stats_json, u.quantity as owned_models
      FROM army_units au
      JOIN units u ON u.id = au.unit_id
      WHERE au.id = ?
    `).get(unitId);

    return NextResponse.json(armyUnit);
  } catch (error) {
    console.error("PUT /api/armies/[id]/units/[unitId] error:", error);
    return NextResponse.json({ error: "Failed to update army unit" }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; unitId: string }> }
) {
  try {
    const { id, unitId } = await params;
    const db = getDb();

    // Null out the back-reference in any match snapshots before deleting
    // (match_units already have unit_name/wounds snapshotted, so nothing is lost)
    db.prepare("UPDATE match_units SET army_unit_id = NULL WHERE army_unit_id = ?").run(unitId);
    db.prepare("DELETE FROM army_units WHERE id = ? AND army_id = ?").run(unitId, id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DELETE /api/armies/[id]/units/[unitId] error:", error);
    return NextResponse.json({ error: "Failed to remove unit from army" }, { status: 500 });
  }
}
