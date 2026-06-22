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
    const army = db.prepare("SELECT id FROM armies WHERE id = ? AND user_id = ?").get(id, user.id);
    if (!army) return NextResponse.json({ error: "Army not found" }, { status: 404 });
    return NextResponse.json(db.prepare("SELECT * FROM army_squads WHERE army_id = ? ORDER BY id ASC").all(id));
  } catch (error) {
    console.error("GET /api/armies/[id]/squads error:", error);
    return NextResponse.json({ error: "Failed to fetch squads" }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { id } = await params;
    const db = getDb();
    const army = db.prepare("SELECT id FROM armies WHERE id = ? AND user_id = ?").get(id, user.id);
    if (!army) return NextResponse.json({ error: "Army not found" }, { status: 404 });

    const { name } = await request.json();
    if (!name?.trim()) return NextResponse.json({ error: "Name is required" }, { status: 400 });

    const result = db.prepare("INSERT INTO army_squads (army_id, name) VALUES (?, ?)").run(id, name.trim());
    return NextResponse.json(db.prepare("SELECT * FROM army_squads WHERE id = ?").get(result.lastInsertRowid), { status: 201 });
  } catch (error) {
    console.error("POST /api/armies/[id]/squads error:", error);
    return NextResponse.json({ error: "Failed to create squad" }, { status: 500 });
  }
}
