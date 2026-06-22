import { NextResponse } from "next/server";
import { userCount } from "@/lib/auth";

export async function GET() {
  return NextResponse.json({ first_run: userCount() === 0 });
}
