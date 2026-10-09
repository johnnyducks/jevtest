import { NextResponse } from "next/server";
import { applyStatusUpdate, parseStatusUpdate } from "@/lib/permits/application";
import { getStore } from "@/lib/server/store";
import { staffOnly } from "../../guard";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ ref: string }> };

/** Update status, send the applicant a message and/or add an internal note. */
export async function PATCH(req: Request, { params }: Ctx) {
  const denied = await staffOnly();
  if (denied) return denied;
  const store = getStore();
  const app = await store.get((await params).ref);
  if (!app) return NextResponse.json({ error: "No such application." }, { status: 404 });
  const parsed = parseStatusUpdate(await req.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const next = applyStatusUpdate(app, parsed.value, Date.now());
  if (!next) return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  await store.put(next);
  return NextResponse.json({ application: next });
}

/** Remove an example application. Real applications can't be deleted here. */
export async function DELETE(_req: Request, { params }: Ctx) {
  const denied = await staffOnly();
  if (denied) return denied;
  const store = getStore();
  const app = await store.get((await params).ref);
  if (!app) return NextResponse.json({ error: "No such application." }, { status: 404 });
  if (!app.example) return NextResponse.json({ error: "Only example applications can be removed." }, { status: 400 });
  await store.remove(app.ref);
  return NextResponse.json({ ok: true });
}
