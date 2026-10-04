import { checkModel, MAX_MODEL_BYTES, readModel, removeModel, saveModel } from "@/lib/decor/server";
import { errorResponse } from "@/lib/http";
import { operatorAllowed } from "@/lib/live/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET → the uploaded succulent model (.glb). */
export function GET() {
  const bytes = readModel();
  if (!bytes) return new Response("No plant model uploaded; the built-in one is used.", { status: 404 });
  return new Response(new Uint8Array(bytes), { headers: { "Content-Type": "model/gltf-binary", "Cache-Control": "no-cache" } });
}

/** PUT (body: the .glb file, header X-Operator-Key) → use it for every succulent. Operator only. */
export async function PUT(req: Request) {
  if (!operatorAllowed(req.headers.get("x-operator-key") ?? "")) return errorResponse(403, "forbidden", "Operator key required.");
  const size = Number(req.headers.get("content-length") || 0);
  if (size > MAX_MODEL_BYTES) return errorResponse(413, "too_large", `The limit is ${MAX_MODEL_BYTES / 1048576} MB.`);
  const bytes = new Uint8Array(await req.arrayBuffer());
  const problem = checkModel(bytes);
  if (problem) return errorResponse(422, "bad_model", problem);
  return Response.json({ model: saveModel(bytes) });
}

/** DELETE (header X-Operator-Key) → back to the built-in succulent. Operator only. */
export function DELETE(req: Request) {
  if (!operatorAllowed(req.headers.get("x-operator-key") ?? "")) return errorResponse(403, "forbidden", "Operator key required.");
  removeModel();
  return Response.json({ model: null });
}
