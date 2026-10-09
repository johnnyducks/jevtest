import Link from "next/link";
import { Ask } from "@/components/guide/Ask";
import { FAQ, SCALE } from "@/components/guide/content";
import { PathList } from "@/components/guide/PathList";
import { aiConfigured } from "@/lib/server/ai";

export const dynamic = "force-dynamic";

export default function GuidePage() {
  return (
    <>
      <div className="hero">
        <div>
          <div className="eyebrow">Township of Moorestown · Construction Office</div>
          <h1 style={{ marginTop: 14 }}>Your home project, permitted without the guesswork.</h1>
          <p className="lede">Answer a few questions about what you&apos;re planning. We&apos;ll show you which forms, plans and inspections you need, and help you send in a complete application the first time.</p>
          <div className="row">
            <Link className="btn primary" href="/start">Plan my project</Link>
            <Link className="btn" href="/track">Check an application</Link>
          </div>
        </div>
        <div className="placard" aria-label="Example permit placard">
          <div className="ptitle">Construction Permit</div>
          <dl>
            <dt>Permit</dt><dd>Posted on site</dd>
            <dt>Code</dt><dd>N.J.A.C. 5:23 (UCC)</dd>
            <dt>Review</dt><dd>Up to 20 business days</dd>
            <dt>Closes</dt><dd>When a certificate is issued</dd>
          </dl>
          <div className="foot">Keep it in a front window while work is under way. Approved plans stay on site for every inspection.</div>
        </div>
      </div>

      <div className="home-sec">
        <div className="sechead">
          <div>
            <div className="eyebrow">The path</div>
            <h2 style={{ marginTop: 8 }}>How a permit works, start to finish</h2>
          </div>
          <p className="muted small">Seven stages. Most simple projects skip zoning and move straight to plan review. Tap a stage for details.</p>
        </div>
        <PathList />
      </div>

      <div className="home-sec">
        <div className="sechead">
          <div>
            <div className="eyebrow">Do I need a permit?</div>
            <h2 style={{ marginTop: 8 }}>It depends on the kind of work</h2>
          </div>
          <p className="muted small">New Jersey&apos;s Rehabilitation Subcode sorts work on existing homes into categories. The bigger the change, the more you&apos;ll submit.</p>
        </div>
        <div className="scale">
          {SCALE.map((s) => (
            <div key={s.name}>
              <div className="lvl"><i style={{ width: `${s.level}%` }} /></div>
              <h3>{s.name}</h3>
              <div className="cite">N.J.A.C. {s.cite}</div>
              <div className="what">{s.what}</div>
              <div className="need">{s.need}</div>
            </div>
          ))}
        </div>
        <p className="small muted" style={{ marginTop: 14 }}>
          Not sure where your project falls? <Link href="/start">Plan my project</Link> will sort it for you.
        </p>
      </div>

      {aiConfigured() && (
        <div className="home-sec">
          <div className="ask">
            <div>
              <div className="eyebrow">Ask a question</div>
              <h2 style={{ marginTop: 8 }}>Plain answers about the process</h2>
              <p className="muted" style={{ marginTop: 10 }}>Answers draw on the Township&apos;s homeowner guide. For anything specific to your property, call the office.</p>
            </div>
            <Ask />
          </div>
        </div>
      )}

      <div className="home-sec">
        <div className="sechead">
          <div>
            <div className="eyebrow">Common questions</div>
            <h2 style={{ marginTop: 8 }}>Before you start</h2>
          </div>
        </div>
        <div>
          {FAQ.map(([q, a]) => (
            <details key={q} className="faq">
              <summary>{q}</summary>
              <p>{a}</p>
            </details>
          ))}
        </div>
      </div>
    </>
  );
}
