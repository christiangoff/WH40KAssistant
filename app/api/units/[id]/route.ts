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
    const unit = getDb()
      .prepare("SELECT * FROM units WHERE id = ? AND user_id = ?")
      .get(id, user.id);
    if (!unit) return NextResponse.json({ error: "Unit not found" }, { status: 404 });
    return NextResponse.json(unit);
  } catch (error) {
    console.error("GET /api/units/[id] error:", error);
    return NextResponse.json({ error: "Failed to fetch unit" }, { status: 500 });
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
    const body = await request.json();
    const { name, faction, wahapedia_url, quantity, notes, detachment = null } = body;

    const existing = db.prepare("SELECT id FROM units WHERE id = ? AND user_id = ?").get(id, user.id);
    if (!existing) return NextResponse.json({ error: "Unit not found" }, { status: 404 });

    db.prepare(
      "UPDATE units SET name = ?, faction = ?, wahapedia_url = ?, quantity = ?, notes = ?, detachment = ? WHERE id = ?"
    ).run(name, faction, wahapedia_url, quantity, notes, detachment, id);

    return NextResponse.json(db.prepare("SELECT * FROM units WHERE id = ?").get(id));
  } catch (error) {
    console.error("PUT /api/units/[id] error:", error);
    return NextResponse.json({ error: "Failed to update unit" }, { status: 500 });
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
    const existing = db.prepare("SELECT id FROM units WHERE id = ? AND user_id = ?").get(id, user.id);
    if (!existing) return NextResponse.json({ error: "Unit not found" }, { status: 404 });

    // units.id is referenced by army_units.unit_id with no ON DELETE clause (NO ACTION),
    // so deleting a unit that's in any army would otherwise fail with an opaque foreign
    // key error. Check first and give a clear, actionable message instead.
    const usedIn = db.prepare(`
      SELECT DISTINCT a.name FROM army_units au JOIN armies a ON a.id = au.army_id WHERE au.unit_id = ?
    `).all(id) as { name: string }[];
    if (usedIn.length > 0) {
      return NextResponse.json(
        { error: `Can't delete — this unit is used in ${usedIn.length === 1 ? "army" : "armies"} "${usedIn.map(a => a.name).join('", "')}". Remove it from there first.` },
        { status: 409 }
      );
    }

    db.prepare("DELETE FROM units WHERE id = ?").run(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DELETE /api/units/[id] error:", error);
    return NextResponse.json({ error: "Failed to delete unit" }, { status: 500 });
  }
}
