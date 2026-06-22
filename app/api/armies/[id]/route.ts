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

    const army = db.prepare("SELECT * FROM armies WHERE id = ? AND user_id = ?").get(id, user.id);
    if (!army) return NextResponse.json({ error: "Army not found" }, { status: 404 });

    const units = db.prepare(`
      SELECT au.*, u.name, u.faction, u.stats_json, u.wahapedia_url, u.quantity as owned_models
      FROM army_units au JOIN units u ON u.id = au.unit_id
      WHERE au.army_id = ? ORDER BY au.id ASC
    `).all(id);

    const squads = db.prepare("SELECT * FROM army_squads WHERE army_id = ? ORDER BY id ASC").all(id);
    return NextResponse.json({ ...army, units, squads });
  } catch (error) {
    console.error("GET /api/armies/[id] error:", error);
    return NextResponse.json({ error: "Failed to fetch army" }, { status: 500 });
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
    const { name, point_limit, faction = null } = body;

    const existing = db.prepare("SELECT id FROM armies WHERE id = ? AND user_id = ?").get(id, user.id);
    if (!existing) return NextResponse.json({ error: "Army not found" }, { status: 404 });

    db.prepare("UPDATE armies SET name = ?, point_limit = ?, faction = ? WHERE id = ?")
      .run(name, point_limit, faction, id);

    return NextResponse.json(db.prepare("SELECT * FROM armies WHERE id = ?").get(id));
  } catch (error) {
    console.error("PUT /api/armies/[id] error:", error);
    return NextResponse.json({ error: "Failed to update army" }, { status: 500 });
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
    const existing = db.prepare("SELECT id FROM armies WHERE id = ? AND user_id = ?").get(id, user.id);
    if (!existing) return NextResponse.json({ error: "Army not found" }, { status: 404 });

    db.prepare("DELETE FROM matches WHERE army_id = ?").run(id);
    db.prepare("DELETE FROM army_units WHERE army_id = ?").run(id);
    db.prepare("DELETE FROM armies WHERE id = ?").run(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DELETE /api/armies/[id] error:", error);
    return NextResponse.json({ error: "Failed to delete army" }, { status: 500 });
  }
}
