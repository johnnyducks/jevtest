"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { ApplicantView } from "@/lib/permits/application";
import { projectNames } from "@/lib/permits/projects";
import { flow, flowIndex, STATUS_NAME } from "@/lib/permits/status";
import { api, fmtDate, StatusPill } from "./ui";

export function Track() {
  const [list, setList] = useState<ApplicantView[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const load = () =>
      api<{ applications: ApplicantView[] }>("/api/applications")
        .then((r) => { if (live) { setList(r.applications); setErr(null); } })
        .catch((e: Error) => live && setErr(e.message));
    load();
    // Pick up status changes from the office while the page is open.
    const t = setInterval(() => { if (document.visibilityState === "visible") load(); }, 20_000);
    return () => { live = false; clearInterval(t); };
  }, []);

  return (
    <>
      <div className="sechead">
        <div><div className="eyebrow">My applications</div><h2 style={{ marginTop: 8 }}>Where things stand</h2></div>
        <Link className="btn" href="/start">Start another project</Link>
      </div>
      <div className="banner">Applications are linked to this browser for the demo. Sign-in by email comes later.</div>
      {err && <div className="err" style={{ marginBottom: 16 }}>{err}</div>}
      <div className="stack" style={{ gap: 20 }}>
        {list && !list.length && (
          <div className="empty">
            <b>No applications yet</b>
            <span>When you submit a project from Plan my project, it shows up here with its progress and any messages from the office.</span>
            <Link className="btn primary" href="/start">Plan my project</Link>
          </div>
        )}
        {list?.map((a) => {
          const steps = flow(a.plan.zoning);
          const cur = flowIndex(steps, a.status);
          return (
            <article key={a.ref} className="appcard">
              <div className="hd">
                <div className="stack" style={{ gap: 6 }}>
                  <div className="row" style={{ gap: 10 }}><span className="ref">{a.ref}</span><StatusPill status={a.status} /></div>
                  <b>{projectNames(a.projects)}</b>
                  <span className="muted small">{a.address} · submitted {fmtDate(a.createdAt)}</span>
                </div>
              </div>
              <div className="progress">
                {steps.map((s, i) => (
                  <div key={s} className={i < cur ? "done" : i === cur ? "cur" : undefined}><div className="bar" />{STATUS_NAME[s]}</div>
                ))}
              </div>
              {a.status === "info" && (
                <div className="msgs"><div className="note"><b>The reviewer needs something from you.</b> See the message below, then reply by phone or email, or resubmit through SDL.</div></div>
              )}
              {a.messages.length > 0 && (
                <div className="msgs">
                  {a.messages.map((m) => (
                    <div key={m.at} className="msg"><div className="meta">Construction Office · {fmtDate(m.at)}</div>{m.text}</div>
                  ))}
                </div>
              )}
            </article>
          );
        })}
      </div>
    </>
  );
}
