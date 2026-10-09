import { NextResponse } from "next/server";
import { isStaff, staffMode } from "@/lib/server/session";

/** Returns a 401/403 response for non-staff, or null to continue. */
export async function staffOnly(): Promise<NextResponse | null> {
  if (await isStaff()) return null;
  return staffMode() === "closed"
    ? NextResponse.json({ error: "The staff console is turned off. Set STAFF_ACCESS_KEY on the server to use it." }, { status: 403 })
    : NextResponse.json({ error: "Sign in to the staff console first." }, { status: 401 });
}
