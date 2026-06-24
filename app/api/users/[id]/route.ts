import { NextRequest, NextResponse } from "next/server";
import getDb from "@/lib/db";
import { getUserFromRequest } from "@/lib/auth";
import bcrypt from "bcryptjs";

const VALID_ROLES = ["admin", "game_manager", "user"];

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const me = getUserFromRequest(request);
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (me.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const { id } = await params;
    const db = getDb();
    const body = await request.json();
    const { role, password, archived } = body;

    const existing = db.prepare("SELECT id FROM users WHERE id = ?").get(id);
    if (!existing) return NextResponse.json({ error: "User not found" }, { status: 404 });

    // Prevent admin from archiving or demoting themselves
    if (String(me.id) === id) {
      if (archived) return NextResponse.json({ error: "Cannot archive yourself" }, { status: 400 });
      if (role && role !== "admin") return NextResponse.json({ error: "Cannot change your own role" }, { status: 400 });
    }

    const updates: string[] = [];
    const values: unknown[] = [];

    if (role !== undefined) {
      if (!VALID_ROLES.includes(role)) return NextResponse.json({ error: "Invalid role" }, { status: 400 });
      updates.push("role = ?"); values.push(role);
    }
    if (password !== undefined && password !== "") {
      const hash = await bcrypt.hash(password, 10);
      updates.push("password_hash = ?"); values.push(hash);
      // Invalidate all existing sessions for this user
      db.prepare("DELETE FROM sessions WHERE user_id = ?").run(id);
    }
    if (archived !== undefined) {
      updates.push("archived = ?"); values.push(archived ? 1 : 0);
      if (archived) db.prepare("DELETE FROM sessions WHERE user_id = ?").run(id);
    }

    if (updates.length > 0) {
      values.push(id);
      db.prepare(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`).run(...values);
    }

    const updated = db.prepare("SELECT id, username, email, role, archived, created_at FROM users WHERE id = ?").get(id);
    return NextResponse.json(updated);
  } catch (error) {
    console.error("PUT /api/users/[id] error:", error);
    return NextResponse.json({ error: "Failed to update user" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const me = getUserFromRequest(request);
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (me.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const { id } = await params;
    if (String(me.id) === id) return NextResponse.json({ error: "Cannot delete yourself" }, { status: 400 });

    const db = getDb();
    const existing = db.prepare("SELECT id FROM users WHERE id = ?").get(id);
    if (!existing) return NextResponse.json({ error: "User not found" }, { status: 404 });

    db.prepare("DELETE FROM sessions WHERE user_id = ?").run(id);
    db.prepare("DELETE FROM units WHERE user_id = ?").run(id);
    db.prepare("DELETE FROM armies WHERE user_id = ?").run(id);
    db.prepare("DELETE FROM users WHERE id = ?").run(id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DELETE /api/users/[id] error:", error);
    return NextResponse.json({ error: "Failed to delete user" }, { status: 500 });
  }
}
