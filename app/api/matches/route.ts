import { NextRequest, NextResponse } from "next/server";
import getDb from "@/lib/db";

export async function GET() {
  try {
    const db = getDb();
    const matches = db.prepare(`
      SELECT m.*, a.name as army_name
      FROM matches m
      LEFT JOIN armies a ON a.id = m.army_id
      ORDER BY m.started_at DESC
    `).all();
    return NextResponse.json(matches);
  } catch (error) {
    console.error("GET /api/matches error:", error);
    return NextResponse.json({ error: "Failed to fetch matches" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const db = getDb();
    const body = await request.json();
    const { army_id, opponent, cp_start = 0 } = body;

    if (!army_id) {
      return NextResponse.json({ error: "army_id is required" }, { status: 400 });
    }

    const army = db.prepare("SELECT * FROM armies WHERE id = ?").get(army_id) as {
      id: number;
      name: string;
    } | undefined;
    if (!army) {
      return NextResponse.json({ error: "Army not found" }, { status: 404 });
    }

    // Create match
    const matchResult = db.prepare(`
      INSERT INTO matches (army_id, opponent, started_at, cp_start, cp_current)
      VALUES (?, ?, ?, ?, ?)
    `).run(army_id, opponent || null, Date.now(), cp_start, cp_start);

    const matchId = matchResult.lastInsertRowid;

    // Copy army units into match_units — one card per physical model
    const armyUnits = db.prepare(`
      SELECT au.*, u.name, u.stats_json
      FROM army_units au
      JOIN units u ON u.id = au.unit_id
      WHERE au.army_id = ?
    `).all(army_id) as Array<{
      id: number;
      unit_id: number;
      name: string;
      label: string | null;
      stats_json: string | null;
      model_count: number;
    }>;

    // Pre-count total models per unit type so we know when to add numbers
    const totalByUnitId = new Map<number, number>();
    for (const au of armyUnits) {
      totalByUnitId.set(au.unit_id, (totalByUnitId.get(au.unit_id) ?? 0) + au.model_count);
    }

    const insertMatchUnit = db.prepare(`
      INSERT INTO match_units (match_id, army_unit_id, unit_name, max_wounds, current_wounds)
      VALUES (?, ?, ?, ?, ?)
    `);

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

    const match = db.prepare("SELECT * FROM matches WHERE id = ?").get(matchId);
    return NextResponse.json(match, { status: 201 });
  } catch (error) {
    console.error("POST /api/matches error:", error);
    return NextResponse.json({ error: "Failed to create match" }, { status: 500 });
  }
}
