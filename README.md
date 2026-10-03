# MARTY.LIVE

Chat with Marty, a Moorebot Scout, and watch it decide. For example, type *"Go to Griffey."* Jev interprets the request, the target is resolved against the card catalog, A* plans a route around obstacles, and Marty follows it on an overhead map of a fictional card room. Every step appears in the mission and decision panel as it happens.

The map is a browser model of the room. No commands are sent to the physical Scout.

## Quick start

```bash
npm install
cp .env.example .env.local     # then set JEV_API_KEY
npm run dev                    # http://localhost:3000
```

Requires Node 20.9+. A Jev API key is required; without one, every request shows an error explaining that `JEV_API_KEY` is not set.

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `JEV_API_KEY` | yes | — | Jev / TypeSafe API key (`TYPESAFE_API_KEY` also accepted) |
| `JEV_MODEL` | no | `jev-latest` | Any name from `GET /v1/models` |
| `JEV_API_BASE` | no | `https://api.typesafe.ai` | Override for a proxy |
| `OPENAI_API_KEY` | no | — | Marty's chat replies, written in character (built-in lines otherwise) |
| `OPENAI_MODEL` | no | `gpt-5` | Model for Marty's replies |

Keys are read only in server code (`src/lib/jev/client.ts`, `src/lib/voice/openai.ts`) and never reach the browser. The bot icon in the header shows which model is in use and whether it is configured.

## How it works

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

### Chatting with Marty

The right-hand column is a conversation. Each message gets a reply in Marty's voice (dry, sardonic, helpful), and the reply's status chip updates live: moving, arrived, stopped, and so on. A follow-up line appears when a mission finishes. Clarification questions come with buttons for the options. **trace** under a reply opens the full decision trace for that request.

The text model never decides anything. Jev chooses the action and deterministic code resolves the target and plans the route. Marty's reply is written afterwards from those facts, and the voice prompt forbids contradicting them. Questions and chit-chat (Jev's `converse` action) get a conversational answer. The last few exchanges are passed along as context.

- With `OPENAI_API_KEY` set, replies are written by OpenAI (`OPENAI_MODEL`, default `gpt-5`). The persona lives in `src/lib/voice/openai.ts`.
- Without it, or if the call fails, Marty uses built-in lines with the same personality (`src/lib/voice/lines.ts`).
- The bot icon in the header shows which of the two is active.

Map controls:
- **Drag Marty** to choose a start position. Drops inside an obstacle's clearance zone or outside the room are refused with a reason.
- **Click a card** to send "Go to <name>". The **?** icon on the map shows both tips.
- The **gear** icon on the map holds:
  - **Stop**;
  - **Resume**, which re-plans to the stopped target from where Marty is;
  - **Reset**, which restores the default room, pose and empty log;
  - speed (0.2–1.5 m/s), heading and the clearance-zone overlay.
- Typing "Stop." always works too.

### Who decides what

| Step | Done by | Module |
| --- | --- | --- |
| Interpret the request and choose the action (`navigate_card`, `navigate_nearest`, `navigate_area`, `stop`, `converse`, `hold_and_ask`) | **Jev**, through `/api/decide` and its policy rules | `lib/decision/*` |
| Map words to a card or area (aliases, ambiguity, nearest reachable) | Deterministic code | `lib/twin/resolve.ts` |
| Plan a collision-free route | Deterministic grid A* (0.1 m cells, obstacles inflated by Marty's radius plus clearance, no corner cutting, line-of-sight smoothing) | `lib/twin/pathfinding.ts`, `grid.ts` |
| Move Marty on the map | Kinematic model: rotate in place, then drive | `lib/twin/motion.ts` |
| Lifecycle, cancellation, stale-response protection | Mission controller | `lib/twin/controller.ts` |

Each request is one batched Jev call with eight typed questions. The call carries Marty's pose, motion state and the card catalog, and Jev chooses among the navigation actions. The panel tags each item with where it came from:
- **model · jev** for the interpreted intent, the selected action and the alternatives (shown with Jev's real returned probabilities),
- **deterministic** for target resolution and route planning,
- **rule** for the E-stop, clarification answers and Resume, which never involve the model.

Mission states shown in the panel are real controller transitions with timestamps: request received → interpreting → resolving → planning → route ready → moving → arrived. Other outcomes are stopped, cancelled, needs clarification, no valid route, declined, answered and error.

### Environment

The room is 12 m × 8 m, with the origin at the bottom-left and +y pointing north. All map elements go through one world→screen transform (`lib/twin/geometry.ts`), so the map scales without touching world data. The room and card catalog are plain data in `lib/twin/environment.ts`. Each card has a stable ID, name, aliases, position, facing direction and approach point. The obstacles are a partition wall, a display table, two plinths, a low shelf, an equipment rack and a locked vault cage. The cards are Ken Griffey Jr., Rickey Henderson, Bobby Bonds, Barry Bonds, Cal Ripken Jr., Hank Aaron, Jackie Robinson, Ichiro Suzuki, Mickey Mantle and Honus Wagner (the one in the vault). Their positions are fictional.

### Future hardware

The map and panel read Marty's state only through the `PoseSource` interface in `lib/twin/motion.ts`. `SimulatedMotion` is the only implementation. A real Scout telemetry adapter could implement the same interface later without changes to the renderer or the panel. No hardware integration exists in this prototype.

## Architecture

```
src/
  lib/jev/            Jev API types (from the published OpenAPI spec) + server-only client
  lib/decision/       question set + navigation candidates, policy rules, engine (decide())
  lib/marty/          robot state used by the policy rules (battery, mission)
  lib/twin/           environment & cards, geometry/transform, occupancy grid, A*,
                      target resolution, motion (PoseSource + SimulatedMotion), mission controller
  lib/twin/__tests__  node:test suites for the above
  lib/voice/          Marty's voice: persona + OpenAI call (server), facts + built-in lines (shared)
  app/api/decide      POST: message + twin context → DecisionResult
  app/api/reply       POST: outcome facts + recent chat → Marty's reply
  app/api/status      GET: which model is configured (no secrets)
  components/         Studio (header), Popover, twin/TwinView, TwinMap (SVG), ChatLog, TwinPanel (trace + map HUD)
```

Dependencies are `next`, `react` and `react-dom` only. There is no database, no authentication and no robot-control integration.

## Scripts

```bash
npm run dev        # development server
npm run build      # production build (includes type-check)
npm start          # serve the production build
npm run typecheck  # tsc --noEmit
npm test           # pathfinding, resolution, motion and mission-controller tests (node:test, no extra deps)
```

`npm test` uses Node's built-in test runner with TypeScript type stripping, so it needs Node 22.6 or newer. The app itself runs on Node 20.9+.
