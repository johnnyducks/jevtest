"use client";

import { useEffect, useRef, useState } from "react";
import { DECOR_CHANGED } from "../three/Succulent";

const SKETCHFAB = "https://sketchfab.com/3d-models/succulent-bowl-planter-crafted-by-jerovdl-faa94790ebd3431ebff4648e9667d6a8";

/** Gear-menu row: upload a .glb for the succulents (e.g. from Sketchfab), or go back to the built-in one. Operator only. */
export default function PlantModel({ opKey, canOperate, onNotice }: { opKey: string; canOperate: boolean; onNotice: (n: { kind: "info" | "warn"; text: string }) => void }) {
  const [model, setModel] = useState<{ bytes: number } | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/decor", { cache: "no-store" })
      .then((r) => r.json())
      .then((j: { model: { bytes: number } | null }) => setModel(j.model))
      .catch(() => setModel(null));
  }, []);

  const send = async (method: "PUT" | "DELETE", body?: File) => {
    setBusy(true);
    try {
      const r = await fetch("/api/decor/model", { method, headers: { "X-Operator-Key": opKey }, body });
      const j = (await r.json().catch(() => ({}))) as { model?: { bytes: number } | null; error?: { message?: string } };
      if (!r.ok) {
        onNotice({ kind: "warn", text: j.error?.message ?? `Upload failed (${r.status}).` });
        return;
      }
      setModel(j.model ?? null);
      window.dispatchEvent(new Event(DECOR_CHANGED));
      onNotice({ kind: "info", text: j.model ? "Plant model uploaded: switch to 3D to see it." : "Back to the built-in succulent." });
    } catch {
      onNotice({ kind: "warn", text: "Couldn't reach the server." });
    } finally {
      setBusy(false);
      if (file.current) file.current.value = "";
    }
  };

  return (
    <div className="pop-ctl plant-model">
      <span className="tm-label">Plants</span>
      <span className="mono dim" title="The 3D model used for the succulents around the floors">
        {model === undefined ? "…" : model ? `your model · ${(model.bytes / 1048576).toFixed(1)} MB` : "built-in"}
      </span>
      <input
        ref={file}
        type="file"
        accept=".glb,model/gltf-binary"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void send("PUT", f);
        }}
      />
      <button className="btn" disabled={!canOperate || busy} onClick={() => file.current?.click()} title={`Upload a .glb file, e.g. the GLB download of ${SKETCHFAB}`}>
        {busy ? "Uploading…" : "Upload .glb"}
      </button>
      {model && (
        <button className="btn" disabled={!canOperate || busy} onClick={() => void send("DELETE")}>
          Use built-in
        </button>
      )}
    </div>
  );
}
