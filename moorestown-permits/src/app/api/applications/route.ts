import { NextResponse } from "next/server";
import { makeRef, newApplication, parseSubmission, toApplicantView } from "@/lib/permits/application";
import { allow, clientKey } from "@/lib/server/limit";
import { applicantId } from "@/lib/server/session";
import { getStore } from "@/lib/server/store";

export const dynamic = "force-dynamic";

/** This browser's applications. */
export async function GET() {
  const id = await applicantId();
  const list = id ? await getStore().listByOwner(id) : [];
  return NextResponse.json({ applications: list.map(toApplicantView) });
}

/** Submit an application from the wizard. */
export async function POST(req: Request) {
  if (!allow("submit:" + clientKey(req), 20, 60 * 60_000)) {
    return NextResponse.json({ error: "Too many submissions from here. Try again later." }, { status: 429 });
  }
  const parsed = parseSubmission(await req.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const store = getStore();
  let ref = makeRef();
  while (await store.get(ref)) ref = makeRef();
  const app = newApplication(parsed.value, await applicantId(true), ref, Date.now());
  await store.put(app);
  return NextResponse.json({ application: toApplicantView(app) }, { status: 201 });
}
