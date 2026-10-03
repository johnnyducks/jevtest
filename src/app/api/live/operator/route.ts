import { errorResponse, readJson } from "@/lib/http";
import { getLive, operatorAllowed } from "@/lib/live/server";
import type { OperatorCommand } from "@/lib/live/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const num = (v: unknown, lo: number, hi: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : null;
};

function parse(b: Record<string, unknown>): OperatorCommand | null {
  switch (b.action) {
    case "stop":
    case "resume":
    case "reset":
    case "dock":
      return { action: b.action };
    case "place": {
      const x = num(b.x, 0, 100);
      const y = num(b.y, 0, 100);
      return x === null || y === null ? null : { action: "place", x, y };
    }
    case "rotate": {
      const deg = num(b.deg, -360, 360);
      return deg === null ? null : { action: "rotate", deg };
    }
    case "speed": {
      const mps = num(b.mps, 0.1, 2);
      return mps === null ? null : { action: "speed", mps };
    }
    case "battery": {
      const level = num(b.level, 0, 100);
      return level === null ? null : { action: "battery", level };
    }
    default:
      return null;
  }
}

/** POST { action, key?, ... } → operator control of the simulated Marty. Locked by OPERATOR_KEY when set. */
export async function POST(req: Request) {
  const body = await readJson(req);
  if (!operatorAllowed(body?.key)) return errorResponse(403, "forbidden", "Operator key required.");
  const cmd = body ? parse(body) : null;
  if (!cmd) return errorResponse(400, "bad_request", "Unknown operator command.");
  const r = getLive().operator(cmd);
  return Response.json(r, { status: r.ok ? 200 : 409, headers: { "Cache-Control": "no-store" } });
}
