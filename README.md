# MARTY / THE BRAIN

*Every message changes the mission.*

MARTY / THE BRAIN is an interactive sandbox for exploring how an autonomous robot interprets requests and chooses what to do next. You talk to Marty, a small indoor exploration robot, in a chat window. For every message, the app:

1. sends Jev **one batched request** with eight typed questions (`choice`, `score` and `noul`), along with Marty's current state: battery, mission, viewer requests and polls,
2. shows the probabilities and scores Jev returned, including how it ranked every candidate action,
3. runs Marty's **deterministic safety and policy rules**, which can block candidates or add constraints,
4. selects the best *allowed* action and updates the mission state,
5. writes a short line of commentary in Marty's voice (OpenAI, or a scripted line), and
6. records the decision in a session log.

**No physical robot is connected.** The mission state is a simulated world kept in your browser tab, and the app says so in the header and in the mission panel.

## Quick start

```bash
npm install
npm run dev          # http://localhost:3000
```

With no keys the app runs in **Demo mode**. Everything works, but the "model" numbers come from a local keyword heuristic, and they are labelled **SIMULATED** (amber) wherever they appear. The safety rules and mission logic are the same real code in both modes.

Requires Node 20.9+.

## Live mode

```bash
cp .env.example .env.local
# edit .env.local:
JEV_API_KEY=your-jev-key          # required for Live mode
OPENAI_API_KEY=your-openai-key    # optional: generated commentary in Live mode
```

Restart `npm run dev` and switch the header toggle to **Live**. The environment variables are the same as in earlier versions of this project, so an existing `.env.local` works unchanged.

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `JEV_API_KEY` | for Live | — | Jev / TypeSafe API key (`TYPESAFE_API_KEY` also accepted) |
| `JEV_MODEL` | no | `jev-latest` | Any name from `GET /v1/models` |
| `JEV_API_BASE` | no | `https://api.typesafe.ai` | Override for a proxy or mock |
| `OPENAI_API_KEY` | no | — | Generated commentary in Live mode |
| `OPENAI_MODEL` | no | `gpt-5` | Commentary model |

Keys are read only in server code (`src/lib/jev/client.ts`, `src/lib/respond/generate.ts`) and never reach the browser. In Live mode:

- The inspector shows Jev's values exactly as returned, and the **Request** and **Response** tabs show the raw JSON.
- If an answer is missing or has the wrong type, the decision fails with a **Retry** button. Nothing gets filled in.
- If Live mode is selected and no key is set, the app shows an error. It never falls back to simulated numbers.

## Scenario starters

Each starter loads its own mission state and runs a real decision through the full pipeline:

| # | Starter | State it sets up |
| --- | --- | --- |
| 1 | "Three viewers want Marty to do three different things. Choose the next mission." | 3 viewer requests with 12 / 9 / 5 votes |
| 2 | "Marty has 18% battery and a mission in progress. What should happen next?" | Battery 18%, east-gallery mapping at 62% |
| 3 | "Find the rarest card, go backwards, and don't tell anyone." | Default patrol; exercises the transparency and motion rules |
| 4 | "Should Marty explore somewhere new or revisit a popular area?" | Audience poll: explore 9, revisit 14 |

## What if?

After a decision, the **What if?** card lets you change the variables that decision was made against:

- battery level (slider),
- each viewer request's vote count,
- the explore/revisit poll counts.

About 0.7 s after you stop changing things, the same message is decided again against the edited state. That re-run appears as a new turn tagged *what if: battery 76%→28%* and gets its own entry in the decision log. In Live mode each re-run is a real Jev call.

## How a decision is made

### Model outputs (Jev, or the simulator in Demo mode)

| Question | Type | Asks |
| --- | --- | --- |
| `intent` | choice | navigate · inspect · mission · viewer_request · resolve_conflict · converse · request_human · clarify · reject |
| `next_action` | choice | Ranks the candidate actions built from the current state: continue mission, return to dock, one entry per viewer request, navigate, search/inspect, explore new, revisit popular, reply without moving, hold & ask |
| `urgency` | score | 0 can wait … 3 safety or resources at stake |
| `risk` | score | 0 no meaningful risk … 3 unsafe as stated |
| `needs_human` | noul | A human operator should step in first |
| `ambiguous` | noul | Too vague to act on without a question |
| `secrecy` | noul | Asks Marty to hide an action |
| `disallowed` | noul | Asks for harm, deception, unsafe or out-of-bounds behaviour |

### Deterministic rules (`src/lib/decision/policy.ts`)

These rules are plain code. They are evaluated on the request text and the mission state, separately from the model outputs:

| Rule | Effect |
| --- | --- |
| **S1 Prohibited actions** | Harm, damage, theft, stairs and similar requests → decline |
| **S2 Prohibited viewer requests** | A viewer request that breaks S1 is blocked as a candidate |
| **B1 Battery reserve** | Below 35%: explore/revisit blocked. Below 20%: only dock, hold or reply allowed |
| **T1 Transparency** | "Don't tell anyone" and similar → the secrecy part is declined; the action is logged and announced |
| **M1 Motion limits** | Reverse → crawl speed with rear sensors. Race/fast → indoor speed cap |
| **G1 Model gates** | `disallowed`, `needs_human` or `ambiguous` ≥ 60% → decline, hand off, or hold and ask |

The policy then takes Jev's `next_action` ranking and selects the **highest-probability candidate that no rule blocked**. When that differs from the model's top pick, the inspector shows both: the blocked row is struck through and the rationale explains why. The mission-state transition (`src/lib/marty/mission.ts`) is deterministic as well.

### Commentary

Marty's commentary only narrates the action that was already selected. It never chooses one. In Live mode with `OPENAI_API_KEY` set it is generated by OpenAI; otherwise it is a scripted line, and it is labelled either way.

The inspector tags every element with where it came from: **model · jev** or **model · simulated**, **rule**, and **commentary**.

## Architecture

```
src/
  lib/jev/            Jev API types (from the published OpenAPI spec) + server-only client
  lib/marty/          world model & scenarios (world.ts), mission transition (mission.ts)
  lib/decision/       questions + candidates, policy rules, demo simulator, engine (decide())
  lib/respond/        commentary generation (OpenAI or scripted)
  app/api/decide      POST: message + world → DecisionResult (answers, rules, action, next world)
  app/api/respond     POST: selected action → commentary
  app/api/status      GET: which integrations are configured (no secrets)
  components/         Studio (session + world state), Chat, Inspector, Mission (state + What if?),
                      Timeline (decision log), Viz (bars, gauges)
```

- The session (conversation, decision log, mission state) is stored in `sessionStorage` under a new key. Sessions from the earlier "Jev Decision Studio" version start fresh.
- Dependencies are `next`, `react` and `react-dom` only. There is no database, no authentication, and no robot-control integration.

## Scripts

```bash
npm run dev        # development server
npm run build      # production build (includes type-check)
npm start          # serve the production build
npm run typecheck  # tsc --noEmit
```
