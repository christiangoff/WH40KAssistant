import { NextRequest, NextResponse } from "next/server";
import getDb from "@/lib/db";
import { getUserFromRequest } from "@/lib/auth";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { id } = await params;
    const db = getDb();

    const army = db.prepare("SELECT id FROM armies WHERE id = ? AND user_id = ?").get(id, user.id);
    if (!army) return NextResponse.json({ error: "Army not found" }, { status: 404 });

    const body = await request.json();
    const { unit_id, model_count = 1, custom_points, squad_id, selected_weapons, label } = body;

    if (!unit_id) return NextResponse.json({ error: "unit_id is required" }, { status: 400 });

    const unit = db.prepare("SELECT id FROM units WHERE id = ? AND user_id = ?").get(unit_id, user.id);
    if (!unit) return NextResponse.json({ error: "Unit not found" }, { status: 404 });

    const result = db.prepare(`
      INSERT INTO army_units (army_id, unit_id, model_count, custom_points, squad_id, selected_weapons, label)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, unit_id, model_count, custom_points ?? null, squad_id ?? null, selected_weapons ?? null, label ?? null);

    const armyUnit = db.prepare(`
      SELECT au.*, u.name, u.faction, u.stats_json, u.quantity as owned_models
      FROM army_units au JOIN units u ON u.id = au.unit_id WHERE au.id = ?
    `).get(result.lastInsertRowid);

    return NextResponse.json(armyUnit, { status: 201 });
  } catch (error) {
    console.error("POST /api/armies/[id]/units error:", error);
    return NextResponse.json({ error: "Failed to add unit to army" }, { status: 500 });
  }
}
