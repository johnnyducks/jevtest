"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { type ApplicantView, type DocStatus, EMAIL_RE } from "@/lib/permits/application";
import { L } from "@/lib/permits/links";
import { computePlan } from "@/lib/permits/plan";
import { ANSWERS, PEOPLE_QUESTIONS, projectNames, PROJECTS, questionsFor } from "@/lib/permits/projects";
import { api, Ext } from "../ui";
import { PlanView } from "./PlanView";

const STEPS = ["Project", "The work", "Home & people", "Permit plan", "Documents"];
const DRAFT_KEY = "mt-draft";

interface Draft {
  projects: string[];
  answers: Record<string, string>;
  desc: string;
  cost: string;
  addr: string;
  blocklot: string;
  oname: string;
  oemail: string;
  ophone: string;
  contractor: string;
  docs: Record<string, DocStatus>;
}

const blank = (): Draft => ({
  projects: [], answers: { ownerOcc: "Yes", doer: "Me", plansBy: "Me" },
  desc: "", cost: "", addr: "", blocklot: "", oname: "", oemail: "", ophone: "", contractor: "", docs: {},
});

function loadDraft(): Draft {
  try {
    const v = localStorage.getItem(DRAFT_KEY);
    return v ? { ...blank(), ...JSON.parse(v) } : blank();
  } catch {
    return blank();
  }
}
function saveDraft(d: Draft | null) {
  try {
    if (d) localStorage.setItem(DRAFT_KEY, JSON.stringify(d)); else localStorage.removeItem(DRAFT_KEY);
  } catch {}
}

function Seg({ value, options, onPick }: { value: string | undefined; options: readonly string[]; onPick: (v: string) => void }) {
  return (
    <div className="seg">
      {options.map((o) => <button key={o} type="button" aria-pressed={value === o} onClick={() => onPick(o)}>{o}</button>)}
    </div>
  );
}

export function Wizard() {
  const [W, setW] = useState<Draft>(blank);
  const [loaded, setLoaded] = useState(false);
  const [step, setStep] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<ApplicantView | null>(null);

  useEffect(() => {
    setW(loadDraft());
    setLoaded(true);
  }, []);
  useEffect(() => {
    if (loaded) saveDraft(W);
  }, [W, loaded]);

  const update = (patch: Partial<Draft>) => setW((w) => ({ ...w, ...patch }));
  const answer = (k: string, v: string) => setW((w) => ({ ...w, answers: { ...w.answers, [k]: v } }));
  const plan = useMemo(() => computePlan(W), [W]);

  const go = (n: number) => {
    setErr(null);
    setStep(n);
    window.scrollTo({ top: 0 });
  };
  const next = () => {
    if (step === 0 && !W.projects.length) return setErr("Choose at least one project to continue.");
    if (step === 2 && !(W.addr.trim() && W.oname.trim() && EMAIL_RE.test(W.oemail.trim()))) {
      return setErr("Add the property address, owner's name and an email so the office can reach you.");
    }
    go(step + 1);
  };

  async function submit() {
    setBusy(true);
    setErr(null);
    try {
      const { application } = await api<{ application: ApplicantView }>("/api/applications", {
        method: "POST",
        json: {
          projects: W.projects, answers: W.answers, description: W.desc, cost: W.cost === "" ? null : Number(W.cost),
          address: W.addr, blocklot: W.blocklot, owner: { name: W.oname, email: W.oemail, phone: W.ophone },
          contractor: W.contractor, docs: W.docs,
        },
      });
      setDone(application);
      setW(blank());
      saveDraft(null);
      go(5);
    } catch (e) {
      setErr((e as Error).message || "Couldn't submit just now. Your answers are saved here; try again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  const toggleDoc = (id: string) => setW((w) => ({ ...w, docs: { ...w.docs, [id]: { files: w.docs[id]?.files ?? [], ready: !w.docs[id]?.ready } } }));
  const attach = (id: string, files: FileList | null) => {
    const names = [...(files ?? [])].map((f) => f.name);
    if (!names.length) return;
    setW((w) => ({ ...w, docs: { ...w.docs, [id]: { ready: true, files: [...(w.docs[id]?.files ?? []), ...names] } } }));
  };
  const nReady = plan.docs.filter((d) => W.docs[d.id]?.ready).length;

  return (
    <div className="wiz">
      <ol className="steps" style={{ display: step === 5 ? "none" : undefined }}>
        {STEPS.map((s, i) => (
          <li key={s} className={i < step ? "done" : i === step ? "cur" : undefined}>
            <span className="d">{i < step ? "✓" : i + 1}</span><span className="lbl">{s}</span>
          </li>
        ))}
      </ol>
      <div>
        {step === 0 && (
          <div className="wstep">
            <header><div className="eyebrow">Step 1 of 5</div><h2 style={{ marginTop: 8 }}>What are you planning?</h2><p className="muted">Pick everything that&apos;s part of the job. You can choose more than one.</p></header>
            <div className="cards">
              {PROJECTS.map((p) => {
                const on = W.projects.includes(p.id);
                return (
                  <button key={p.id} type="button" className="pcard" aria-pressed={on}
                    onClick={() => { setErr(null); update({ projects: on ? W.projects.filter((x) => x !== p.id) : [...W.projects, p.id] }); }}>
                    <b>{p.n}</b><small>{p.h}</small>
                  </button>
                );
              })}
            </div>
            {err && <div className="err">{err}</div>}
            <div className="wnav"><span /><button className="btn primary" onClick={next}>Continue</button></div>
          </div>
        )}

        {step === 1 && (
          <div className="wstep">
            <header><div className="eyebrow">Step 2 of 5</div><h2 style={{ marginTop: 8 }}>A few questions about the work</h2><p className="muted">&ldquo;Not sure&rdquo; is a fine answer. We&apos;ll flag it so the office can help.</p></header>
            <div>
              {questionsFor(W.projects).map((q) => (
                <div key={q.k} className="q">
                  <div className="qt">{q.t}{q.s && <span>{q.s}{q.k === "flood" && <> <Ext href={L.fema}>Open the map</Ext></>}</span>}</div>
                  <Seg value={W.answers[q.k]} options={ANSWERS} onPick={(v) => answer(q.k, v)} />
                </div>
              ))}
            </div>
            <div className="grid2">
              <label className="f">Describe the work in a sentence or two
                <textarea value={W.desc} onChange={(e) => update({ desc: e.target.value })} placeholder="e.g. Replace kitchen cabinets and counters, move the sink to the island, add two outlets." />
              </label>
              <label className="f">Estimated cost of the work
                <span className="hint">What a professional would charge for labor and materials, even if you&apos;re doing it yourself.</span>
                <input type="number" min={0} step={100} placeholder="25000" inputMode="numeric" value={W.cost} onChange={(e) => update({ cost: e.target.value })} />
              </label>
            </div>
            <div className="wnav"><button className="btn ghost" onClick={() => go(0)}>Back</button><button className="btn primary" onClick={next}>Continue</button></div>
          </div>
        )}

        {step === 2 && (
          <div className="wstep">
            <header><div className="eyebrow">Step 3 of 5</div><h2 style={{ marginTop: 8 }}>Your home and who&apos;s doing the work</h2></header>
            <div className="grid2">
              <label className="f">Property address<input type="text" value={W.addr} onChange={(e) => update({ addr: e.target.value })} placeholder="123 Main St, Moorestown" autoComplete="street-address" /></label>
              <label className="f">Block &amp; lot <span className="hint">Optional. It&apos;s on your tax bill.</span><input type="text" value={W.blocklot} onChange={(e) => update({ blocklot: e.target.value })} placeholder="Block 1234, Lot 5" /></label>
              <label className="f">Owner&apos;s name<input type="text" value={W.oname} onChange={(e) => update({ oname: e.target.value })} autoComplete="name" /></label>
              <label className="f">Email<input type="email" value={W.oemail} onChange={(e) => update({ oemail: e.target.value })} autoComplete="email" /></label>
              <label className="f">Phone<input type="tel" value={W.ophone} onChange={(e) => update({ ophone: e.target.value })} autoComplete="tel" /></label>
            </div>
            <div>
              <div className="q"><div className="qt">Is this a single-family home you live in?<span>Owners of a single-family home they live in may do their own work and draw their own plans.</span></div><Seg value={W.answers.ownerOcc} options={PEOPLE_QUESTIONS.ownerOcc} onPick={(v) => answer("ownerOcc", v)} /></div>
              <div className="q"><div className="qt">Who is doing the work?</div><Seg value={W.answers.doer} options={PEOPLE_QUESTIONS.doer} onPick={(v) => answer("doer", v)} /></div>
              <div className="q"><div className="qt">Who is preparing the plans, if any?<span>Licensed electricians and plumbers may draw plans for their own trade.</span></div><Seg value={W.answers.plansBy} options={PEOPLE_QUESTIONS.plansBy} onPick={(v) => answer("plansBy", v)} /></div>
            </div>
            {W.answers.doer !== "Me" && (
              <label className="f">Contractor&apos;s business name<input type="text" value={W.contractor} onChange={(e) => update({ contractor: e.target.value })} /></label>
            )}
            {err && <div className="err">{err}</div>}
            <div className="wnav"><button className="btn ghost" onClick={() => go(1)}>Back</button><button className="btn primary" onClick={next}>See my permit plan</button></div>
          </div>
        )}

        {step === 3 && (
          <div className="wstep">
            <PlanView p={plan} projects={projectNames(W.projects)} address={W.addr} answers={W.answers} />
            <div className="wnav"><button className="btn ghost" onClick={() => go(2)}>Back</button><button className="btn primary" onClick={next}>Gather documents</button></div>
          </div>
        )}

        {step === 4 && (
          <div className="wstep">
            <header><div className="eyebrow">Step 5 of 5</div><h2 style={{ marginTop: 8 }}>Gather your documents</h2><p className="muted">Check off what you have ready and attach files if you have them. The office does a quick completeness check when your application arrives, so a full packet moves faster.</p></header>
            <ul className="checklist">
              {plan.docs.map((d) => {
                const st = W.docs[d.id];
                return (
                  <li key={d.id}>
                    <button type="button" className="box" role="checkbox" aria-checked={!!st?.ready} aria-label={`${d.n} ready`} onClick={() => toggleDoc(d.id)} />
                    <div className="it">
                      <b>{d.n}</b>
                      <p>{d.p} {d.link && <Ext href={d.link}>Get the form</Ext>}</p>
                      {!!st?.files.length && <div className="files">{st.files.join(" · ")}</div>}
                    </div>
                    <div className="act">
                      <label className="btn sm filebtn">Attach<input type="file" multiple aria-label={`Attach files for ${d.n}`} onChange={(e) => { attach(d.id, e.target.files); e.target.value = ""; }} /></label>
                    </div>
                  </li>
                );
              })}
            </ul>
            <div className="note plain small">
              <b>{nReady} of {plan.docs.length}</b> items ready. {nReady < plan.docs.length ? "You can still submit. The office will tell you what's missing." : "Your packet looks complete."}{" "}
              Files attached here are listed by name for this demo; official filing happens through <Ext href={L.sdlLogin}>SDL</Ext>.
            </div>
            {err && <div className="err">{err}</div>}
            <div className="wnav"><button className="btn ghost" onClick={() => go(3)}>Back</button><button className="btn primary" disabled={busy} onClick={submit}>Submit for review</button></div>
          </div>
        )}

        {step === 5 && done && (
          <div className="wstep">
            <div className="stack" style={{ gap: 24, maxWidth: 640 }}>
              <div className="eyebrow">Submitted</div>
              <h2>Thanks. Your application is in.</h2>
              <div className="row"><span className="ref">{done.ref}</span><span className="muted small">Keep this number for your records.</span></div>
              <p className="muted">
                The office does a completeness check first{done.plan.zoning === "yes" ? ", then sends it to Zoning (up to 10 business days)" : ""}, then plan review (up to 20 business days). You&apos;ll see each step under My applications, along with any questions from the reviewer.
              </p>
              <div className="note small">This is a demonstration. To file officially, submit the same documents through <Ext href={L.sdlLogin}>the SDL portal</Ext> or at the counter in Town Hall.</div>
              <div className="row">
                <Link className="btn primary" href="/track">View my applications</Link>
                <button className="btn ghost" onClick={() => { setDone(null); go(0); }}>Plan another project</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
