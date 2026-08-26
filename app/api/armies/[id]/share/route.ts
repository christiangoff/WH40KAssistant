import { NextRequest, NextResponse } from "next/server";
import getDb from "@/lib/db";
import { getUserFromRequest } from "@/lib/auth";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const db = getDb();
  const army = db.prepare("SELECT id FROM armies WHERE id = ? AND user_id = ?").get(id, user.id);
  if (!army) return NextResponse.json({ error: "Army not found" }, { status: 404 });

  const shares = db.prepare(`
    SELECT s.*, u.username AS shared_with_username
    FROM army_shares s
    JOIN users u ON u.id = s.shared_with
    WHERE s.army_id = ?
    ORDER BY s.shared_at DESC
  `).all(id);

  return NextResponse.json(shares);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const { shared_with } = await request.json();
  const db = getDb();

  const army = db.prepare("SELECT id FROM armies WHERE id = ? AND user_id = ?").get(id, user.id);
  if (!army) return NextResponse.json({ error: "Army not found" }, { status: 404 });

  if (!shared_with || !db.prepare("SELECT 1 FROM users WHERE id = ? AND archived = 0").get(shared_with)) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const existing = db.prepare("SELECT 1 FROM army_shares WHERE army_id = ? AND shared_with = ?").get(id, shared_with);
  if (existing) return NextResponse.json({ error: "Already shared" }, { status: 409 });

  const result = db.prepare(
    "INSERT INTO army_shares (army_id, shared_with, shared_by, shared_at) VALUES (?, ?, ?, ?)"
  ).run(id, shared_with, user.id, Date.now());

  return NextResponse.json(
    db.prepare(`
      SELECT s.*, u.username AS shared_with_username
      FROM army_shares s JOIN users u ON u.id = s.shared_with
      WHERE s.id = ?
    `).get(result.lastInsertRowid),
    { status: 201 }
  );
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const { share_id } = await request.json();
  const db = getDb();

  const army = db.prepare("SELECT id FROM armies WHERE id = ? AND user_id = ?").get(id, user.id);
  if (!army) return NextResponse.json({ error: "Army not found" }, { status: 404 });

  db.prepare("DELETE FROM army_shares WHERE id = ? AND army_id = ?").run(share_id, id);
  return NextResponse.json({ success: true });
}
