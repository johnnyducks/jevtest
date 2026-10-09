/** Official links: the Township's Document Center, SDL, FEMA and the state. */
const DC = "https://www.moorestown.nj.us/DocumentCenter/View/";

export const L = {
  app: DC + "70/Construction-Permit-Application-PDF",
  bldg: DC + "67/Building-Subcode-Technical-Section-PDF",
  plumb: DC + "74/Plumbing-Subcode-Technical-Section-PDF",
  mech: DC + "5137/Mechanical-Subcode-Technical-Section",
  fire: DC + "72/Fire-Subcode-Technical-Section-PDF",
  elec: DC + "71/Electrical-Subcode-Technical-Section-PDF",
  fees: DC + "9244/Municipal-Construction-Permit-Fee-Schedule-Revised-2025",
  checklist: DC + "6831/Construction-Permit-Checklist",
  airbar: DC + "4218/air-barrier-and-insulation-checklist-f392",
  framing: DC + "4224/framing-checklist-f390",
  insp: DC + "6691/Required-Inspections",
  smoke: DC + "7430/Smoke-Alarm--Carbon-Monoxide-Requirements",
  pool: DC + "6914/Shared-Barrier-for-Swimming-Pools-Form-",
  dispcost: DC + "7431/Disproportionate-Cost--Explanation-",
  basement: DC + "8820/Finished-Basement-Permit-Pamphlet",
  deck: DC + "6698/Residential-Decks-Permit",
  chimney: DC + "5143/Chimney-Certification",
  placard: DC + "6833/Maximum-Occupancy-Sign",
  floodapp: DC + "6863/Floodplain-Development-Permit-Application",
  ownaff: DC + "6860/Owners-Affidavit",
  conaff: DC + "6862/Contractors-Affidavit",
  sisd: DC + "6861/SISD-Application-Instructions",
  origin: DC + "8072/Project-Origination-Packet",
  devproc: DC + "8071/Development-Permit-Process",
  pamphlet: DC + "8821/Permits-for-Residential-Projects-Pamphlet",
  fema: "https://msc.fema.gov/portal/home",
  dca: "https://www.nj.gov/dca/codes/index.shtml",
  zoning: "https://www.moorestown.nj.us/155/Zoning-Office",
  office: "https://www.moorestown.nj.us/153/Construction-Office-Building-Inspections",
  sdlSignup: "https://www.sdlportal.com/signup",
  sdlLogin: "https://www.sdlportal.com/login",
  sdl1: "https://help.getsdl.com/intro-to-the-online-plan-review-opr-process",
  sdl2: "https://help.getsdl.com/opr-managing-your-submission-and-tasks",
  sdl3: "https://help.getsdl.com/opr-for-citizens-handling-denials-and-correcting-markups",
} as const;

export type LinkKey = keyof typeof L;

export const OFFICE_PHONE = "856-235-0912 ext. 3018";
