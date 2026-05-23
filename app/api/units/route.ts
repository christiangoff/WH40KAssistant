import { NextRequest, NextResponse } from "next/server";
import getDb from "@/lib/db";

export async function GET() {
  try {
    const db = getDb();
    const units = db.prepare("SELECT * FROM units ORDER BY name ASC").all();
    return NextResponse.json(units);
  } catch (error) {
    console.error("GET /api/units error:", error);
    return NextResponse.json({ error: "Failed to fetch units" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const db = getDb();
    const body = await request.json();
    const { name, faction, wahapedia_url, quantity = 1, stats_json, notes } = body;

    if (!name) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    const stmt = db.prepare(`
      INSERT INTO units (name, faction, wahapedia_url, quantity, stats_json, stats_fetched_at, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      name,
      faction || null,
      wahapedia_url || null,
      quantity,
      stats_json ? JSON.stringify(stats_json) : null,
      stats_json ? Date.now() : null,
      notes || null
    );

    const unit = db.prepare("SELECT * FROM units WHERE id = ?").get(result.lastInsertRowid);
    return NextResponse.json(unit, { status: 201 });
  } catch (error) {
    console.error("POST /api/units error:", error);
    return NextResponse.json({ error: "Failed to create unit" }, { status: 500 });
  }
}
