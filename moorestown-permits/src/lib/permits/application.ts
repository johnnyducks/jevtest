/**
 * The application record: what a homeowner submits, what staff add to it, and
 * the trimmed view an applicant gets back. Submissions are validated here and
 * the permit plan is recomputed from the answers, so the server never trusts
 * a plan sent by the browser. Shared by server and browser; pure.
 */
import { computePlan } from "./plan.ts";
import { ANSWERS, PEOPLE_QUESTIONS, PN, QUESTIONS, type Discipline } from "./projects.ts";
import { isStatus, type Status } from "./status.ts";

export interface DocStatus {
  ready: boolean;
  /** File names only for now; uploads come with real storage. */
  files: string[];
}

export interface PlanSummary {
  permit: boolean;
  clsName: string;
  disc: Discipline[];
  zoning: "yes" | "check" | "no";
  plans: boolean;
  prior: string[];
  docs: { id: string; n: string }[];
}

export interface HistoryEntry {
  at: number;
  status: Status;
  by: "applicant" | "staff";
  /** Internal note, staff only. */
  note?: string;
}

export interface OfficeMessage {
  at: number;
  text: string;
}

export interface AiReview {
  at: number;
  model: string;
  completeness: number;
  summary: string;
  rehabCategory: string;
  rehabCite: string;
  disciplines: string[];
  priorApprovals: string[];
  routeTo: string;
  missing: { item: string; why: string }[];
  flags: string[];
  nextStep: string;
  suggestedStatus: "screening" | "zoning" | "review" | "info";
  messageToApplicant: string;
}

export interface Owner {
  name: string;
  email: string;
  phone: string;
}

export interface Application {
  ref: string;
  /** Who submitted it (applicant id). "examples" for sample data. */
  ownerId: string;
  createdAt: number;
  updatedAt: number;
  owner: Owner;
  address: string;
  blocklot: string;
  projects: string[];
  answers: Record<string, string>;
  description: string;
  cost: number | null;
  contractor: string;
  plan: PlanSummary;
  docs: Record<string, DocStatus>;
  status: Status;
  history: HistoryEntry[];
  messages: OfficeMessage[];
  ai?: AiReview;
  example?: boolean;
}

/** What the applicant sees: no internal notes, no AI review. */
export interface ApplicantView {
  ref: string;
  createdAt: number;
  address: string;
  projects: string[];
  plan: PlanSummary;
  status: Status;
  messages: OfficeMessage[];
}

export const toApplicantView = (a: Application): ApplicantView => ({
  ref: a.ref,
  createdAt: a.createdAt,
  address: a.address,
  projects: a.projects,
  plan: a.plan,
  status: a.status,
  messages: a.messages,
});

export function summarizePlan(projects: string[], answers: Record<string, string>): PlanSummary {
  const p = computePlan({ projects, answers });
  return {
    permit: p.permit,
    clsName: p.clsName,
    disc: p.disc,
    zoning: p.zoning,
    plans: p.plans,
    prior: p.prior.map((x) => x.who),
    docs: p.docs.map((d) => ({ id: d.id, n: d.n })),
  };
}

/** Documents marked ready, out of those the plan asks for. */
export function readiness(a: Pick<Application, "plan" | "docs">): [ready: number, total: number] {
  const docs = a.plan.docs;
  return [docs.filter((d) => a.docs[d.id]?.ready).length, docs.length];
}

const REF_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function makeRef(now = new Date(), rand: () => number = Math.random): string {
  let s = "";
  for (let i = 0; i < 4; i++) s += REF_CHARS[Math.floor(rand() * REF_CHARS.length)];
  return `MT-${String(now.getFullYear()).slice(2)}-${s}`;
}

/* ---------- Submission ---------- */

/** What the wizard sends. */
export interface Submission {
  projects: string[];
  answers: Record<string, string>;
  description: string;
  cost: number | null;
  address: string;
  blocklot: string;
  owner: Owner;
  contractor: string;
  docs: Record<string, DocStatus>;
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

export function parseSubmission(body: unknown): Parsed<Submission> {
  if (!body || typeof body !== "object") return { ok: false, error: "Send the application as JSON." };
  const b = body as Record<string, unknown>;

  const projects = Array.isArray(b.projects) ? [...new Set(b.projects.filter((p): p is string => typeof p === "string" && p in PN))] : [];
  if (!projects.length) return { ok: false, error: "Choose at least one project." };

  const rawAnswers = b.answers && typeof b.answers === "object" ? (b.answers as Record<string, unknown>) : {};
  const answers: Record<string, string> = {};
  for (const q of QUESTIONS) {
    const v = rawAnswers[q.k];
    if (typeof v === "string" && (ANSWERS as string[]).includes(v)) answers[q.k] = v;
  }
  for (const [k, opts] of Object.entries(PEOPLE_QUESTIONS)) {
    const v = rawAnswers[k];
    answers[k] = typeof v === "string" && (opts as readonly string[]).includes(v) ? v : opts[0];
  }

  const rawOwner = b.owner && typeof b.owner === "object" ? (b.owner as Record<string, unknown>) : {};
  const owner: Owner = { name: str(rawOwner.name, 120), email: str(rawOwner.email, 200), phone: str(rawOwner.phone, 40) };
  const address = str(b.address, 200);
  if (!address || !owner.name || !EMAIL_RE.test(owner.email)) {
    return { ok: false, error: "Add the property address, owner's name and an email so the office can reach you." };
  }

  let cost: number | null = null;
  if (b.cost !== null && b.cost !== undefined && b.cost !== "") {
    const n = Number(b.cost);
    if (!Number.isFinite(n) || n < 0 || n > 1e9) return { ok: false, error: "Enter the estimated cost as a number of dollars." };
    cost = Math.round(n);
  }

  const plan = summarizePlan(projects, answers);
  const rawDocs = b.docs && typeof b.docs === "object" ? (b.docs as Record<string, unknown>) : {};
  const docs: Record<string, DocStatus> = {};
  for (const d of plan.docs) {
    const v = rawDocs[d.id];
    if (!v || typeof v !== "object") continue;
    const o = v as Record<string, unknown>;
    const files = Array.isArray(o.files) ? o.files.map((f) => str(f, 200)).filter(Boolean).slice(0, 20) : [];
    docs[d.id] = { ready: o.ready === true || files.length > 0, files };
  }

  return {
    ok: true,
    value: {
      projects,
      answers,
      description: str(b.description, 4000),
      cost,
      address,
      blocklot: str(b.blocklot, 80),
      owner,
      contractor: answers.doer === "Me" ? "" : str(b.contractor, 160),
      docs,
    },
  };
}

export function newApplication(s: Submission, ownerId: string, ref: string, now: number): Application {
  return {
    ref,
    ownerId,
    createdAt: now,
    updatedAt: now,
    owner: s.owner,
    address: s.address,
    blocklot: s.blocklot,
    projects: s.projects,
    answers: s.answers,
    description: s.description,
    cost: s.cost,
    contractor: s.contractor,
    plan: summarizePlan(s.projects, s.answers),
    docs: s.docs,
    status: "received",
    history: [{ at: now, status: "received", by: "applicant" }],
    messages: [],
  };
}

/* ---------- Staff status update ---------- */

export interface StatusUpdate {
  status: Status;
  message: string;
  note: string;
}

export function parseStatusUpdate(body: unknown): Parsed<StatusUpdate> {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  if (!isStatus(b.status)) return { ok: false, error: "Pick a valid status." };
  return { ok: true, value: { status: b.status, message: str(b.message, 2000), note: str(b.note, 500) } };
}

/** Returns null when the update changes nothing. */
export function applyStatusUpdate(a: Application, u: StatusUpdate, now: number): Application | null {
  if (u.status === a.status && !u.message && !u.note) return null;
  const entry: HistoryEntry = { at: now, status: u.status, by: "staff" };
  if (u.note) entry.note = u.note;
  return {
    ...a,
    status: u.status,
    updatedAt: now,
    history: [...a.history, entry],
    messages: u.message ? [...a.messages, { at: now, text: u.message }] : a.messages,
  };
}
