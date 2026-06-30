import { NextRequest, NextResponse } from "next/server";
import getDb from "@/lib/db";
import { getUserFromRequest } from "@/lib/auth";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import Busboy from "busboy";
import { Readable } from "stream";

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
  } catch {
    return NextResponse.json({ error: "Cannot create uploads directory" }, { status: 500 });
  }

  const contentType = request.headers.get("content-type") ?? "";

  // Read the full body first (must happen outside the Promise callback since it's async).
  // Streaming directly from request.body fails under Turbopack — arrayBuffer() uses
  // Next.js's own body reader which handles the multipart bytes correctly.
  let rawBody: Buffer;
  try {
    rawBody = Buffer.from(await request.arrayBuffer());
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to read body: ${err instanceof Error ? err.message : err}` },
      { status: 400 }
    );
  }

  return new Promise<NextResponse>((resolve) => {
    const bb = Busboy({ headers: { "content-type": contentType } });

    const chunks: Buffer[] = [];
    let originalFilename = "";
    let mimetype = "application/octet-stream";
    let displayName = "";
    let fileReceived = false;

    bb.on("file", (_field, stream, info) => {
      fileReceived = true;
      originalFilename = info.filename;
      mimetype = info.mimeType || "application/octet-stream";
      stream.on("data", (chunk: Buffer) => chunks.push(chunk));
      stream.on("error", (err: Error) => {
        resolve(NextResponse.json({ error: `Stream error: ${err.message}` }, { status: 500 }));
      });
    });

    bb.on("field", (name, value) => {
      if (name === "name") displayName = value.trim();
    });

    bb.on("finish", async () => {
      if (!fileReceived || chunks.length === 0) {
        resolve(NextResponse.json({ error: "No file received" }, { status: 400 }));
        return;
      }
      try {
        const buffer = Buffer.concat(chunks);
        const ext = path.extname(originalFilename);
        const storedFilename = `${randomUUID()}${ext}`;
        await writeFile(path.join(UPLOADS_DIR, storedFilename), buffer);

        const db = getDb();
        const result = db.prepare(`
          INSERT INTO documents (name, original_filename, stored_filename, mimetype, size, uploaded_by, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
          displayName || originalFilename,
          originalFilename,
          storedFilename,
          mimetype,
          buffer.byteLength,
          user.id,
          Date.now()
        );

        resolve(NextResponse.json(
          db.prepare("SELECT * FROM documents WHERE id = ?").get(result.lastInsertRowid),
          { status: 201 }
        ));
      } catch (err) {
        console.error("Document write error:", err);
        resolve(NextResponse.json(
          { error: `Failed to save: ${err instanceof Error ? err.message : err}` },
          { status: 500 }
        ));
      }
    });

    bb.on("error", (err: Error) => {
      resolve(NextResponse.json({ error: `Parse error: ${err.message}` }, { status: 400 }));
    });

    Readable.from(rawBody).pipe(bb);
  });
}
