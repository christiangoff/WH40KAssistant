import { NextRequest, NextResponse } from "next/server";
import getDb from "@/lib/db";
import { getUserFromRequest } from "@/lib/auth";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; squadId: string }> }
) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { id, squadId } = await params;
    const db = getDb();
    const army = db.prepare("SELECT id FROM armies WHERE id = ? AND user_id = ?").get(id, user.id);
    if (!army) return NextResponse.json({ error: "Army not found" }, { status: 404 });

    const { name } = await request.json();
    if (!name?.trim()) return NextResponse.json({ error: "Name is required" }, { status: 400 });

    db.prepare("UPDATE army_squads SET name = ? WHERE id = ? AND army_id = ?").run(name.trim(), squadId, id);
    return NextResponse.json(db.prepare("SELECT * FROM army_squads WHERE id = ?").get(squadId));
  } catch (error) {
    console.error("PUT /api/armies/[id]/squads/[squadId] error:", error);
    return NextResponse.json({ error: "Failed to update squad" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; squadId: string }> }
) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { id, squadId } = await params;
    const db = getDb();
    const army = db.prepare("SELECT id FROM armies WHERE id = ? AND user_id = ?").get(id, user.id);
    if (!army) return NextResponse.json({ error: "Army not found" }, { status: 404 });

    db.prepare("UPDATE army_units SET squad_id = NULL WHERE squad_id = ?").run(squadId);
    db.prepare("DELETE FROM army_squads WHERE id = ? AND army_id = ?").run(squadId, id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DELETE /api/armies/[id]/squads/[squadId] error:", error);
    return NextResponse.json({ error: "Failed to delete squad" }, { status: 500 });
  }
}
