/** Guide content: the permit path, the Rehabilitation Subcode scale and FAQs. */
import { L } from "@/lib/permits/links";
import { Ext } from "../ui";

export const PATH: { title: string; sub: string; body: React.ReactNode }[] = [
  {
    title: "Plan your project",
    sub: "Know what you're building and who's building it",
    body: (
      <>
        <p>Decide the scope, get a market-value estimate of cost, and choose whether you&apos;ll do the work or hire a licensed contractor. If you&apos;re installing equipment, keep the manufacturer&apos;s spec sheets handy.</p>
        <ul>
          <li>Single-family owner-occupants may do their own plumbing, electrical and HVAC work. Everyone else needs licensed trades.</li>
          <li>Home improvement contractors can&apos;t prepare plans unless they&apos;re licensed to.</li>
        </ul>
      </>
    ),
  },
  {
    title: "Zoning approval, if needed",
    sub: "Most exterior work; up to 10 business days",
    body: (
      <>
        <p>Decks, additions, sheds, fences, pools, generators and similar exterior work usually need zoning approval first. Zoning is a prerequisite to construction plan review. Most interior remodels skip this step.</p>
        <p style={{ marginTop: 8 }}><Ext href={L.zoning}>Zoning Office</Ext></p>
      </>
    ),
  },
  {
    title: "Apply",
    sub: "The permit jacket, technical sections and plans",
    body: (
      <>
        <p>Every application starts with the Construction Permit Application (the &ldquo;jacket&rdquo;) plus a technical section for each trade involved: building, electrical, plumbing, mechanical or fire. Add two sets of plans when the work changes layout, structure or systems.</p>
        <ul>
          <li>Write &ldquo;self&rdquo; if you are the contractor or plan preparer.</li>
          <li>Submit online through SDL or at the counter.</li>
        </ul>
      </>
    ),
  },
  {
    title: "Plan review",
    sub: "Up to 20 business days by law (N.J.A.C. 5:23-2.16)",
    body: (
      <>
        <p>The office does a quick completeness check at intake, then a full code review. Some projects also need the township engineer, Burlington County Health Department, Soil Conservation District or the floodplain administrator to sign off first.</p>
        <p style={{ marginTop: 8 }}>Most first submissions get comments, even from experienced builders. Answer each comment, revise the plans, and include a short note explaining each fix.</p>
      </>
    ),
  },
  {
    title: "Permit issued",
    sub: "Pay the fee and post the placard",
    body: (
      <>
        <p>You&apos;ll be told when the permit is approved and what the fee is. After payment you get the permit, your approved plans (keep them on site for every inspection), and a placard to post where it can be seen. Work can&apos;t start until the permit is released.</p>
        <p style={{ marginTop: 8 }}><Ext href={L.fees}>2025 fee schedule</Ext></p>
      </>
    ),
  },
  {
    title: "Inspections",
    sub: "Scheduled as work reaches each stage",
    body: (
      <>
        <p>Schedule inspections through SDL as work reaches each stage. Typical ones include footing, framing, rough electrical and plumbing, insulation, and finals. Not every inspection applies to every job.</p>
        <p style={{ marginTop: 8 }}><Ext href={L.insp}>List of required inspections</Ext></p>
      </>
    ),
  },
  {
    title: "Close the permit",
    sub: "Final inspections and your certificate",
    body: <p>When final inspections pass, the office issues a certificate. That&apos;s your proof the work meets code. Don&apos;t make a final payment to a contractor until you have it. Open permits must be closed before a home can be sold in Moorestown.</p>,
  },
];

export const SCALE = [
  { name: "Ordinary maintenance", cite: "5:23-2.7", what: "Routine fixes, replacing worn or broken parts.", need: "No permit", level: 8 },
  { name: "Repair", cite: "5:23-6.4", what: "Restoring worn materials with the same or similar ones.", need: "Sometimes a permit, rarely plans", level: 28 },
  { name: "Renovation", cite: "5:23-6.5", what: "Replacing finishes, fixtures or equipment without changing the space.", need: "Permit, usually no plans", level: 50 },
  { name: "Alteration", cite: "5:23-6.6", what: "Moving walls, adding doors or windows, extending systems, structural work.", need: "Permit and plans", level: 76 },
  { name: "Addition", cite: "5:23-6.32", what: "Adding to the building. New construction rules apply.", need: "Permit, plans and usually zoning", level: 100 },
];

export const FAQ: [string, React.ReactNode][] = [
  ["Can I do the work myself?", "Yes, if you own and live in a single-family home. New Jersey lets you do your own plumbing, electrical and HVAC work there. Given the risks, the Township recommends a licensed professional unless you're comfortable with the work."],
  ["Can I draw my own plans?", "Owners of a single-family detached home used as their private residence may prepare their own plans. Plans need to be to scale with enough detail to show code compliance. Licensed electricians and plumbers may also draw plans for their trade."],
  ["What cost do I put on the application?", "What a professional would charge for labor and materials at current market value, even if you're doing the work yourself or getting materials cheaply."],
  ["My application came back with comments. Now what?", "That's normal. Most first submissions get comments. Address each one, look up any code sections cited, revise your plans, and resubmit with a short note on how you handled each item. Call and ask for the plans examiner if a comment isn't clear."],
  ["My contractor pulled the permit. Do I need to do anything?", "Yes. It's still the owner's responsibility to confirm the permit was released before work starts, and to make sure final inspections happen and a certificate is issued."],
  ["Is my property in a flood zone?", <>Check the <Ext href={L.fema}>FEMA flood map service</Ext>. Projects in a flood hazard area need a floodplain development permit and affidavits before construction review.</>],
];
