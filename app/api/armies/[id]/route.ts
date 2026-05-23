import { NextRequest, NextResponse } from "next/server";
import getDb from "@/lib/db";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = getDb();

    const army = db.prepare("SELECT * FROM armies WHERE id = ?").get(id);
    if (!army) {
      return NextResponse.json({ error: "Army not found" }, { status: 404 });
    }

    const units = db.prepare(`
      SELECT au.*, u.name, u.faction, u.stats_json, u.wahapedia_url, u.quantity as owned_models
      FROM army_units au
      JOIN units u ON u.id = au.unit_id
      WHERE au.army_id = ?
      ORDER BY au.id ASC
    `).all(id);

    const squads = db.prepare(`
      SELECT * FROM army_squads WHERE army_id = ? ORDER BY id ASC
    `).all(id);

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
  try {
    const { id } = await params;
    const db = getDb();
    const body = await request.json();
    const { name, point_limit } = body;

    const existing = db.prepare("SELECT * FROM armies WHERE id = ?").get(id);
    if (!existing) {
      return NextResponse.json({ error: "Army not found" }, { status: 404 });
    }

    db.prepare(`
      UPDATE armies SET name = ?, point_limit = ? WHERE id = ?
    `).run(name, point_limit, id);

    const army = db.prepare("SELECT * FROM armies WHERE id = ?").get(id);
    return NextResponse.json(army);
  } catch (error) {
    console.error("PUT /api/armies/[id] error:", error);
    return NextResponse.json({ error: "Failed to update army" }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = getDb();
    // matches has no CASCADE from armies, so delete them first (match_units cascade from matches)
    db.prepare("DELETE FROM matches WHERE army_id = ?").run(id);
    // army_units cascades from armies, but delete explicitly to be safe
    db.prepare("DELETE FROM army_units WHERE army_id = ?").run(id);
    db.prepare("DELETE FROM armies WHERE id = ?").run(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DELETE /api/armies/[id] error:", error);
    return NextResponse.json({ error: "Failed to delete army" }, { status: 500 });
  }
}
