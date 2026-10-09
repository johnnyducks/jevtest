import { NextResponse } from "next/server";
import { allow, clientKey } from "@/lib/server/limit";
import { isStaff, staffMode, staffSignIn, staffSignOut } from "@/lib/server/session";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ mode: staffMode(), signedIn: await isStaff() });
}

/** Sign in with the staff access key. */
export async function POST(req: Request) {
  if (!allow("staff-login:" + clientKey(req), 10, 15 * 60_000)) {
    return NextResponse.json({ error: "Too many tries. Wait a few minutes." }, { status: 429 });
  }
  const body = (await req.json().catch(() => null)) as { key?: unknown } | null;
  const ok = typeof body?.key === "string" && (await staffSignIn(body.key));
  if (!ok) return NextResponse.json({ error: "That key didn't work." }, { status: 401 });
  return NextResponse.json({ mode: staffMode(), signedIn: true });
}

export async function DELETE() {
  await staffSignOut();
  return NextResponse.json({ mode: staffMode(), signedIn: await isStaff() });
}
