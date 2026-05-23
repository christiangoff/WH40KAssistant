import { NextRequest, NextResponse } from "next/server";
import getDb from "@/lib/db";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = getDb();
    const squads = db.prepare("SELECT * FROM army_squads WHERE army_id = ? ORDER BY id ASC").all(id);
    return NextResponse.json(squads);
  } catch (error) {
    console.error("GET /api/armies/[id]/squads error:", error);
    return NextResponse.json({ error: "Failed to fetch squads" }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = getDb();
    const body = await request.json();
    const { name } = body;
    if (!name?.trim()) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }
    const result = db.prepare(
      "INSERT INTO army_squads (army_id, name) VALUES (?, ?)"
    ).run(id, name.trim());
    const squad = db.prepare("SELECT * FROM army_squads WHERE id = ?").get(result.lastInsertRowid);
    return NextResponse.json(squad, { status: 201 });
  } catch (error) {
    console.error("POST /api/armies/[id]/squads error:", error);
    return NextResponse.json({ error: "Failed to create squad" }, { status: 500 });
  }
}
