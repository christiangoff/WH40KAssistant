import { NextRequest, NextResponse } from "next/server";
import getDb from "@/lib/db";
import { getUserFromRequest } from "@/lib/auth";
import { syncCatalog } from "@/lib/catalog";

// Admin-only: re-pull the unit catalog from Wahapedia's bulk export.
export async function POST(request: NextRequest) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const count = await syncCatalog(getDb());
    return NextResponse.json({ count });
  } catch (error) {
    console.error("POST /api/catalog/sync error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Catalog sync failed" },
      { status: 500 }
    );
  }
}
