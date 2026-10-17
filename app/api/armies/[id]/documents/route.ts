import { NextRequest, NextResponse } from "next/server";
import getDb from "@/lib/db";
import { getUserFromRequest } from "@/lib/auth";

// Documents pinned to an army (rulebooks, reference sheets) — listed first in
// the match page's Docs panel. Only the army's owner can pin, and only
// documents they can already open (their own, or shared with them / everyone).

const CAN_ACCESS_DOC = `(
  d.uploaded_by = @userId
  OR EXISTS (
    SELECT 1 FROM document_shares ds
    WHERE ds.document_id = d.id AND (ds.shared_with = @userId OR ds.shared_with IS NULL)
  )
)`;

function ownsArmy(armyId: string, userId: number): boolean {
  return !!getDb().prepare("SELECT 1 FROM armies WHERE id = ? AND user_id = ?").get(armyId, userId);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { id } = await params;
    if (!ownsArmy(id, user.id)) return NextResponse.json({ error: "Army not found" }, { status: 404 });

    const docs = getDb().prepare(`
      SELECT d.id, d.name, d.original_filename, d.mimetype, d.size, d.created_at, ad.pinned_at
      FROM army_documents ad
      JOIN documents d ON d.id = ad.document_id
      WHERE ad.army_id = @armyId AND ${CAN_ACCESS_DOC}
      ORDER BY ad.pinned_at ASC
    `).all({ armyId: id, userId: user.id });

    return NextResponse.json(docs);
  } catch (error) {
    console.error("GET /api/armies/[id]/documents error:", error);
    return NextResponse.json({ error: "Failed to fetch pinned documents" }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { id } = await params;
    if (!ownsArmy(id, user.id)) return NextResponse.json({ error: "Army not found" }, { status: 404 });

    const { document_id } = await request.json();
    const db = getDb();
    const doc = db.prepare(`SELECT d.id FROM documents d WHERE d.id = @docId AND ${CAN_ACCESS_DOC}`)
      .get({ docId: document_id, userId: user.id });
    if (!doc) return NextResponse.json({ error: "Document not found" }, { status: 404 });

    db.prepare("INSERT OR IGNORE INTO army_documents (army_id, document_id, pinned_at) VALUES (?, ?, ?)")
      .run(id, document_id, Date.now());

    return NextResponse.json({ success: true }, { status: 201 });
  } catch (error) {
    console.error("POST /api/armies/[id]/documents error:", error);
    return NextResponse.json({ error: "Failed to pin document" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { id } = await params;
    if (!ownsArmy(id, user.id)) return NextResponse.json({ error: "Army not found" }, { status: 404 });

    const documentId = request.nextUrl.searchParams.get("document_id");
    if (!documentId) return NextResponse.json({ error: "document_id is required" }, { status: 400 });

    getDb().prepare("DELETE FROM army_documents WHERE army_id = ? AND document_id = ?").run(id, documentId);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DELETE /api/armies/[id]/documents error:", error);
    return NextResponse.json({ error: "Failed to unpin document" }, { status: 500 });
  }
}
