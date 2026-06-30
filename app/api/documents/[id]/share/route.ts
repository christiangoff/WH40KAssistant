import { NextRequest, NextResponse } from "next/server";
import getDb from "@/lib/db";
import { getUserFromRequest } from "@/lib/auth";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = getUserFromRequest(request);
  if (!user || user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const shares = getDb().prepare(`
    SELECT ds.*, u.username AS shared_with_username
    FROM document_shares ds
    LEFT JOIN users u ON u.id = ds.shared_with
    WHERE ds.document_id = ?
    ORDER BY ds.shared_at DESC
  `).all(id);

  return NextResponse.json(shares);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = getUserFromRequest(request);
  if (!user || user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const { shared_with } = await request.json(); // null = everyone, number = specific user id
  const db = getDb();

  if (!db.prepare("SELECT 1 FROM documents WHERE id = ?").get(id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Prevent duplicate shares
  const existing = shared_with == null
    ? db.prepare("SELECT 1 FROM document_shares WHERE document_id = ? AND shared_with IS NULL").get(id)
    : db.prepare("SELECT 1 FROM document_shares WHERE document_id = ? AND shared_with = ?").get(id, shared_with);
  if (existing) return NextResponse.json({ error: "Already shared" }, { status: 409 });

  const result = db.prepare(
    "INSERT INTO document_shares (document_id, shared_with, shared_by, shared_at) VALUES (?, ?, ?, ?)"
  ).run(id, shared_with ?? null, user.id, Date.now());

  return NextResponse.json(
    db.prepare("SELECT * FROM document_shares WHERE id = ?").get(result.lastInsertRowid),
    { status: 201 }
  );
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = getUserFromRequest(request);
  if (!user || user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const { share_id } = await request.json();
  getDb().prepare("DELETE FROM document_shares WHERE id = ? AND document_id = ?").run(share_id, id);
  return NextResponse.json({ success: true });
}
