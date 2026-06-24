import crypto from "crypto";
import getDb from "./db";

export interface AuthUser {
  id: number;
  username: string;
  role: string;
}

export function getUserFromRequest(request: {
  cookies: { get: (name: string) => { value: string } | undefined };
}): AuthUser | null {
  const token = request.cookies.get("session")?.value;
  if (!token) return null;
  return validateSession(token);
}

export function validateSession(token: string): AuthUser | null {
  try {
    const db = getDb();
    const row = db
      .prepare(
        `SELECT u.id, u.username, u.role
         FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.token = ? AND s.expires_at > ? AND u.archived = 0`
      )
      .get(token, Date.now()) as AuthUser | undefined;
    return row ?? null;
  } catch {
    return null;
  }
}

export function createSession(userId: number): string {
  const db = getDb();
  const token = crypto.randomBytes(32).toString("hex");
  const expires = Date.now() + 30 * 24 * 60 * 60 * 1000; // 30 days
  db.prepare(
    "INSERT INTO sessions (user_id, token, created_at, expires_at) VALUES (?, ?, ?, ?)"
  ).run(userId, token, Date.now(), expires);
  return token;
}

export function deleteSession(token: string): void {
  getDb().prepare("DELETE FROM sessions WHERE token = ?").run(token);
}

export function generateInviteCode(): string {
  return crypto.randomBytes(4).toString("hex").toUpperCase();
}

export function userCount(): number {
  const row = getDb()
    .prepare("SELECT COUNT(*) as count FROM users")
    .get() as { count: number };
  return row.count;
}

export const SESSION_COOKIE = "session";
export const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: false,
  sameSite: "lax" as const,
  path: "/",
  maxAge: 30 * 24 * 60 * 60,
};
