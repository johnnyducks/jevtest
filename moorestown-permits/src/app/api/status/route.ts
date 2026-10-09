import { NextResponse } from "next/server";
import { aiConfigured } from "@/lib/server/ai";
import { isStaff, staffMode } from "@/lib/server/session";

export const dynamic = "force-dynamic";

/** What the browser needs to know about this server: is AI on, how staff sign in. */
export async function GET() {
  return NextResponse.json({ ai: aiConfigured(), staff: { mode: staffMode(), signedIn: await isStaff() } });
}
