import type { Plan } from "@/lib/permits/plan";
import { L } from "@/lib/permits/links";
import { DISC } from "@/lib/permits/projects";
import { Ext } from "../ui";

const ZONING = {
  yes: ["Yes", "Zoning reviews first"],
  check: ["Check", "Ask the Zoning Office"],
  no: ["Not likely", "Interior work usually skips zoning"],
} as const;

export function PlanView({ p, projects, address, answers }: { p: Plan; projects: string; address: string; answers: Record<string, string> }) {
  const z = ZONING[p.zoning];
  const ownerPlansOnRental = answers.plansBy === "Me" && answers.ownerOcc !== "Yes";
  return (
    <div className="stack" style={{ gap: 28 }}>
      <header className="plan-head">
        <div>
          <div className="eyebrow">Step 4 of 5 · Your permit plan</div>
          <h2 style={{ marginTop: 8 }}>{p.permit ? "Here's what your project needs" : "You may not need a construction permit"}</h2>
          <p className="muted" style={{ marginTop: 8 }}>{projects} at {address || "your home"}.</p>
        </div>
      </header>
      <div className="verdict">
        <div><div className="k">Construction permit</div><div className="v">{p.permit ? "Required" : "Probably not"}</div><div className="s">{p.permit ? "Under N.J.A.C. 5:23" : "Zoning may still apply"}</div></div>
        <div><div className="k">Type of work</div><div className="v">{p.clsName}</div><div className="s">Rehabilitation Subcode</div></div>
        <div>
          <div className="k">Plans</div>
          <div className="v">{p.plans ? "2 sets needed" : "Not usually"}</div>
          <div className="s">{p.plans ? (ownerPlansOnRental ? "A design professional must prepare them" : "Drawn to scale") : "A clear description may do"}</div>
        </div>
        <div><div className="k">Zoning</div><div className="v">{z[0]}</div><div className="s">{z[1]}</div></div>
      </div>
      {p.disc.length > 0 && (
        <div className="stack">
          <h3>Technical sections to include</h3>
          <div className="disc">
            {p.disc.map((k) => (
              <a key={k} className="pill line" href={L[DISC[k][1]]} target="_blank" rel="noopener">{DISC[k][0]}</a>
            ))}
          </div>
        </div>
      )}
      {p.notes.length > 0 && <div className="stack">{p.notes.map((n) => <div key={n} className="note">{n}</div>)}</div>}
      {answers.ownerOcc !== "Yes" && answers.doer !== "A contractor" && (
        <div className="note">Because this isn&apos;t an owner-occupied single-family home, plumbing, electrical and HVAC work must be done by licensed contractors.</div>
      )}
      <div className="two">
        <div className="stack">
          <h3>What to expect</h3>
          <ul className="tl">
            {p.tl.map((t) => <li key={t.label} className={t.key ? "y" : undefined}><span>{t.label}</span><span className="dur">{t.duration}</span></li>)}
          </ul>
          {p.prior.length > 0 && (
            <div className="stack" style={{ marginTop: 8 }}>
              <h3>Approvals that come first</h3>
              <ul className="tl">
                {p.prior.map((x) => (
                  <li key={x.who}><span>{x.who}<br /><span className="muted small">{x.what}</span></span><span className="dur">{x.need === "yes" ? "Required" : "Possibly"}</span></li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <div className="stack">
          <h3>Inspections you&apos;ll schedule</h3>
          <ul className="tl">
            {p.insp.length ? p.insp.map((i) => <li key={i}><span>{i}</span><span /></li>) : <li><span className="muted">None expected</span><span /></li>}
          </ul>
          <p className="small muted"><Ext href={L.insp}>Full list of required inspections</Ext></p>
        </div>
      </div>
    </div>
  );
}
