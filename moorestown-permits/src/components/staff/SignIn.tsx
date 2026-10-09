"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "../ui";

export function SignIn() {
  const router = useRouter();
  const [key, setKey] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="panel signin"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setErr(null);
        try {
          await api("/api/staff/session", { method: "POST", json: { key } });
          router.refresh();
        } catch (e) {
          setErr((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <h3>Staff sign-in</h3>
      <p className="muted small">The staff console is for Construction Office reviewers. Enter the access key from the portal administrator.</p>
      <label className="f">Access key<input type="password" value={key} onChange={(e) => setKey(e.target.value)} autoComplete="current-password" /></label>
      {err && <div className="err">{err}</div>}
      <div className="row"><button className="btn primary" type="submit" disabled={busy || !key}>Sign in</button></div>
    </form>
  );
}
