# Moorestown Permits

A proof-of-concept residential permit portal for the Moorestown Township, NJ Construction Office, built by the Moorestown AI Task Force for Township officials to review. It sits alongside the official [SDL portal](https://www.sdlportal.com) and doesn't replace it. Submissions here are not official permit applications.

This is v2. It ports the single-file v1 prototype (`prototype/moorestown-permits.html`, described in `prototype/HANDOFF.md`) to a Next.js app and moves storage, identity and AI calls to the server. The content, rules and design are unchanged.

## Quick start

```bash
cd moorestown-permits
npm install
cp .env.example .env.local     # optional: set ANTHROPIC_API_KEY and STAFF_ACCESS_KEY
npm run dev                    # http://localhost:3000
```

It requires Node 20.9 or later. Everything works without keys except "Ask a question" and the AI review, which are hidden or disabled until `ANTHROPIC_API_KEY` is set.

| Variable | Default | Purpose |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | — | Turns on homeowner Q&A and the staff AI review |
| `ANTHROPIC_MODEL` | `claude-opus-5-5` | Model for both AI features |
| `STAFF_ACCESS_KEY` | — | Key reviewers use to sign in to `/staff`. Without it the console is open in development and off in production |
| `SESSION_SECRET` | generated | Signs the applicant and staff cookies. If unset, a random secret is saved in the data folder |
| `PERMITS_DATA_DIR` | `./.data` | Where the demo file store keeps `applications.json` |

## Pages

- **Guide** (`/`): the 7-stage permit path, the Rehabilitation Subcode scale, Ask a question and FAQs.
- **Plan my project** (`/start`): a 5-step wizard. Answers become a permit plan (category, technical sections, zoning, plans, prior approvals, documents, inspections) and then a document checklist. The draft is kept in the browser until it's submitted.
- **My applications** (`/track`): status and messages from the office, refreshed every 20 seconds.
- **Forms & contacts** (`/resources`): official links, staff, hours and phone.
- **Staff console** (`/staff`): the queue with filters and search, detail, document checklist, AI review, status updates (with an applicant message and an internal note) and example data.

## How it's built

```
src/lib/permits/   pure, shared by server and browser (unit-tested)
  plan.ts          computePlan(): answers → permit plan. Ported 1:1 from v1
  application.ts   record types, submission validation, applicant view, status updates
  projects.ts      project types, scope questions, disciplines
  status.ts        statuses, progress flow, queue filters, business days
  kb.ts            the homeowner guide summary that grounds the AI
src/lib/server/    server-only
  store.ts         ApplicationStore interface + FileStore (one JSON file)
  session.ts       applicant cookie, staff sign-in
  ai.ts            Claude calls: streamed Q&A and the structured intake review
  limit.ts         in-memory rate limits
src/app/api/       route handlers (below)
src/components/    React UI
```

| Route | Who | What |
| --- | --- | --- |
| `GET /api/status` | anyone | Whether AI is on and how staff sign in |
| `POST /api/ask` | anyone | Homeowner Q&A, streamed as plain text (10 per minute per address) |
| `GET/POST /api/applications` | applicant | List this browser's applications / submit one |
| `GET/POST/DELETE /api/staff/session` | staff | Session state / sign in / sign out |
| `GET/POST /api/staff/applications` | staff | Every application / load examples |
| `PATCH/DELETE /api/staff/applications/:ref` | staff | Status update / remove an example |
| `POST /api/staff/applications/:ref/review` | staff | Run the AI review and save it with the application |

**Trust boundaries**

- The server recomputes the permit plan from the submitted answers. It drops unknown projects, answers and documents, and caps every string.
- Applicants get a trimmed view with no owner details, internal notes, history or AI review.
- Staff routes return 401 until the reviewer signs in. Real applications can't be deleted; only examples can.

**AI.** Both calls use the Anthropic TypeScript SDK with server-side refusal fallbacks (`fallbacks: "default"`). The review uses structured outputs (a JSON schema), so the response always parses. The model sees the application without IDs, history or earlier reviews, and the reviewer makes every decision.

## What's still demo-grade

1. **Storage.** `FileStore` suits a single server only. Next step: implement `ApplicationStore` on Supabase/Postgres, with tables `applications`, `status_history`, `messages` and `documents` and row-level security. No route or UI changes are needed.
2. **Identity.** "My applications" is tied to a browser cookie, and all staff share one key. Next step: magic-link email for homeowners and a staff role per reviewer, so the history records who did what.
3. **Uploads.** Only file names are recorded. Next step: Supabase Storage, with the AI review reading the documents.
4. **Notifications.** Applicants aren't emailed when their status changes.
5. **Rules.** The Construction Office should verify `computePlan()`. Shed (200 sq ft) and fence (6 ft) exemptions and some of the siding and window guidance are hedged.
6. **SDL.** There's no integration or export path yet.

## Checks

```bash
npm test          # plan rules, validation, status flow
npm run typecheck
npm run build
```
