import { NextRequest, NextResponse } from "next/server";
import getDb from "@/lib/db";
import { getUserFromRequest } from "@/lib/auth";

// Lightweight user list for pickers (e.g. army sharing) — any authenticated user, unlike
// the admin-only /api/users, which returns full account details.
export async function GET(request: NextRequest) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const users = getDb()
    .prepare("SELECT id, username FROM users WHERE archived = 0 AND id != ? ORDER BY username ASC")
    .all(user.id);

  return NextResponse.json(users);
}
