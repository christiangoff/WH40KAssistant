import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import getDb from "@/lib/db";
import { getUserFromRequest } from "@/lib/auth";

// Enable a no-login public share link for an army the caller owns.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const db = getDb();
  const army = db.prepare("SELECT id FROM armies WHERE id = ? AND user_id = ?").get(id, user.id);
  if (!army) return NextResponse.json({ error: "Army not found" }, { status: 404 });

  const token = crypto.randomBytes(16).toString("hex");
  db.prepare("UPDATE armies SET public_token = ? WHERE id = ? AND user_id = ?").run(token, id, user.id);
  return NextResponse.json({ token });
}

// Revoke the public link.
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const db = getDb();
  const army = db.prepare("SELECT id FROM armies WHERE id = ? AND user_id = ?").get(id, user.id);
  if (!army) return NextResponse.json({ error: "Army not found" }, { status: 404 });

  db.prepare("UPDATE armies SET public_token = NULL WHERE id = ? AND user_id = ?").run(id, user.id);
  return NextResponse.json({ success: true });
}
