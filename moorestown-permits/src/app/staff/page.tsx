import type { Metadata } from "next";
import { SignIn } from "@/components/staff/SignIn";
import { StaffConsole } from "@/components/staff/StaffConsole";
import { aiConfigured } from "@/lib/server/ai";
import { isStaff, staffMode } from "@/lib/server/session";

export const metadata: Metadata = { title: "Staff console · Moorestown Permits" };
export const dynamic = "force-dynamic";

export default async function StaffPage() {
  const mode = staffMode();
  if (mode === "closed") {
    return (
      <div className="empty">
        <b>The staff console is turned off</b>
        <span>Set STAFF_ACCESS_KEY on the server to let Construction Office reviewers sign in.</span>
      </div>
    );
  }
  if (!(await isStaff())) return <SignIn />;
  return (
    <>
      {mode === "open" && <div className="banner">Development mode: the console is open to anyone who can reach this server. Set STAFF_ACCESS_KEY to require sign-in.</div>}
      <StaffConsole ai={aiConfigured()} canSignOut={mode === "key"} />
    </>
  );
}
