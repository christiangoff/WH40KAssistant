import { NextRequest, NextResponse } from "next/server";
import getDb from "@/lib/db";
import { getUserFromRequest, generateInviteCode } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const db = getDb();
  const invites = db.prepare(`
    SELECT ic.*, uc.username as created_by_name, uu.username as used_by_name
    FROM invite_codes ic
    JOIN users uc ON uc.id = ic.created_by
    LEFT JOIN users uu ON uu.id = ic.used_by
    ORDER BY ic.created_at DESC
  `).all();

  return NextResponse.json(invites);
}

export async function POST(request: NextRequest) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const db = getDb();
  const code = generateInviteCode();
  const result = db
    .prepare("INSERT INTO invite_codes (code, created_by, created_at) VALUES (?, ?, ?)")
    .run(code, user.id, Date.now());

  const invite = db.prepare("SELECT * FROM invite_codes WHERE id = ?").get(result.lastInsertRowid);
  return NextResponse.json(invite, { status: 201 });
}

export async function DELETE(request: NextRequest) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { code } = await request.json();
  getDb().prepare("DELETE FROM invite_codes WHERE code = ? AND used_by IS NULL").run(code);
  return NextResponse.json({ success: true });
}
