# Moorestown Permits — handoff to Claude Code

PoC construction permitting portal for Moorestown Township, NJ. It complements the existing SDL portal (sdlportal.com) and may one day replace it. It is a demo by the Moorestown AI Task Force, for Township officials to review.

## What exists (v1)

`moorestown-permits.html` is a single self-contained page (vanilla JS, no build step):

- **Guide**: hero, the 7-stage permit path (expandable), the NJ Rehabilitation Subcode scale (N.J.A.C. 5:23-2.7, 6.4, 6.5, 6.6, 6.32), an "Ask a question" box, and FAQs.
- **Plan my project**: a 5-step wizard (project types → scope questions → property and people → permit plan → document checklist → submit). `computePlan()` maps answers to rehab category, technical sections (Building/Electrical/Plumbing/Mechanical/Fire), zoning, plans, prior approvals, documents and inspections.
- **My applications**: status timeline per application, plus messages from the office.
- **Forms & contacts**: every official link from the Township page, plus staff, hours and phone.
- **Staff console**: a queue with filters and search, application detail, a document checklist, AI review (completeness score, missing items, classification, routing, flags, draft message to the applicant), status updates with an applicant message and internal note, and "load example applications".

Design: monotone with a subtle yellow accent. Fonts are Archivo (display), Public Sans (body) and IBM Plex Mono (data). Light and dark themes.

Sources: https://www.moorestown.nj.us/153/Construction-Office-Building-Inspections and the homeowner pamphlet (DocumentCenter/View/8821). The guide content is summarized in the `KB` constant.

## What's tied to claude.ai (needs replacing in a real app)

The page uses claude.ai artifact runtime APIs through `window.claude.use(...)`:

- `db`: stores applications at `applications/<userId>` docs with an `apps` map. **Replace** this with a real database, such as Supabase/Postgres with tables `applications`, `status_history`, `messages` and `documents`, plus row-level security (applicants see their own records; staff see everything).
- `user`: provides identity and an editor check. **Replace** it with real auth: magic-link email for homeowners and a staff role.
- `sample`: the AI calls for homeowner Q&A and the staff review. **Replace** it with a server route that calls the Anthropic API. Prompts are in `askRun()` and `runAI()`; the review returns strict JSON.

The page falls back to localStorage when those APIs are absent, so it runs as-is in any browser for demos.

## Suggested next steps

1. Scaffold the app (for example Next.js plus Supabase) and port the page into components, keeping the content and design tokens.
2. Add real file uploads (Supabase Storage). Today only filenames are recorded.
3. Add a server-side AI review endpoint, and store its output with the application.
4. Add email notifications on status changes.
5. Have the Construction Office verify the rules in `computePlan()`. Shed (200 sq ft) and fence (6 ft) exemptions and some of the siding and window guidance are hedged.
6. Explore an SDL integration or export path.
