import { NextRequest, NextResponse } from "next/server";
import getDb from "@/lib/db";
import { getUserFromRequest } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const db = getDb();
    const factions = db
      .prepare(
        `SELECT f.*, COUNT(d.id) as detachment_count
         FROM factions f LEFT JOIN detachments d ON d.faction_id = f.id
         GROUP BY f.id ORDER BY f.name ASC`
      )
      .all();
    return NextResponse.json(factions);
  } catch (error) {
    console.error("GET /api/factions error:", error);
    return NextResponse.json({ error: "Failed to fetch factions" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const db = getDb();
    const { name, wahapedia_url } = await request.json();
    if (!name || !wahapedia_url) {
      return NextResponse.json({ error: "name and wahapedia_url are required" }, { status: 400 });
    }

    const result = db
      .prepare("INSERT INTO factions (name, wahapedia_url) VALUES (?, ?)")
      .run(name, wahapedia_url);

    return NextResponse.json(db.prepare("SELECT * FROM factions WHERE id = ?").get(result.lastInsertRowid), { status: 201 });
  } catch (error) {
    console.error("POST /api/factions error:", error);
    return NextResponse.json({ error: "Failed to create faction (name may already exist)" }, { status: 500 });
  }
}
