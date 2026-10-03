# MARTY / THE BRAIN

*Every message changes the mission.*

MARTY / THE BRAIN shows how a structured decision engine (Jev) could drive a small robot: Marty, a Moorebot Scout. It has two workspaces, switched from the header:

- **Twin (default):** an interactive overhead 2D digital twin of a fictional card room. Type *"Go to Griffey."* and watch the full chain happen: Jev interprets the request, the target is resolved against the card catalog, A* plans a route around obstacles, and Marty follows it on the map. Each step appears in the mission and decision panel as it happens.
- **Brain lab:** the earlier decision sandbox (chat, scenario starters, What if? controls and the full decision inspector), unchanged.

**Everything is a browser simulation.** No commands are sent to a physical Scout, and Marty's position on the map is never live telemetry. The UI says so in the header ("NO ROBOT LINKED") and on the map ("SIMULATION · not live Scout telemetry").

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

## The digital twin

### What you can do

| Try | What happens |
| --- | --- |
| "Go to Griffey." | Ken Griffey Jr. is resolved, a route is planned around the display table and partition wall, Marty drives there, and the mission ends **Arrived** |
| "Take me to Rickey Henderson." | Full-name match, with a detour around the table |
| "Go to Bonds." | Two Bonds cards exist, so Marty asks **which one** and doesn't move. Click a choice or type "Bobby" |
| "Visit the nearest card." | Nearest card by *route length*, ignoring unreachable cards |
| "Go to the other side of the room." | Your position mirrored across the room, snapped to reachable free space |
| "Go to Honus Wagner." | The card sits in a locked vault, so the result is **No valid route** and Marty stays put |
| "Stop." | Deterministic E-stop: halts immediately without waiting for the decision engine |
| A new destination while moving | The old mission is **cancelled** and a new route is planned from Marty's current position |

Map controls:
- **Drag Marty** to choose a start position. Drops inside an obstacle's clearance zone or outside the room are refused with a reason.
- **⟲/⟳** adjust the heading.
- **Speed** sets the simulated speed (0.2–1.5 m/s).
- **Clearance zones** shows or hides the inflated obstacles.
- **Click a card** to send "Go to <name>".
- **Stop**, **Resume** (re-plans to the stopped target from where Marty is) and **Reset** (restores the default room, pose and empty log).

### Who decides what

| Step | Done by | Module |
| --- | --- | --- |
| Interpret the request and choose the action (`navigate_card`, `navigate_nearest`, `navigate_area`, `stop`, `converse`, `hold_and_ask`) | **Jev** in Live mode, or the labelled demo simulator, through the existing `/api/decide` route and its existing rules | `lib/decision/*` |
| Map words to a card or area (aliases, ambiguity, nearest reachable) | Deterministic code | `lib/twin/resolve.ts` |
| Plan a collision-free route | Deterministic grid A* (0.1 m cells, obstacles inflated by Marty's radius plus clearance, no corner cutting, line-of-sight smoothing) | `lib/twin/pathfinding.ts`, `grid.ts` |
| Move the robot | Simulated kinematics: rotate in place, then drive | `lib/twin/motion.ts` |
| Lifecycle, cancellation, stale-response protection | Mission controller | `lib/twin/controller.ts` |

The twin does not add a second decision engine. It calls the same `/api/decide` route with an extra `twin` context: pose, motion state and the card catalog. The engine then offers Jev navigation candidates instead of the sandbox ones, in the same single batched request of eight typed questions. The panel tags each item with where it came from:
- **model · jev** or **model · simulated** for the interpreted intent, the selected action and the alternatives (shown with Jev's real returned probabilities),
- **deterministic** for target resolution and route planning,
- **rule** for the E-stop, clarification answers and Resume, which never involve the model.

Mission states shown in the panel are real controller transitions with timestamps: request received → interpreting → resolving → planning → route ready → moving → arrived. Other outcomes are stopped, cancelled, needs clarification, no valid route, declined, answered and error.

### Environment

The room is 12 m × 8 m, with the origin at the bottom-left and +y pointing north. All map elements go through one world→screen transform (`lib/twin/geometry.ts`), so the map scales without touching world data. The room and card catalog are plain data in `lib/twin/environment.ts`. Each card has a stable ID, name, aliases, position, facing direction and approach point. The obstacles are a partition wall, a display table, two plinths, a low shelf, an equipment rack and a locked vault cage. The cards are Ken Griffey Jr., Rickey Henderson, Bobby Bonds, Barry Bonds, Cal Ripken Jr., Hank Aaron, Jackie Robinson, Ichiro Suzuki, Mickey Mantle and Honus Wagner (the one in the vault). Their positions are fictional.

### Future hardware

The map and panel read Marty's state only through the `PoseSource` interface in `lib/twin/motion.ts`. `SimulatedMotion` is the only implementation. A real Scout telemetry adapter could implement the same interface later without changes to the renderer or the panel. No hardware integration exists in this prototype.

## Brain lab

### Scenario starters

Each starter loads its own mission state and runs a real decision through the full pipeline:

| # | Starter | State it sets up |
| --- | --- | --- |
| 1 | "Three viewers want Marty to do three different things. Choose the next mission." | 3 viewer requests with 12 / 9 / 5 votes |
| 2 | "Marty has 18% battery and a mission in progress. What should happen next?" | Battery 18%, east-gallery mapping at 62% |
| 3 | "Find the rarest card, go backwards, and don't tell anyone." | Default patrol; exercises the transparency and motion rules |
| 4 | "Should Marty explore somewhere new or revisit a popular area?" | Audience poll: explore 9, revisit 14 |

### What if?

After a decision, the **What if?** card lets you change the variables that decision was made against:

- battery level (slider),
- each viewer request's vote count,
- the explore/revisit poll counts.

About 0.7 s after you stop changing things, the same message is decided again against the edited state. That re-run appears as a new turn tagged *what if: battery 76%→28%* and gets its own entry in the decision log. In Live mode each re-run is a real Jev call.

### How a decision is made

#### Model outputs (Jev, or the simulator in Demo mode)

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

#### Deterministic rules (`src/lib/decision/policy.ts`)

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

#### Commentary

Marty's commentary only narrates the action that was already selected. It never chooses one. In Live mode with `OPENAI_API_KEY` set it is generated by OpenAI; otherwise it is a scripted line, and it is labelled either way.

The inspector tags every element with where it came from: **model · jev** or **model · simulated**, **rule**, and **commentary**.

## Architecture

```
src/
  lib/jev/            Jev API types (from the published OpenAPI spec) + server-only client
  lib/decision/       questions + candidates (sandbox and twin), policy rules, demo simulator, engine
  lib/respond/        Brain lab commentary (OpenAI or scripted)
  lib/marty/          Brain lab world model & scenarios
  lib/twin/           environment & cards, geometry/transform, occupancy grid, A*,
                      target resolution, motion (PoseSource + SimulatedMotion), mission controller
  lib/twin/__tests__  node:test suites for the above
  app/api/decide      POST: message + world (+ twin context) → DecisionResult
  app/api/respond     POST: selected action → commentary
  app/api/status      GET: which integrations are configured (no secrets)
  components/twin/    TwinView (wiring), TwinMap (SVG renderer), TwinPanel (mission & decision trace)
  components/         Studio (header + workspaces), Brain lab: Chat, Inspector, Mission, Timeline, Viz
```

- The Brain lab session is stored in `sessionStorage`. The twin always starts from its defined defaults.
- Dependencies are `next`, `react` and `react-dom` only. There is no database, no authentication and no robot-control integration.

## Scripts

```bash
npm run dev        # development server
npm run build      # production build (includes type-check)
npm start          # serve the production build
npm run typecheck  # tsc --noEmit
npm test           # pathfinding, resolution, motion and mission-controller tests (node:test, no extra deps)
```

`npm test` uses Node's built-in test runner with TypeScript type stripping, so it needs Node 22.6 or newer. The app itself runs on Node 20.9+.
