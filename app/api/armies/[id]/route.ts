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

    const army = db.prepare(`
      SELECT a.*, u.username AS owner_username
      FROM armies a
      JOIN users u ON u.id = a.user_id
      WHERE a.id = ? AND (
        a.user_id = ?
        OR EXISTS (SELECT 1 FROM army_shares s WHERE s.army_id = a.id AND s.shared_with = ?)
      )
    `).get(id, user.id, user.id) as { user_id: number } | undefined;
    if (!army) return NextResponse.json({ error: "Army not found" }, { status: 404 });

    const units = db.prepare(`
      SELECT au.*, u.name, u.faction, u.stats_json, u.wahapedia_url, u.quantity as owned_models,
             e.name AS enhancement_name, e.points AS enhancement_points, e.description AS enhancement_description
      FROM army_units au JOIN units u ON u.id = au.unit_id
      LEFT JOIN enhancements e ON e.id = au.enhancement_id
      WHERE au.army_id = ? ORDER BY au.id ASC
    `).all(id);

    const squads = db.prepare("SELECT * FROM army_squads WHERE army_id = ? ORDER BY id ASC").all(id);

    const detachments = db.prepare(`
      SELECT d.* FROM army_detachments ad JOIN detachments d ON d.id = ad.detachment_id
      WHERE ad.army_id = ? ORDER BY d.name ASC
    `).all(id);

    return NextResponse.json({ ...army, is_owner: army.user_id === user.id, units, squads, detachments });
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
    const { name, point_limit, faction = null, faction_id = null } = body;

    const existing = db.prepare("SELECT * FROM armies WHERE id = ? AND user_id = ?").get(id, user.id) as
      | { name: string; point_limit: number }
      | undefined;
    if (!existing) return NextResponse.json({ error: "Army not found" }, { status: 404 });

    // name/point_limit have no request-side default like faction/faction_id do — a request
    // missing either (or sending a non-finite point_limit) falls back to the current value
    // instead of passing `undefined`/`NaN` to better-sqlite3, which throws on `undefined`
    // binds and would otherwise silently null out point_limit.
    const safeName = typeof name === "string" && name.trim() ? name.trim() : existing.name;
    const safePointLimit = Number.isFinite(point_limit) ? point_limit : existing.point_limit;

    db.prepare("UPDATE armies SET name = ?, point_limit = ?, faction = ?, faction_id = ? WHERE id = ?")
      .run(safeName, safePointLimit, faction, faction_id, id);

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
