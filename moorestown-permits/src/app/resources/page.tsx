import type { Metadata } from "next";
import { L } from "@/lib/permits/links";

export const metadata: Metadata = { title: "Forms & contacts · Moorestown Permits" };

const RES: [string, [string, string, string][]][] = [
  ["Apply", [["Construction Permit Application", L.app, "PDF"], ["Building technical section", L.bldg, "PDF"], ["Electrical technical section", L.elec, "PDF"], ["Plumbing technical section", L.plumb, "PDF"], ["Mechanical technical section", L.mech, "PDF"], ["Fire technical section", L.fire, "PDF"], ["Fee schedule (revised 2025)", L.fees, "PDF"], ["Construction permit checklist", L.checklist, "PDF"]]],
  ["Guides & checklists", [["Homeowner's guide to permits", L.pamphlet, "PDF"], ["Residential deck guide", L.deck, "PDF"], ["Finished basement guide", L.basement, "PDF"], ["Required inspections", L.insp, "PDF"], ["Framing checklist", L.framing, "PDF"], ["Air barrier & insulation checklist", L.airbar, "PDF"], ["Smoke & CO alarm requirements", L.smoke, "PDF"], ["Chimney certification", L.chimney, "PDF"], ["Shared pool barrier form", L.pool, "PDF"], ["Disproportionate cost explanation", L.dispcost, "PDF"], ["Occupancy placard", L.placard, "PDF"]]],
  ["Flood zones", [["Check the FEMA flood map", L.fema, "Web"], ["Floodplain development application", L.floodapp, "PDF"], ["Owner's affidavit", L.ownaff, "PDF"], ["Contractor's affidavit", L.conaff, "PDF"], ["Substantial improvement instructions", L.sisd, "PDF"], ["Project origination packet", L.origin, "PDF"], ["Development permit process", L.devproc, "PDF"]]],
  ["Online filing (SDL)", [["Create an SDL account", L.sdlSignup, "Web"], ["Sign in to SDL", L.sdlLogin, "Web"], ["Online plan review: getting started", L.sdl1, "Help"], ["Managing your submission", L.sdl2, "Help"], ["Handling denials and markups", L.sdl3, "Help"], ["Zoning Office", L.zoning, "Web"], ["NJ Division of Codes & Standards", L.dca, "Web"], ["Construction Office page", L.office, "Web"]]],
];

const STAFF = [
  ["Joseph LaRocca", "Construction Official; Fire & Plumbing Subcode Official", "jlarocca"],
  ["David Burd", "Building Subcode Official", "dburd"],
  ["Dennis Murt", "Electrical Subcode Official", "dmurt"],
  ["Mark Sorey", "Plumbing Subcode Official & Mechanical Inspector", "MSorey"],
  ["Alicia Marshall", "Technical Assistant to the Construction Official", "amarshall"],
  ["Mary Matlack", "Technical Assistant", "mmatlack"],
  ["Geoff Maleson", "Inspector", "gmaleson"],
  ["Anthony Piccioni", "Inspector", "apiccioni"],
  ["Joseph Dougherty", "Inspector", "JDougherty"],
  ["Robert Rowe", "Plumbing & Mechanical Inspector", "rrowe"],
];

export default function ResourcesPage() {
  return (
    <>
      <div className="sechead">
        <div>
          <div className="eyebrow">Forms &amp; contacts</div>
          <h2 style={{ marginTop: 8 }}>Everything in one place</h2>
        </div>
        <p className="muted small">Links open the Township&apos;s official documents.</p>
      </div>
      <div className="res">
        {RES.map(([group, items]) => (
          <div key={group}>
            <h3>{group}</h3>
            <ul>
              {items.map(([name, href, kind]) => (
                <li key={name}>
                  <a href={href} target="_blank" rel="noopener"><span>{name}</span><span className="k">{kind}</span></a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="home-sec" id="contact">
        <div className="sechead">
          <div>
            <div className="eyebrow">Contact</div>
            <h2 style={{ marginTop: 8 }}>Construction Office</h2>
          </div>
        </div>
        <div className="office">
          <div><div className="k">Visit</div>Town Hall, 2nd floor<br />111 W. Second Street<br />Moorestown, NJ 08057</div>
          <div><div className="k">Call</div><span className="mono" style={{ userSelect: "all" }}>856-235-0912</span> ext. 3018<br /><span className="muted small">Fax 856-914-3019</span></div>
          <div><div className="k">Counter hours</div>8:30 a.m. – 4:30 p.m.<br /><span className="muted small">Inspectors take calls about 8–9 a.m. and 2:30–3 p.m.</span></div>
          <div><div className="k">Inspections</div>8:30 a.m. – 2:30 p.m. daily<br /><span className="muted small">Schedule through SDL</span></div>
        </div>
        <div className="staff" style={{ marginTop: 28 }}>
          {STAFF.map(([name, role, user]) => (
            <div key={user}><b>{name}</b><span>{role}</span><code>{user}@moorestown.nj.us</code></div>
          ))}
        </div>
      </div>
    </>
  );
}
