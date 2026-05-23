import { NextRequest, NextResponse } from "next/server";
import getDb from "@/lib/db";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = getDb();
    const unit = db.prepare("SELECT * FROM units WHERE id = ?").get(id);
    if (!unit) {
      return NextResponse.json({ error: "Unit not found" }, { status: 404 });
    }
    return NextResponse.json(unit);
  } catch (error) {
    console.error("GET /api/units/[id] error:", error);
    return NextResponse.json({ error: "Failed to fetch unit" }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = getDb();
    const body = await request.json();
    const { name, faction, wahapedia_url, quantity, notes } = body;

    const existing = db.prepare("SELECT * FROM units WHERE id = ?").get(id);
    if (!existing) {
      return NextResponse.json({ error: "Unit not found" }, { status: 404 });
    }

    db.prepare(`
      UPDATE units
      SET name = ?, faction = ?, wahapedia_url = ?, quantity = ?, notes = ?
      WHERE id = ?
    `).run(name, faction, wahapedia_url, quantity, notes, id);

    const unit = db.prepare("SELECT * FROM units WHERE id = ?").get(id);
    return NextResponse.json(unit);
  } catch (error) {
    console.error("PUT /api/units/[id] error:", error);
    return NextResponse.json({ error: "Failed to update unit" }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = getDb();
    db.prepare("DELETE FROM units WHERE id = ?").run(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DELETE /api/units/[id] error:", error);
    return NextResponse.json({ error: "Failed to delete unit" }, { status: 500 });
  }
}
