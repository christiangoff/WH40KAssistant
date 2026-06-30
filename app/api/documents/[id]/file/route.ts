import { NextRequest, NextResponse } from "next/server";
import getDb from "@/lib/db";
import { getUserFromRequest } from "@/lib/auth";
import { createReadStream, existsSync } from "fs";
import { stat } from "fs/promises";
import path from "path";
import { Readable } from "stream";

const UPLOADS_DIR = path.join(process.cwd(), "data", "uploads");

interface DocRow {
  id: number;
  name: string;
  original_filename: string;
  stored_filename: string;
  mimetype: string;
  size: number;
  uploaded_by: number;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const db = getDb();
  const doc = db.prepare("SELECT * FROM documents WHERE id = ?").get(id) as DocRow | undefined;
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const canAccess =
    doc.uploaded_by === user.id ||
    user.role === "admin" ||
    !!db.prepare(
      "SELECT 1 FROM document_shares WHERE document_id = ? AND (shared_with = ? OR shared_with IS NULL)"
    ).get(id, user.id);

  if (!canAccess) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const filePath = path.join(UPLOADS_DIR, doc.stored_filename);
  if (!existsSync(filePath)) return NextResponse.json({ error: "File missing" }, { status: 404 });

  const fileStat = await stat(filePath);
  const stream = createReadStream(filePath);
  const webStream = Readable.toWeb(stream) as ReadableStream;

  return new Response(webStream, {
    headers: {
      "Content-Type": doc.mimetype,
      "Content-Disposition": `inline; filename="${encodeURIComponent(doc.original_filename)}"`,
      "Content-Length": fileStat.size.toString(),
      "Cache-Control": "private, max-age=3600",
    },
  });
}
