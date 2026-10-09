import assert from "node:assert/strict";
import test from "node:test";
import { applyStatusUpdate, makeRef, newApplication, parseStatusUpdate, parseSubmission, readiness, toApplicantView } from "../application.ts";
import { exampleApplications } from "../examples.ts";
import { bizDays, flow, flowIndex, matchesFilter } from "../status.ts";

const good = {
  projects: ["deck", "not-a-project"],
  answers: { ownerOcc: "Yes", doer: "Me", plansBy: "Me", electric: "No", flood: "Maybe", bogus: "Yes" },
  description: "  New deck  ",
  cost: "9000",
  address: "1 Main St, Moorestown",
  owner: { name: "Pat", email: "pat@example.com", phone: "" },
  contractor: "Should be dropped",
  docs: { plans: { ready: false, files: ["deck.pdf"] }, nope: { ready: true, files: [] } },
};

test("a valid submission is cleaned: unknown projects, answers and documents are dropped", () => {
  const r = parseSubmission(good);
  assert.ok(r.ok);
  const v = r.value;
  assert.deepEqual(v.projects, ["deck"]);
  assert.equal(v.answers.flood, undefined);
  assert.equal(v.answers.bogus, undefined);
  assert.equal(v.answers.electric, "No");
  assert.equal(v.description, "New deck");
  assert.equal(v.cost, 9000);
  assert.equal(v.contractor, "", "contractor is cleared when the owner does the work");
  assert.deepEqual(v.docs, { plans: { ready: true, files: ["deck.pdf"] } }, "an attached file marks the item ready");
});

test("submissions without contact details or projects are refused", () => {
  assert.equal(parseSubmission({ ...good, projects: [] }).ok, false);
  assert.equal(parseSubmission({ ...good, owner: { ...good.owner, email: "nope" } }).ok, false);
  assert.equal(parseSubmission({ ...good, address: " " }).ok, false);
  assert.equal(parseSubmission({ ...good, cost: "-5" }).ok, false);
  assert.equal(parseSubmission(null).ok, false);
});

test("the plan is computed on the server from the answers", () => {
  const r = parseSubmission(good);
  assert.ok(r.ok);
  const a = newApplication(r.value, "u1", "MT-26-ABCD", 1000);
  assert.equal(a.plan.zoning, "yes");
  assert.equal(a.status, "received");
  assert.deepEqual(readiness(a), [1, a.plan.docs.length]);
});

test("the applicant view leaves out internal notes and AI review", () => {
  const [ex] = exampleApplications(0);
  const view = toApplicantView({ ...ex, history: [{ at: 1, status: "review", by: "staff", note: "secret" }] });
  assert.equal(JSON.stringify(view).includes("secret"), false);
  assert.equal("owner" in view, false);
  assert.equal("history" in view, false);
});

test("status updates append history and messages; empty updates are refused", () => {
  const [ex] = exampleApplications(0);
  assert.equal(applyStatusUpdate(ex, { status: ex.status, message: "", note: "" }, 5), null);
  const u = parseStatusUpdate({ status: "info", message: "Please send plans.", note: "called" });
  assert.ok(u.ok);
  const next = applyStatusUpdate(ex, u.value, 5)!;
  assert.equal(next.status, "info");
  assert.deepEqual(next.messages.at(-1), { at: 5, text: "Please send plans." });
  assert.deepEqual(next.history.at(-1), { at: 5, status: "info", by: "staff", note: "called" });
  assert.equal(parseStatusUpdate({ status: "bogus" }).ok, false);
});

test("refs look like MT-YY-XXXX", () => {
  assert.match(makeRef(new Date("2026-03-01")), /^MT-26-[A-HJ-NP-Z2-9]{4}$/);
});

test("the progress flow includes zoning only when required, and 'needs input' sits on plan review", () => {
  assert.ok(flow("yes").includes("zoning"));
  assert.ok(!flow("check").includes("zoning"));
  const f = flow("no");
  assert.equal(flowIndex(f, "info"), f.indexOf("review"));
});

test("queue filters", () => {
  assert.equal(matchesFilter("issued", "open"), false);
  assert.equal(matchesFilter("screening", "new"), true);
  assert.equal(matchesFilter("closed", "done"), true);
});

test("business days skip weekends", () => {
  const fri = new Date(2026, 9, 9, 12).getTime(); // Friday
  const mon = new Date(2026, 9, 12, 12).getTime();
  const tue = new Date(2026, 9, 13, 12).getTime();
  assert.equal(bizDays(fri, mon), 1);
  assert.equal(bizDays(fri, tue), 2);
  assert.equal(bizDays(fri, fri), 0);
});
