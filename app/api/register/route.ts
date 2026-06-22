import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import getDb from "@/lib/db";
import { createSession, userCount, SESSION_COOKIE, COOKIE_OPTIONS } from "@/lib/auth";

export async function POST(request: NextRequest) {
  try {
    const { username, password, invite_code } = await request.json();

    if (!username?.trim() || !password) {
      return NextResponse.json({ error: "Username and password required" }, { status: 400 });
    }
    if (password.length < 6) {
      return NextResponse.json({ error: "Password must be at least 6 characters" }, { status: 400 });
    }

    const db = getDb();
    const isFirstUser = userCount() === 0;

    // Require invite code unless this is the very first user
    if (!isFirstUser) {
      if (!invite_code?.trim()) {
        return NextResponse.json({ error: "Invite code required" }, { status: 400 });
      }
      const invite = db
        .prepare("SELECT * FROM invite_codes WHERE code = ? AND used_by IS NULL")
        .get(invite_code.trim().toUpperCase()) as { id: number } | undefined;
      if (!invite) {
        return NextResponse.json({ error: "Invalid or already-used invite code" }, { status: 400 });
      }
    }

    // Check username uniqueness
    const existing = db.prepare("SELECT id FROM users WHERE username = ?").get(username.trim());
    if (existing) {
      return NextResponse.json({ error: "Username already taken" }, { status: 400 });
    }

    const password_hash = await bcrypt.hash(password, 10);
    const role = isFirstUser ? "admin" : "user";

    const result = db
      .prepare("INSERT INTO users (username, password_hash, role, created_at) VALUES (?, ?, ?, ?)")
      .run(username.trim(), password_hash, role, Date.now());

    const userId = result.lastInsertRowid as number;

    // Mark invite as used
    if (!isFirstUser) {
      db.prepare("UPDATE invite_codes SET used_by = ?, used_at = ? WHERE code = ?")
        .run(userId, Date.now(), invite_code.trim().toUpperCase());
    }

    // Assign any orphaned data (pre-auth collection) to first user
    if (isFirstUser) {
      db.prepare("UPDATE units SET user_id = ? WHERE user_id IS NULL").run(userId);
      db.prepare("UPDATE armies SET user_id = ? WHERE user_id IS NULL").run(userId);
    }

    const token = createSession(userId);
    const response = NextResponse.json({ id: userId, username: username.trim(), role }, { status: 201 });
    response.cookies.set(SESSION_COOKIE, token, COOKIE_OPTIONS);
    return response;
  } catch (error) {
    console.error("POST /api/register error:", error);
    return NextResponse.json({ error: "Registration failed" }, { status: 500 });
  }
}
