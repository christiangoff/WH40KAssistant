import { NextRequest, NextResponse } from "next/server";
import getDb from "@/lib/db";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; squadId: string }> }
) {
  try {
    const { id, squadId } = await params;
    const db = getDb();
    const { name } = await request.json();
    if (!name?.trim()) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }
    db.prepare("UPDATE army_squads SET name = ? WHERE id = ? AND army_id = ?").run(name.trim(), squadId, id);
    const squad = db.prepare("SELECT * FROM army_squads WHERE id = ?").get(squadId);
    return NextResponse.json(squad);
  } catch (error) {
    console.error("PUT /api/armies/[id]/squads/[squadId] error:", error);
    return NextResponse.json({ error: "Failed to update squad" }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; squadId: string }> }
) {
  try {
    const { id, squadId } = await params;
    const db = getDb();
    // Unassign units from this squad before deleting
    db.prepare("UPDATE army_units SET squad_id = NULL WHERE squad_id = ?").run(squadId);
    db.prepare("DELETE FROM army_squads WHERE id = ? AND army_id = ?").run(squadId, id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DELETE /api/armies/[id]/squads/[squadId] error:", error);
    return NextResponse.json({ error: "Failed to delete squad" }, { status: 500 });
  }
}
