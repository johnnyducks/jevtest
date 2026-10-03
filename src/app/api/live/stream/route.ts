import { getLive } from "@/lib/live/server";
import type { LiveEvent } from "@/lib/live/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Server-Sent Events: the full snapshot on connect, then live chat, telemetry,
 * trip and game updates. Every viewer sees the same Marty.
 */
export function GET(req: Request) {
  const live = getLive();
  const enc = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let open = true;
      const send = (chunk: string) => {
        if (!open) return;
        try {
          controller.enqueue(enc.encode(chunk));
        } catch {
          cleanup();
        }
      };
      const off = live.subscribe((e: LiveEvent) => send(`data: ${JSON.stringify(e)}\n\n`));
      const beat = setInterval(() => send(`: ping\n\n`), 15_000);
      cleanup = () => {
        if (!open) return;
        open = false;
        clearInterval(beat);
        off();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      req.signal.addEventListener("abort", () => cleanup());
    },
    cancel() {
      cleanup();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
