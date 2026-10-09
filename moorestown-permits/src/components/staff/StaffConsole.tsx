"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { type AiReview, type Application, readiness } from "@/lib/permits/application";
import { DISC, projectNames, QUESTIONS } from "@/lib/permits/projects";
import { bizDays, FILTERS, matchesFilter, type QueueFilter, STATUS_NAME, STATUSES, type Status } from "@/lib/permits/status";
import { api, fmtDate, StatusPill, useToast } from "../ui";
import { AiPanel } from "./AiPanel";

export function StaffConsole({ ai, canSignOut }: { ai: boolean; canSignOut: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [all, setAll] = useState<Application[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [filter, setFilter] = useState<QueueFilter>("open");
  const [text, setText] = useState("");
  const [reviewing, setReviewing] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setAll((await api<{ applications: Application[] }>("/api/staff/applications")).applications);
    } catch (e) {
      toast((e as Error).message);
    }
  }, [toast]);

  useEffect(() => {
    load();
    const t = setInterval(() => { if (document.visibilityState === "visible") load(); }, 20_000);
    return () => clearInterval(t);
  }, [load]);

  const replace = (a: Application) => setAll((xs) => xs.map((x) => (x.ref === a.ref ? a : x)));

  const list = useMemo(() => {
    const q = text.trim().toLowerCase();
    return all.filter((a) => matchesFilter(a.status, filter) && (!q || `${a.ref} ${a.owner.name} ${a.address}`.toLowerCase().includes(q)));
  }, [all, filter, text]);
  const current = all.find((a) => a.ref === sel) ?? null;

  async function loadExamples() {
    try {
      setAll((await api<{ applications: Application[] }>("/api/staff/applications", { method: "POST", json: { action: "examples" } })).applications);
      toast("Three example applications added");
    } catch (e) {
      toast((e as Error).message);
    }
  }

  async function runReview(a: Application) {
    setReviewing(a.ref);
    try {
      replace((await api<{ application: Application }>(`/api/staff/applications/${encodeURIComponent(a.ref)}/review`, { method: "POST" })).application);
      toast("AI review saved to this application");
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setReviewing(null);
    }
  }

  return (
    <>
      <div className="sechead">
        <div><div className="eyebrow">Staff console</div><h2 style={{ marginTop: 8 }}>Application review</h2></div>
        <div className="row">
          <button className="btn sm" onClick={loadExamples}>Load example applications</button>
          {canSignOut && (
            <button className="btn sm ghost" onClick={async () => { await api("/api/staff/session", { method: "DELETE" }).catch(() => {}); router.refresh(); }}>
              Sign out
            </button>
          )}
        </div>
      </div>
      <div className="console">
        <div className="queue">
          <div className="qh">
            <input type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="Search name, address or number" aria-label="Search applications" />
            <div className="filters">
              {FILTERS.map(([k, label]) => <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)}>{label}</button>)}
            </div>
          </div>
          <div className="qlist">
            {list.length ? list.map((a) => {
              const [r, t] = readiness(a);
              return (
                <button key={a.ref} type="button" className="qitem" aria-current={sel === a.ref} onClick={() => setSel(a.ref)}>
                  <span className="stripe" />
                  <span>
                    <span className="l1"><span>{a.ref}</span><span className="muted">{bizDays(a.createdAt)} bd</span></span>
                    <span className="l2">{a.owner.name}</span>
                    <span className="l3"><StatusPill status={a.status} /><span>{projectNames(a.projects)}</span><span>{r}/{t} docs</span>{a.example && <span className="pill line">Example</span>}</span>
                  </span>
                </button>
              );
            }) : <div style={{ padding: "24px 16px" }} className="muted small">No applications match.</div>}
          </div>
        </div>
        <div className="detail">
          {current ? (
            <Detail
              key={current.ref}
              a={current}
              ai={ai}
              reviewing={reviewing === current.ref}
              onReview={() => runReview(current)}
              onSaved={replace}
              onRemoved={() => { setAll((xs) => xs.filter((x) => x.ref !== current.ref)); setSel(null); }}
            />
          ) : (
            <div className="empty">
              <b>{all.length ? "Select an application" : "No applications yet"}</b>
              <span>{all.length
                ? "Pick one from the queue to see its details, run an AI completeness review and update its status."
                : "Homeowner submissions from Plan my project land here. You can also load clearly marked example applications to try the console."}</span>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function Detail({ a, ai, reviewing, onReview, onSaved, onRemoved }: {
  a: Application;
  ai: boolean;
  reviewing: boolean;
  onReview: () => void;
  onSaved: (a: Application) => void;
  onRemoved: () => void;
}) {
  const toast = useToast();
  const [status, setStatus] = useState<Status>(a.status);
  const [msg, setMsg] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [r, t] = readiness(a);
  const p = a.plan;
  const scope = QUESTIONS.filter((q) => a.answers[q.k]);

  async function save() {
    if (status === a.status && !msg.trim() && !note.trim()) return toast("Nothing to update");
    setSaving(true);
    try {
      const res = await api<{ application: Application }>(`/api/staff/applications/${encodeURIComponent(a.ref)}`, { method: "PATCH", json: { status, message: msg, note } });
      onSaved(res.application);
      setMsg("");
      setNote("");
      toast("Update saved");
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    try {
      await api(`/api/staff/applications/${encodeURIComponent(a.ref)}`, { method: "DELETE" });
      onRemoved();
      toast("Example removed");
    } catch (e) {
      toast((e as Error).message);
    }
  }

  const applySuggestion = (x: AiReview) => {
    setStatus(x.suggestedStatus ?? a.status);
    setMsg(x.messageToApplicant ?? "");
    document.getElementById("st-msg")?.focus();
  };

  return (
    <>
      <div className="panel stack" style={{ gap: 16 }}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div className="row" style={{ gap: 10 }}><span className="ref">{a.ref}</span><StatusPill status={a.status} />{a.example && <span className="pill line">Example</span>}</div>
          <span className="muted small mono">{bizDays(a.createdAt)} business days since intake</span>
        </div>
        <h3 style={{ fontSize: "1.4rem" }}>{projectNames(a.projects)}</h3>
        <p className="muted">{a.description || "No description provided."}</p>
        <dl className="kv">
          <dt>Owner</dt><dd>{a.owner.name} · <span className="mono small" style={{ userSelect: "all" }}>{a.owner.email}</span>{a.owner.phone && ` · ${a.owner.phone}`}</dd>
          <dt>Property</dt><dd>{a.address}{a.blocklot && ` · ${a.blocklot}`}</dd>
          <dt>Owner-occupied SFD</dt><dd>{a.answers.ownerOcc}</dd>
          <dt>Work by</dt><dd>{a.answers.doer}{a.contractor && ` (${a.contractor})`}</dd>
          <dt>Plans by</dt><dd>{a.answers.plansBy}</dd>
          <dt>Est. cost</dt><dd className="mono">{a.cost != null ? "$" + a.cost.toLocaleString() : "Not given"}</dd>
          <dt>Portal&apos;s read</dt>
          <dd>{p.clsName} · {p.disc.map((k) => DISC[k][0]).join(", ") || "no technicals"} · zoning {p.zoning}{p.plans && " · plans required"}</dd>
          {scope.map((q) => <KvRow key={q.k} dt={q.t} dd={a.answers[q.k]} />)}
        </dl>
      </div>

      <div className="panel stack">
        <div className="row" style={{ justifyContent: "space-between" }}><h3>Document checklist</h3><span className="mono small">{r} of {t} marked ready</span></div>
        <ul className="checklist">
          {p.docs.map((d) => {
            const s = a.docs[d.id];
            return (
              <li key={d.id}>
                <span className="box" aria-checked={!!s?.ready} style={{ cursor: "default" }} />
                <div className="it">
                  <b>{d.n}</b>
                  {s?.files.length ? <div className="files">{s.files.join(" · ")}</div> : <p>{s?.ready ? "Marked ready, no file attached" : "Not provided"}</p>}
                </div>
                <span />
              </li>
            );
          })}
        </ul>
      </div>

      <AiPanel ai={a.ai} enabled={ai} busy={reviewing} onRun={onReview} onUse={applySuggestion} />

      <div className="panel stack">
        <h3>Update status</h3>
        <div className="grid2">
          <label className="f">New status
            <select value={status} onChange={(e) => setStatus(e.target.value as Status)}>
              {STATUSES.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </select>
          </label>
          <label className="f">Message to applicant <span className="hint">Optional. Shown on their My applications page.</span>
            <textarea id="st-msg" style={{ minHeight: 72 }} value={msg} onChange={(e) => setMsg(e.target.value)} />
          </label>
        </div>
        <label className="f">Internal note <span className="hint">Staff only.</span><input type="text" value={note} onChange={(e) => setNote(e.target.value)} /></label>
        <div className="row">
          <button className="btn primary" disabled={saving} onClick={save}>Save update</button>
          {a.example && <button className="btn ghost" onClick={remove}>Remove example</button>}
        </div>
        {a.history.length > 0 && (
          <ul className="tl" style={{ marginTop: 8 }}>
            {[...a.history].reverse().map((h, i) => (
              <li key={i}>
                <span>{STATUS_NAME[h.status] ?? h.status}{h.note && <> <span className="muted small">· {h.note}</span></>}</span>
                <span className="dur">{fmtDate(h.at)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

const KvRow = ({ dt, dd }: { dt: string; dd: string }) => (<><dt>{dt}</dt><dd>{dd}</dd></>);
