"use client";

import type { AiReview } from "@/lib/permits/application";
import { STATUS_NAME } from "@/lib/permits/status";
import { fmtDate, Spinner } from "../ui";

export function AiPanel({ ai, enabled, busy, onRun, onUse }: {
  ai: AiReview | undefined;
  enabled: boolean;
  busy: boolean;
  onRun: () => void;
  onUse: (r: AiReview) => void;
}) {
  return (
    <div className="ai">
      <div className="aih">
        <div>
          <h3>AI review assistant</h3>
          <div className="muted small">Checks completeness, classifies the work and drafts next steps. A reviewer makes every decision.</div>
        </div>
        <button className="btn dark sm" disabled={!enabled || busy} onClick={onRun}>
          {busy ? <><Spinner /> Reviewing</> : ai ? "Run again" : "Run review"}
        </button>
      </div>
      <div className="aib">
        {ai ? <Review x={ai} onUse={onUse} /> : (
          <p className="muted small">
            {enabled
              ? "Run a review to get a completeness score, missing items, the likely rehab category, routing and a draft message to the applicant."
              : "AI review isn't set up on this server. Add ANTHROPIC_API_KEY to turn it on."}
          </p>
        )}
      </div>
    </div>
  );
}

function Review({ x, onUse }: { x: AiReview; onUse: (r: AiReview) => void }) {
  return (
    <>
      <div className="meter"><b>{x.completeness}</b><div className="track"><i style={{ width: `${x.completeness}%` }} /></div><span className="muted small">completeness</span></div>
      <p>{x.summary}</p>
      <div className="grid2">
        <div>
          <div className="eyebrow" style={{ marginBottom: 8 }}>Classification</div>
          <p className="small">{x.rehabCategory}{x.rehabCite && <> <span className="mono muted">({x.rehabCite})</span></>}</p>
          <div className="disc" style={{ marginTop: 8 }}>{x.disciplines.map((d) => <span key={d} className="pill">{d}</span>)}</div>
        </div>
        <div>
          <div className="eyebrow" style={{ marginBottom: 8 }}>Route to</div>
          <p className="small"><b>{x.routeTo}</b></p>
          {x.priorApprovals.length > 0 && <p className="small muted" style={{ marginTop: 4 }}>Prior approvals: {x.priorApprovals.join(", ")}</p>}
        </div>
      </div>
      {x.missing.length > 0 && (
        <div>
          <div className="eyebrow" style={{ marginBottom: 8 }}>Missing or unclear</div>
          <ul>{x.missing.map((m, i) => <li key={i}><b>{m.item}</b>{m.why && <> · <span className="muted">{m.why}</span></>}</li>)}</ul>
        </div>
      )}
      {x.flags.length > 0 && (
        <div>
          <div className="eyebrow" style={{ marginBottom: 8 }}>Reviewer flags</div>
          <ul>{x.flags.map((f, i) => <li key={i}>{f}</li>)}</ul>
        </div>
      )}
      <div><div className="eyebrow" style={{ marginBottom: 8 }}>Recommended next step</div><p className="small">{x.nextStep}</p></div>
      {x.messageToApplicant && (
        <div>
          <div className="eyebrow" style={{ marginBottom: 8 }}>Draft message to applicant</div>
          <div className="draft">{x.messageToApplicant}</div>
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn sm" onClick={() => onUse(x)}>Use suggestion{STATUS_NAME[x.suggestedStatus] ? `: ${STATUS_NAME[x.suggestedStatus]}` : ""}</button>
          </div>
        </div>
      )}
      <p className="muted small mono">Reviewed {fmtDate(x.at)}</p>
    </>
  );
}
