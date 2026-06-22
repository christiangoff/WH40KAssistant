import { NextRequest, NextResponse } from "next/server";
import getDb from "@/lib/db";
import { getUserFromRequest } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const db = getDb();
    const matches = db.prepare(`
      SELECT m.*, a.name as army_name
      FROM matches m
      LEFT JOIN armies a ON a.id = m.army_id
      WHERE a.user_id = ?
      ORDER BY m.started_at DESC
    `).all(user.id);
    return NextResponse.json(matches);
  } catch (error) {
    console.error("GET /api/matches error:", error);
    return NextResponse.json({ error: "Failed to fetch matches" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const db = getDb();
    const body = await request.json();
    const { army_id, opponent, cp_start = 0 } = body;

    if (!army_id) return NextResponse.json({ error: "army_id is required" }, { status: 400 });

    const army = db
      .prepare("SELECT * FROM armies WHERE id = ? AND user_id = ?")
      .get(army_id, user.id) as { id: number; name: string } | undefined;
    if (!army) return NextResponse.json({ error: "Army not found" }, { status: 404 });

    const matchResult = db.prepare(`
      INSERT INTO matches (army_id, opponent, started_at, cp_start, cp_current)
      VALUES (?, ?, ?, ?, ?)
    `).run(army_id, opponent || null, Date.now(), cp_start, cp_start);

    const matchId = matchResult.lastInsertRowid;

    const armyUnits = db.prepare(`
      SELECT au.*, u.name, u.stats_json
      FROM army_units au JOIN units u ON u.id = au.unit_id
      WHERE au.army_id = ?
    `).all(army_id) as Array<{
      id: number; unit_id: number; name: string;
      label: string | null; stats_json: string | null; model_count: number;
    }>;

    const totalByUnitId = new Map<number, number>();
    for (const au of armyUnits) {
      totalByUnitId.set(au.unit_id, (totalByUnitId.get(au.unit_id) ?? 0) + au.model_count);
    }

    const insertMatchUnit = db.prepare(
      "INSERT INTO match_units (match_id, army_unit_id, unit_name, max_wounds, current_wounds) VALUES (?, ?, ?, ?, ?)"
    );
    const counters = new Map<number, number>();

    for (const au of armyUnits) {
      const stats = au.stats_json ? JSON.parse(au.stats_json) : null;
      const woundsPerModel = parseInt(stats?.W || "1") || 1;
      const totalForType = totalByUnitId.get(au.unit_id) ?? 1;
      const base = counters.get(au.unit_id) ?? 0;

      for (let i = 0; i < au.model_count; i++) {
        const unitName = totalForType > 1 ? `${au.name} ${base + i + 1}` : au.name;
        insertMatchUnit.run(matchId, au.id, unitName, woundsPerModel, woundsPerModel);
      }
      counters.set(au.unit_id, base + au.model_count);
    }

    return NextResponse.json(db.prepare("SELECT * FROM matches WHERE id = ?").get(matchId), { status: 201 });
  } catch (error) {
    console.error("POST /api/matches error:", error);
    return NextResponse.json({ error: "Failed to create match" }, { status: 500 });
  }
}
