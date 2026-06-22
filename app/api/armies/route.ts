import { NextRequest, NextResponse } from "next/server";
import getDb from "@/lib/db";
import { getUserFromRequest } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const db = getDb();
    const armies = db
      .prepare("SELECT * FROM armies WHERE user_id = ? ORDER BY created_at DESC")
      .all(user.id) as Array<{
        id: number; name: string; faction: string | null;
        point_limit: number; created_at: number;
      }>;

    const armiesWithStats = armies.map((army) => {
      const units = db.prepare(`
        SELECT au.model_count, au.custom_points, u.stats_json
        FROM army_units au JOIN units u ON u.id = au.unit_id
        WHERE au.army_id = ?
      `).all(army.id) as Array<{ model_count: number; custom_points: number | null; stats_json: string | null }>;

      const totalPoints = units.reduce((sum, u) => {
        if (u.custom_points !== null) return sum + u.custom_points;
        const stats = u.stats_json ? JSON.parse(u.stats_json) : null;
        return sum + ((stats?.points_per_model || 0) * u.model_count);
      }, 0);

      return { ...army, unit_count: units.length, total_points: totalPoints };
    });

    return NextResponse.json(armiesWithStats);
  } catch (error) {
    console.error("GET /api/armies error:", error);
    return NextResponse.json({ error: "Failed to fetch armies" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const db = getDb();
    const body = await request.json();
    const { name, point_limit = 2000, faction = null } = body;

    if (!name) return NextResponse.json({ error: "Name is required" }, { status: 400 });

    const result = db
      .prepare("INSERT INTO armies (name, point_limit, faction, user_id, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(name, point_limit, faction, user.id, Date.now());

    return NextResponse.json(db.prepare("SELECT * FROM armies WHERE id = ?").get(result.lastInsertRowid), { status: 201 });
  } catch (error) {
    console.error("POST /api/armies error:", error);
    return NextResponse.json({ error: "Failed to create army" }, { status: 500 });
  }
}
