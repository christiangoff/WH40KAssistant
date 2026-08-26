import { NextRequest, NextResponse } from "next/server";
import getDb from "@/lib/db";
import { getUserFromRequest } from "@/lib/auth";
import { computeArmyTotals } from "@/lib/armies";

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

    const armiesWithStats = armies.map((army) => ({ ...army, ...computeArmyTotals(db, army.id) }));

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
    const { name, point_limit = 2000, faction = null, faction_id = null } = body;

    if (!name) return NextResponse.json({ error: "Name is required" }, { status: 400 });

    const result = db
      .prepare("INSERT INTO armies (name, point_limit, faction, faction_id, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(name, point_limit, faction, faction_id, user.id, Date.now());

    return NextResponse.json(db.prepare("SELECT * FROM armies WHERE id = ?").get(result.lastInsertRowid), { status: 201 });
  } catch (error) {
    console.error("POST /api/armies error:", error);
    return NextResponse.json({ error: "Failed to create army" }, { status: 500 });
  }
}
