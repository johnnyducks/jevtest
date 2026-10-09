/** Clearly marked example applications for trying the staff console. Pure. */
import { type Application, newApplication, type Submission } from "./application.ts";

type Example = Pick<Submission, "projects" | "answers" | "description" | "cost" | "contractor" | "docs"> & {
  ref: string;
  daysAgo: number;
  who: "A" | "B" | "C";
};

const EXAMPLES: Example[] = [
  {
    ref: "MT-EX-K1TC",
    daysAgo: 2,
    who: "A",
    projects: ["kitchen"],
    answers: { ownerOcc: "Yes", doer: "A contractor", plansBy: "Me", walls: "Yes", openings: "No", structural: "Not sure", plumbing: "Yes", electric: "Yes", gas: "Yes", flood: "No" },
    description: "Open the wall between kitchen and dining room, move sink to a new island, new gas range and hood, add under-cabinet lighting.",
    cost: 38000,
    contractor: "Example Remodeling LLC",
    docs: { jacket: { ready: true, files: ["permit-jacket.pdf"] }, "tech-B": { ready: true, files: [] }, "tech-E": { ready: true, files: [] } },
  },
  {
    ref: "MT-EX-D4KR",
    daysAgo: 6,
    who: "B",
    projects: ["deck"],
    answers: { ownerOcc: "Yes", doer: "Me", plansBy: "Me", electric: "No", flood: "Not sure" },
    description: "New 14x16 pressure-treated deck off the back slider, about 30 inches above grade.",
    cost: 9000,
    contractor: "",
    docs: {
      jacket: { ready: true, files: [] },
      "tech-B": { ready: true, files: [] },
      zoning: { ready: true, files: [] },
      plans: { ready: true, files: ["deck-plan.pdf", "deck-section.pdf"] },
      survey: { ready: true, files: ["survey-marked.pdf"] },
    },
  },
  {
    ref: "MT-EX-W8HP",
    daysAgo: 1,
    who: "C",
    projects: ["waterheater"],
    answers: { ownerOcc: "No", doer: "Me", plansBy: "None needed", gas: "Yes", flood: "No" },
    description: "Replace 50-gallon gas water heater in the same location. Rental property.",
    cost: 1200,
    contractor: "",
    docs: { jacket: { ready: true, files: [] }, "tech-P": { ready: true, files: [] }, "tech-M": { ready: true, files: [] } },
  },
];

export function exampleApplications(now: number = Date.now()): Application[] {
  return EXAMPLES.map((e) => {
    const at = now - e.daysAgo * 864e5;
    const sub: Submission = {
      ...e,
      address: `Example address ${e.who}, Moorestown`,
      blocklot: "",
      owner: { name: `Example Applicant ${e.who}`, email: `applicant-${e.who.toLowerCase()}@example.com`, phone: "" },
    };
    return { ...newApplication(sub, "examples", e.ref, at), example: true };
  });
}
