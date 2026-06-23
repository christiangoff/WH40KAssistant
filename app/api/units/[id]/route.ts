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

    db.prepare("DELETE FROM units WHERE id = ?").run(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DELETE /api/units/[id] error:", error);
    return NextResponse.json({ error: "Failed to delete unit" }, { status: 500 });
  }
}
