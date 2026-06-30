import { NextRequest, NextResponse } from "next/server";
import getDb from "@/lib/db";
import { getUserFromRequest } from "@/lib/auth";
import { unlink } from "fs/promises";
import path from "path";

const UPLOADS_DIR = path.join(process.cwd(), "data", "uploads");

interface DocRow {
  id: number;
  name: string;
  original_filename: string;
  stored_filename: string;
  mimetype: string;
  size: number;
  uploaded_by: number;
  created_at: number;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const db = getDb();
  const doc = db.prepare("SELECT * FROM documents WHERE id = ?").get(id) as DocRow | undefined;
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (doc.uploaded_by !== user.id && user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { name } = await request.json();
  if (name?.trim()) {
    db.prepare("UPDATE documents SET name = ? WHERE id = ?").run(name.trim(), id);
  }
  return NextResponse.json(db.prepare("SELECT * FROM documents WHERE id = ?").get(id));
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const db = getDb();
  const doc = db.prepare("SELECT * FROM documents WHERE id = ?").get(id) as DocRow | undefined;
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (doc.uploaded_by !== user.id && user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try { await unlink(path.join(UPLOADS_DIR, doc.stored_filename)); } catch { /* already gone */ }
  db.prepare("DELETE FROM documents WHERE id = ?").run(id);
  return NextResponse.json({ success: true });
}
