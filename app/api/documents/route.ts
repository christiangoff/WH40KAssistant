import { NextRequest, NextResponse } from "next/server";
import getDb from "@/lib/db";
import { getUserFromRequest } from "@/lib/auth";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import crypto from "crypto";

const UPLOADS_DIR = path.join(process.cwd(), "data", "uploads");

export async function GET(request: NextRequest) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const forUserId = request.nextUrl.searchParams.get("forUserId");
  const targetId = forUserId && user.role === "admin" ? parseInt(forUserId) : user.id;

  const db = getDb();
  const docs = db.prepare(`
    SELECT d.*, u.username AS uploader_name,
      CASE WHEN EXISTS (
        SELECT 1 FROM document_shares ds WHERE ds.document_id = d.id AND ds.shared_with IS NULL
      ) THEN 1 ELSE 0 END AS shared_with_all
    FROM documents d
    JOIN users u ON u.id = d.uploaded_by
    WHERE d.uploaded_by = ?
      OR EXISTS (
        SELECT 1 FROM document_shares ds
        WHERE ds.document_id = d.id AND (ds.shared_with = ? OR ds.shared_with IS NULL)
      )
    ORDER BY d.created_at DESC
  `).all(targetId, targetId);

  return NextResponse.json(docs);
}

export async function POST(request: NextRequest) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    await mkdir(UPLOADS_DIR, { recursive: true });

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const name = ((formData.get("name") as string) ?? "").trim();

    if (!file || file.size === 0) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const ext = path.extname(file.name);
    const storedFilename = `${crypto.randomUUID()}${ext}`;
    const filePath = path.join(UPLOADS_DIR, storedFilename);

    await writeFile(filePath, Buffer.from(await file.arrayBuffer()));

    const db = getDb();
    const result = db.prepare(`
      INSERT INTO documents (name, original_filename, stored_filename, mimetype, size, uploaded_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      name || file.name,
      file.name,
      storedFilename,
      file.type || "application/octet-stream",
      file.size,
      user.id,
      Date.now()
    );

    return NextResponse.json(
      db.prepare("SELECT * FROM documents WHERE id = ?").get(result.lastInsertRowid),
      { status: 201 }
    );
  } catch (error) {
    console.error("Document upload error:", error);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
