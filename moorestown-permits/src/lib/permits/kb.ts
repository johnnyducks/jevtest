/**
 * The Township's homeowner guide, summarized. Grounds the homeowner Q&A and
 * the staff AI review. Sources: the Construction Office page and the homeowner
 * pamphlet (DocumentCenter/View/8821).
 */
export const KB = `Moorestown Township (NJ) Construction Office homeowner guide, summarized:
- Construction is governed by the NJ Uniform Construction Code (N.J.A.C. 5:23, "UCC"). Rehabilitation Subcode (5:23-6) categories: ordinary maintenance (5:23-2.7, no permit), repair (6.4, permit sometimes, plans rarely), renovation (6.5, permit typically, replacing finishes/fixtures/equipment without changing space), alteration (6.6, permit and plans typically: walls, doors/windows added or removed, extending systems, new fixtures, structural work), reconstruction (6.7, permit and plans, space can't be occupied during work), addition (6.32, current code applies, permit and plans).
- Application = Construction Permit Application "jacket" (complete boxes I, IIa, IIb; sections VI and VII best effort; write "self" for contractor/architect if applicable; sign Certification in Lieu of Oath section I as owner) plus a technical section per discipline: building, electrical, plumbing, mechanical, fire. Examples: water heater = mechanical (+electrical if electric); deck = building (+electrical if lighting); kitchen with fixture relocation = building, electrical, plumbing, fire; basement = building, electrical, fire (+plumbing if bathroom).
- Cost of work = what a professional would charge for labor and materials, even if DIY.
- Plans: two sets, to scale. Owners of single-family detached homes used exclusively as their private residence may prepare their own plans. Home improvement contractors cannot prepare plans unless licensed. NJ licensed electrical contractors may prepare electric plans; licensed plumbers may prepare plumbing plans and gas riser diagrams; licensed HVACR contractors may prepare gas piping plans. Plan types: plan view, elevation, ductwork, cross section, electric, plumbing (with water and DWV riser diagrams), mechanical/gas riser.
- Single-family homeowners may do their own plumbing, electrical, HVAC on their own dwelling; otherwise licensed persons required. Township advises hiring licensed professionals.
- Other documents may include chimney certification, Manual J and S, manufacturer cut sheets for gas appliances, kitchen exhaust hood and make-up air info, zoning application and fee.
- Most interior remodels don't need zoning; most exterior projects do. Zoning is a prior approval and can take up to 10 business days. Other prior approvals: township engineer, Burlington County Health Department, Burlington County Soil Conservation District, floodplain administrator.
- Intake: cursory completeness check when dropped off. Construction office has 20 business days to review (N.J.A.C. 5:23-2.16(a)). Deficiencies sent in writing. Most applications get rejected on first review; address each comment, include a narrative, call to speak with the plans examiner.
- Approval: notified of fee (per Township fee schedule, revised 2025); after payment receive permit, approved plans (must be on site for inspections), placard to post. Owner must verify permit is released before work starts even if contractor applied.
- Inspections per the Required Inspections list; applicant schedules them (SDL portal online). Final inspections lead to a certificate; don't make final payment to contractor until you have it. Permits stay open until a certificate is issued; open permits must be closed before a home sale (local ordinance).
- Office: Town Hall, 111 W. Second Street, 2nd floor, Moorestown NJ 08057. Phone 856-235-0912 ext. 3018. Counter 8:30am-4:30pm. Inspector phone hours roughly 8-9am and 2:30-3pm. Inspections 8:30am-2:30pm. Online: SDL portal (sdlportal.com) for submission, inspection scheduling, status, credit card payment.
- Floodplain: check FEMA map; floodplain development application, owner's and contractor's affidavits.
- Typical NJ exemptions (confirm with office): sheds 200 sq ft or less and fences 6 ft or less generally don't need a construction permit but still need zoning.`;

export const SAMPLE_QUESTIONS = [
  "Can I draw my own plans?",
  "Do I need a permit to replace my water heater?",
  "How long does review take?",
  "What if my application is rejected?",
];
