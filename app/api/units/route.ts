import { NextRequest, NextResponse } from "next/server";
import getDb from "@/lib/db";
import { getUserFromRequest } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = getDb();
  const units = db
    .prepare("SELECT * FROM units WHERE user_id = ? ORDER BY faction ASC, name ASC")
    .all(user.id);
  return NextResponse.json(units);
}

export async function POST(request: NextRequest) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const db = getDb();
    const body = await request.json();
    const { name, faction, wahapedia_url, quantity = 1, stats_json } = body;

    if (!name) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    const result = db
      .prepare(
        "INSERT INTO units (name, faction, wahapedia_url, quantity, stats_json, user_id) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .run(name, faction ?? null, wahapedia_url ?? null, quantity, stats_json ?? null, user.id);

    const unit = db.prepare("SELECT * FROM units WHERE id = ?").get(result.lastInsertRowid);
    return NextResponse.json(unit, { status: 201 });
  } catch (error) {
    console.error("POST /api/units error:", error);
    return NextResponse.json({ error: "Failed to create unit" }, { status: 500 });
  }
}
