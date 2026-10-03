# MARTY.LIVE

A live show starring Marty, a Moorebot Scout, in a fictional room full of baseball cards. Many people can watch at once. Each viewer picks a **@handle** and chats requests: *"Go to Griffey"*, *"Ripken, then Bonds, then Mantle"*, *"go around the display table"*, *"go upstairs"*. Jev, the decision engine, reads everyone's messages together and decides what Marty does next. Hard safety rules can veto its pick. Marty explains the decision in chat and drives the route on an overhead map. His battery drains with every meter, and the viewer who sent him earns the card's points.

The map is a simulation that runs on the server. No commands are sent to the physical Scout.

## Quick start

```bash
npm install
cp .env.example .env.local     # then set JEV_API_KEY
npm run dev                    # http://localhost:3000
```

Requires Node 20.9+. A Jev API key is required. Without one, Marty answers that his brain isn't reachable and never moves on viewer requests.

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `JEV_API_KEY` | yes | — | Jev / TypeSafe API key (`TYPESAFE_API_KEY` also accepted) |
| `JEV_MODEL` | no | `jev-latest` | Any name from `GET /v1/models` |
| `JEV_API_BASE` | no | `https://api.typesafe.ai` | Override for a proxy |
| `OPENAI_API_KEY` | no | — | Marty's chat lines, written in character (built-in lines otherwise) |
| `OPENAI_MODEL` | no | `gpt-5` | Model for Marty's lines |
| `CARDSIGHT_API_KEY` | no | — | Real card images from [CardSight AI](https://cardsight.ai) (`CARDSIGHTAI_API_KEY` also accepted; `CARDSIGHT_API_BASE` overrides the URL) |
| `OPERATOR_KEY` | no | — | Locks the gear-menu controls (stop, resume, dock, reset, placement, speed, battery) behind a key. Without it, anyone who opens the page can use them |
| `WIKIPEDIA_ENABLED` | no | `true` | Set to `false` to use Lahman data only |
| `WIKIPEDIA_USER_AGENT` | no | `MartyLive/0.1 (…)` | User-Agent sent to the Wikipedia API (Wikimedia asks for contact details) |

Keys are read only in server code (`src/lib/jev/client.ts`, `src/lib/voice/openai.ts`, `src/lib/live/server.ts`, `src/lib/cardsight/client.ts`) and never reach the browser. The bot icon in the header shows which models are in use.

## How it works

### One Marty, many viewers

The server runs a single simulation (`lib/live/session.ts`). Every browser connects to `/api/live/stream` (Server-Sent Events) and receives the same chat, position, battery, trip and scoreboard. The first event is a full snapshot; live updates follow, and position updates arrive ten times a second.

- **Handles**: 2–20 letters, numbers or underscores, remembered in the browser. Names such as `marty`, `jev` and `operator` are reserved. There are no accounts: a handle is a display name, not a login.
- **Limits**: one message every 3 seconds per handle; at most 6 messages per 10 seconds from one connection (so a household can share Wi-Fi, but one person can't flood the chat with fake handles); 280 characters per message; at most 30 messages waiting.
- The chat keeps the last 150 items in memory. Restarting the server starts a fresh show.

### How Jev decides

Messages are collected for about one second, then up to six go to Jev in **one** System One call (`lib/decision/batch.ts`):

| Question | Type | What it asks |
| --- | --- | --- |
| `intent_<n>` | choice | What message *n* wants: `move`, `question`, `chat`, `stop` or `other` |
| `taxing_<n>` | noul | Whether request *n* is too taxing or too slow to be worth doing now, given battery, time and points |
| `next_action` | choice | One of: each viewer's planned route (`p_<n>`), `continue` the current trip, `stop`, `dock` (recharge), or `stay` |

The state Jev sees includes Marty's battery %, driving range, current trip, active bonuses and, for each message, the route planner's estimate: meters, seconds, battery %, battery needed to get home afterwards, and points available.

Deterministic rules then apply hard limits. These are not model outputs:

| Rule | Effect |
| --- | --- |
| **B2** Battery reserve, including the way home | Declines a trip if the battery after it, minus the trip back to the dock, would fall below 10% |
| **T1** Trip duration | Declines trips over 150 s |
| **G2** Too taxing | Declines a request when Jev's `taxing` answer is 60% or more |
| Intent | A route only runs if Jev read the message as `move` |
| **B3** Low battery | At 15% or below Marty goes home first. After a trip, below 20%, he docks automatically |

Marty takes the highest-ranked option that passes. Other allowed requests wait in a **queue** and are reconsidered when he's free (up to 3 times). Declined requests are explained. Marty then says what he's doing, for example:

> I considered @amy's trip to the mezzanine (upstairs), but Jev judged it too taxing right now (74%). Let's do @bob's trip to Pete Rose instead, about 4.74 m and 3% battery. Worth 25 points.

**how Jev decided** under that line shows how Jev read each message, every option with Jev's returned probability (shown as returned), each option's status (chosen, queued, declined, not chosen) and reason, and the rule results. Questions ("how's your battery?", "who was Rickey Henderson?") are answered from Marty's state and the baseball knowledge service. If Jev can't be reached, Marty says so and doesn't move. While a decision is pending, an operator **Stop** also cancels it: a decision that comes back after a stop is reported but not carried out.

### Requests Marty understands

| Try | What happens |
| --- | --- |
| "Go to Griffey" | One card. Route around the table and partition wall |
| "Ripken, then Barry Bonds, then Mantle" | Multi-stop tour, in order. Also splits on commas, "and", "after that" and arrows |
| "go to heanderson" | Typo tolerance: the closest card name within 1–2 letters ("heanderson → henderson"). The correction is shown under the message. Ties are never guessed |
| "Go to Bonds" | Two Bonds cards exist, so Marty asks which one |
| "go around the display table" / "lap the room" | A closed loop clear of the furniture |
| "go upstairs" | Drives to the ramp, then climbs to the mezzanine and back: +14% battery and +30 s on top of the drive |
| "nearest card", "the dock", "the middle", "the other side" | Named places |
| "Go to Honus Wagner" | The card sits in a locked vault: Marty explains it's unreachable |

### Battery

Battery drains from **measured simulated movement**, not time. Each move counts the distance driven (0.6% per meter) and the turning (0.1% per radian). The ramp climb costs a fixed 14%. The HUD shows the battery % and the **driving range** in meters above the 10% reserve. During a trip it also shows meters left and the ETA. Parked at the dock, Marty recharges at 2.5% per second. The numbers live in `lib/twin/battery.ts`.

### Points and bonuses

Every card has base points according to how sought-after it is (Mantle 60, Robinson 50, Aaron 40, Griffey 35, and so on; `lib/twin/environment.ts`). When Marty reaches a card on your trip, you earn its points. A card's base points pay out again 2 minutes after a visit. Every 20–40 seconds a **bonus** (+20 to +80) spawns on a reachable card and expires after 45–90 seconds. Badges on the map show what each card is worth right now; bonus cards glow gold. The leaderboard and active bonuses sit under the map (`lib/game/game.ts`).

### Operator controls

The gear icon on the map has Stop, Resume (finishes the remaining stops), Dock, Reset (clears chat, scores and battery for everyone), speed, heading, a battery slider for testing, and the clearance overlay. Operators can also drag Marty to a new spot. Set `OPERATOR_KEY` to require a key for all of these; it's entered in the gear menu and remembered in that browser.

### Who decides what

| Step | Done by | Module |
| --- | --- | --- |
| What each message wants and what Marty does next | **Jev** (one batched call) | `lib/decision/batch.ts` |
| Battery, time and intent limits | Deterministic rules | `lib/decision/batch.ts` |
| Words → cards, places, typo correction, multi-stop parsing | Deterministic code | `lib/twin/resolve.ts`, `fuzzy.ts`, `routes.ts` |
| Route planning and estimates | Grid A* (0.1 m cells, obstacles inflated by Marty's radius plus clearance, line-of-sight smoothing) | `lib/twin/pathfinding.ts`, `routes.ts` |
| Movement and battery drain | Kinematic simulation plus the measured-distance battery | `lib/twin/motion.ts`, `battery.ts` |
| Points and bonuses | Seeded game layer | `lib/game/game.ts` |
| What Marty says | OpenAI if configured, else built-in lines. Grounded in the decision's facts and reasons | `lib/voice/openai.ts`, `lib/live/lines.ts` |

The text model never decides anything. It phrases what Jev and the rules already decided, and its prompt forbids inventing reasons, numbers or points. Built-in lines are tagged **built-in** in the chat.

### Real card images (CardSight AI)

With `CARDSIGHT_API_KEY` set, each card in the room is linked to the real card in the [CardSight AI](https://cardsight.ai) catalog, and its front image is shown:
- **2D:** hover a card for a preview with its details; click still sends Marty. On a phone, tapping a card opens it full size, with a **Send Marty** button.
- **3D / FPV:** the real image replaces the drawn placeholder on the wall, at the card's real proportions.

**How cards are matched** (`lib/cardsight/match.ts`): each card has a search hint with player, year, release and the printed card number, e.g. 1952 Topps #311 for Mantle and 1982 Topps Traded #98T for Ripken. The app searches the catalog and accepts a result only if the name, year and release agree. A matching card number makes it an **exact** match; without a number to check, as with the T206 Wagner, it's labelled a **likely** match. If nothing certain turns up, the card keeps its placeholder and shows "No certain match": the app never guesses. To pin a specific catalog card, put its CardSight UUID in that card's hint as `id`.

**If you only see placeholders**, open the gear menu on the map and click **Check card images**. It looks every card up again and shows, per card, what happened:
- whether the key is set, and whether CardSight accepted it;
- which searches ran, and how many results each returned;
- the closest catalog results, and why each one was or wasn't accepted;
- whether the image downloaded.

Only the operator can run it, because it spends CardSight lookups. The server's Terminal window also logs one line per card. Stray spaces or quotes around the key in `.env.local` are ignored. Each card tries several searches, most specific first, and reads the year from the release name when the year field is missing.

The search runs once per card. Results are saved to `data/cardsight/matches.json`; delete that file to search again. Images are fetched by the server, cached in `.cache/cardsight/`, and served from `/api/cards/<card id>/image`, so the key never reaches the browser. The image route only serves the room's own cards, so the app can't be used to pull arbitrary images on your key.

**Card backs:** CardSight provides one image per card, the front. To show a back, or to replace a front, drop your own image in `public/cards/`, e.g. `mantle-52-back.jpg` (see `public/cards/README.md`). The 2D card view then shows both sides, with a flip button on phones.

### 3D and first-person views

The **2D / 3D / FPV** switch at the bottom-right of the map changes only how the room is drawn. All three views show the same live simulation: Marty's position and heading, the route, cards, bonuses and points come from the server stream. Switching never touches the simulation, so Marty keeps driving. Your choice is remembered in this browser.

- **2D**: the original top-down map, unchanged.
- **3D**: an observer camera. Drag to orbit, scroll or pinch to zoom, right-drag to pan. The near wall is see-through. Click a card to request it.
- **Arriving at a card**, Marty turns in place to face it squarely: the route plan includes that final turn, and it's counted in the time and battery estimates. In FPV the camera then tilts up and zooms in so the card fills about 80% of the frame, and eases back out as he drives off. The framing rule, `framing()` in `lib/twin/space3d.ts`, is tested for every reachable card.
- **FPV**: the view from a camera mounted on Marty, 16 cm up and just in front of his center, tilted up 7°. It moves with every pose update, and turns are damped slightly so they feel like a camera rather than a cut. A reticle, heading and position readout, and labels sit on top: card name and current points for cards within about 4.5 m ahead, plus a **NEXT** marker on the trip's next stop.

The 2D→3D mapping lives in `lib/twin/space3d.ts`. It holds the axes, heights of walls and furniture, card placement and the FPV camera mount, and its tests check that the camera follows the same poses the 2D map draws. Rendering uses Three.js through React Three Fiber (`components/three/Room3D.tsx`). That code loads only when someone opens a 3D view. Without WebGL, the 3D views show a short notice and the 2D map still works.

### Environment

The room is 12 m × 8 m, with the origin at the bottom-left and +y pointing north. All map elements go through one world→screen transform (`lib/twin/geometry.ts`). The room and card catalog are plain data in `lib/twin/environment.ts`. The obstacles are a partition wall, a display table, two plinths, a low shelf, an equipment rack and a locked vault cage. There is a ramp up to the mezzanine in the north-west corner. The cards are Ken Griffey Jr., Rickey Henderson, Bobby Bonds, Barry Bonds, Cal Ripken Jr., Hank Aaron, Jackie Robinson, Ichiro Suzuki, Mickey Mantle, Pete Rose and Honus Wagner (the one in the vault). Their positions are fictional.

### Future hardware

Marty's position comes only from the `PoseSource` interface in `lib/twin/motion.ts`. `SimulatedMotion` is the only implementation. A real Scout telemetry adapter could implement the same interface later. No hardware integration exists in this prototype.

## Baseball knowledge

Marty knows baseball. Ask about a player ("What did Rickey Henderson do in 1982?", "Who was Nolan Ryan?") and he answers from real data. He also volunteers facts on his own:
- **heading to a card:** one fact, woven into the reply;
- **arriving at a card:** a fresh observation, unless he already shared one on this trip;
- **revisiting a card:** after a quiet period, a *different* fact.

Each fact Marty uses shows its source under the message.

### How it works

| Layer | What it does | Where |
| --- | --- | --- |
| Data | Lahman CSVs imported into one JSON store: full season detail (with league ranks and team seasons) for the card players, plus a compact career record for every player | `scripts/import-lahman.ts` → `data/baseball/knowledge.json` |
| Knowledge service | Deterministic lookups: profile, season, career, team season, all-time ranks, teammates. Returns structured facts, each with source, dataset version and verification status | `src/lib/baseball/store.ts`, `facts.ts`, `service.ts` |
| Player resolution | Card aliases plus full names across all ~20,000 people; longest match wins. Same-name players (Ken Griffey Sr./Jr., the two Bondses) come back as **ambiguous**, so Marty asks rather than guesses. "Jr."/"Sr." decide between same-name players. Managers with no playing career (Cal Ripken Sr.) are set aside | `store.ts` |
| Fact selection | Ranked by relevance: card's issue-year season and team, then big career achievements, league leads, awards, connections between cards in the room, then Wikipedia trivia. Skips facts already shared and varies the kind of fact | `facts.ts` |
| Commentary policy | One volunteered fact per trip; quiet for 60 s after a card is discussed, then it counts as a revisit; 8 s minimum gap between unprompted comments; never talks over a reply in progress. Questions always get an answer | `src/lib/baseball/commentary.ts` |
| Orchestration | Listens to the existing mission controller and asks `/api/reply` for lines with the right knowledge request. Async; failures fall back to built-in lines; never touches motion | `src/lib/voice/director.ts` |
| Voice | The persona prompt gets a BASEBALL FACTS block. Every number, award or story must come from it, copied exactly; sourced items are hedged; ambiguous names → ask | `src/lib/voice/openai.ts` |

The knowledge layer is model-agnostic: it returns facts, and only `openai.ts` knows about prompts. Exact statistics always come from deterministic queries. The text model only narrates them.

**Cards vs seasons:** each card records its manufacturer/set, **issue year**, team shown, and **season represented** (left `null` when unknown rather than guessed). Card facts say "in 1989, the year this card was issued". They don't claim to be the stats printed on the card. Cards link to players by Lahman ID, so several cards of one player would share the same facts.

### Importing the Lahman data

The repository includes a ready-made `data/baseball/knowledge.json` built from a Baseball Databank snapshot, so this step is optional. Seasons run through **2021**. To use the current official release (Version 2025, through the 2025 season):

1. Download the comma-delimited (CSV) version from https://sabr.org/lahman-database/ and unzip it.
2. Run:
   ```bash
   npm run import:lahman -- --src ~/Downloads/lahman_1871-2025_csv --version "Lahman 2025"
   ```
   The folder can hold the CSVs directly or in `core/` and `contrib/` sub-folders. Options:
   - `--players all` imports full season detail for everyone (a much bigger file).
   - `--players id1,id2` picks specific players.
3. Restart the app. The bot icon shows the dataset and its last season.

The importer reads only `People`, `Batting`, `Pitching`, `BattingPost`, `AllstarFull`, `AwardsPlayers`, `HallOfFame` and `Teams`. Missing values stay null (never 0). It fails loudly if a catalog player's Lahman ID is not in `People.csv`.

### Wikipedia

Wikipedia supplements the statistics with biography and trivia:
- It is used only for an already-identified player: the card's exact article title, or a unique full name. It uses the official REST summary endpoint (`/api/rest_v1/page/summary/{title}`), never scraping or bulk downloads.
- Up to three short sentences are taken from the lead summary. Disambiguation pages and non-baseball articles are rejected.
- Each fact keeps the article URL, revision id and retrieval time. It is marked "sourced", and the voice hedges anything that reads like an anecdote.
- Summaries are cached in memory and in `.cache/wikipedia/` for 7 days. Failures are cached for 10 minutes, and requests time out after 2.5 s.
- Volunteered commentary never waits for Wikipedia: it uses cached facts and refreshes in the background. Questions may wait up to the timeout.
- If Wikipedia is down or disabled, Marty uses the Lahman facts alone.

### Attribution and licensing

- **Lahman Baseball Database:** CC BY-SA 3.0. Attribution is given in the bot popover, under each message that uses a fact, and in `data/baseball/README.md`. The derived `knowledge.json` is shared under the same license.
- **Wikipedia:** CC BY-SA 4.0. Messages using Wikipedia facts link to the article; the revision and retrieval date appear on hover.
- Before any commercial use, review the current terms on SABR's Lahman page. The 2025 release includes Negro Leagues data licensed from Seamheads, which may carry its own terms. Also check that share-alike obligations fit your product.

## Architecture

```
src/
  lib/live/           the live session (one Marty, many viewers), its server singleton, stream types, built-in lines
  lib/decision/       batch.ts: Jev batch arbitration + rules; engine/policy/questions: single-request engine (/api/decide)
  lib/jev/            Jev API types (from the published OpenAPI spec) + server-only client
  lib/game/           points, bonuses, leaderboard
  lib/cardsight/      CardSight AI client (server), strict card matching, image cache + local overrides
  lib/twin/           environment & cards, geometry, occupancy grid, A*, resolution, typo matching,
                      multi-stop routes, battery, motion (PoseSource + SimulatedMotion), single-user controller
  lib/voice/          Marty's voice: persona + OpenAI calls (server), built-in lines
  lib/baseball/       knowledge store, fact building/selection, Wikipedia client, commentary policy, service
  scripts/            import-lahman.ts (Lahman CSV → data/baseball/knowledge.json)
  data/baseball/      generated knowledge file + its license/attribution note
  app/api/live/stream GET: Server-Sent Events (snapshot, chat, telemetry, trip, game)
  app/api/live/chat   POST { handle, text }: queue a viewer message
  app/api/live/operator POST { action, key? }: stop, resume, dock, reset, place, rotate, speed, battery
  app/api/decide      POST: one message + twin context → DecisionResult (single-user engine, still available)
  app/api/reply       POST: outcome facts + recent chat → Marty's reply
  app/api/cards       GET: card artwork for the room (CardSight link + image URLs); /api/cards/<id>/image proxies the front
  app/api/status      GET: which models are configured, whether an operator key is required (no secrets)
  components/         Studio (header), Popover, live/LiveView + LiveChat + useLive, twin/TwinMap (SVG),
                      three/Room3D (3D observer + FPV, loaded on demand)
```

Dependencies are `next`, `react`, `react-dom`, and `three` with `@react-three/fiber` for the 3D views. There is no database and no robot-control integration. State lives in server memory, so run one server process: several processes would each run their own Marty.

## Scripts

```bash
npm run dev        # development server
npm run build      # production build (includes type-check)
npm start          # serve the production build
npm run typecheck  # tsc --noEmit
npm test           # live session, routes, battery, game, navigation, voice and baseball tests (node:test, no extra deps)
npm run import:lahman -- --src <csv folder> [--version "Lahman 2025"]
```

`npm test` uses Node's built-in test runner with TypeScript type stripping, so it needs Node 22.6 or newer. The app itself runs on Node 20.9+.
