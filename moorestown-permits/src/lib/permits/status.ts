/** Application statuses, the progress flow and the staff queue filters. Pure. */

export const STATUSES = [
  ["received", "Received"],
  ["screening", "Completeness check"],
  ["zoning", "Zoning review"],
  ["review", "Plan review"],
  ["info", "Needs your input"],
  ["approved", "Approved, ready to pay"],
  ["issued", "Permit issued"],
  ["inspections", "Inspections"],
  ["closed", "Closed"],
] as const;

export type Status = (typeof STATUSES)[number][0];

export const STATUS_NAME: Record<Status, string> = Object.fromEntries(STATUSES) as Record<Status, string>;

export const isStatus = (s: unknown): s is Status => typeof s === "string" && s in STATUS_NAME;

/** Pill colour for a status. */
export function statusTone(s: Status): "" | "y" | "ok" | "bad" {
  if (s === "info") return "bad";
  if (s === "closed" || s === "issued" || s === "approved") return "ok";
  if (s === "received") return "y";
  return "";
}

/** The steps an application moves through; zoning only when it needs it. */
export function flow(zoning: string | undefined): Status[] {
  return ["received", "screening", ...(zoning === "yes" ? (["zoning"] as const) : []), "review", "approved", "issued", "inspections", "closed"];
}

/** Index of the current step in `flow`. "Needs your input" sits on plan review. */
export function flowIndex(steps: Status[], status: Status): number {
  return steps.indexOf(status === "info" ? "review" : status);
}

export const FILTERS = [
  ["open", "Open"],
  ["new", "New"],
  ["info", "Waiting on applicant"],
  ["done", "Issued & closed"],
  ["all", "All"],
] as const;

export type QueueFilter = (typeof FILTERS)[number][0];

const DONE: Status[] = ["issued", "inspections", "closed"];

export function matchesFilter(status: Status, f: QueueFilter): boolean {
  switch (f) {
    case "open": return !DONE.includes(status);
    case "new": return status === "received" || status === "screening";
    case "info": return status === "info";
    case "done": return DONE.includes(status);
    case "all": return true;
  }
}

/** Business days (Mon–Fri) elapsed since `from`. Holidays aren't counted. */
export function bizDays(from: number, now: number = Date.now()): number {
  const d = new Date(from);
  let n = 0;
  for (;;) {
    d.setDate(d.getDate() + 1);
    if (d.getTime() > now) return n;
    const w = d.getDay();
    if (w !== 0 && w !== 6) n++;
  }
}
