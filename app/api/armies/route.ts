import { NextRequest, NextResponse } from "next/server";
import getDb from "@/lib/db";

interface ArmyRow {
  id: number;
  name: string;
  point_limit: number;
  created_at: number;
}

export async function GET() {
  try {
    const db = getDb();
    const armies = db.prepare("SELECT * FROM armies ORDER BY created_at DESC").all() as ArmyRow[];

    // Add unit count and total points for each army
    const armiesWithStats = armies.map((army: ArmyRow) => {
      const units = db.prepare(`
        SELECT au.*, u.name, u.stats_json
        FROM army_units au
        JOIN units u ON u.id = au.unit_id
        WHERE au.army_id = ?
      `).all(army.id) as Array<{
        model_count: number;
        custom_points: number | null;
        stats_json: string | null;
      }>;

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
  try {
    const db = getDb();
    const body = await request.json();
    const { name, point_limit = 2000 } = body;

    if (!name) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    const result = db.prepare(`
      INSERT INTO armies (name, point_limit, created_at) VALUES (?, ?, ?)
    `).run(name, point_limit, Date.now());

    const army = db.prepare("SELECT * FROM armies WHERE id = ?").get(result.lastInsertRowid);
    return NextResponse.json(army, { status: 201 });
  } catch (error) {
    console.error("POST /api/armies error:", error);
    return NextResponse.json({ error: "Failed to create army" }, { status: 500 });
  }
}
