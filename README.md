# MARTY.LIVE

A live show starring Marty, a 4-inch Moorebot Scout, in a fictional six-floor card house built to his scale: each floor is 4 ft × 8 ft, floors are 16 in apart, joined by long ramps, with 35 real-size (2.5 × 3.5 in) baseball cards on the walls and furniture. Many people can watch at once. Each viewer picks a **@handle** and chats requests: *"Go to Griffey"*, *"Ripken, then Bonds, then Mantle"*, *"go around the welcome desk"*, *"take me to the vault"*. Jev, the decision engine, reads everyone's messages together and decides what Marty does next. Hard safety rules can veto its pick. Marty explains the decision in chat and drives the route on an overhead map. His battery drains with every meter, and the viewer who sent him earns the card's points.

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
| `BATTERY_CAPACITY` | no | `100` | How many times bigger Marty's battery is than the baseline. Higher = Marty drives farther and declines fewer trips; `1` = the baseline (a full charge drives ~118 ft) |
| `ELEVENLABS_API_KEY` | no | — | Marty speaks his lines out loud via [ElevenLabs](https://elevenlabs.io). `ELEVENLABS_VOICE_ID` picks the voice (default: Brian), `ELEVENLABS_MODEL` the model (default `eleven_flash_v2_5`) |
| `MARTY_DATA_DIR` | no | `~/.marty-live` | Where your card catalog edits and CardSight matches are saved (outside the app folder, so updates don't lose them) |
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

> I considered @amy's trip to floor 6 (The Vault · Pre-war), but Jev judged it too taxing right now (74%). Let's do @bob's trip to Ken Griffey Jr. instead, about 6 ft 2 in and 6% battery. Worth 35 points.

**how Jev decided** under that line shows how Jev read each message, every option with Jev's returned probability (shown as returned), each option's status (chosen, queued, declined, not chosen) and reason, and the rule results. Questions ("how's your battery?", "who was Rickey Henderson?") are answered from Marty's state and the baseball knowledge service. If Jev can't be reached, Marty says so and doesn't move. While a decision is pending, an operator **Stop** also cancels it: a decision that comes back after a stop is reported but not carried out.

### Requests Marty understands

| Try | What happens |
| --- | --- |
| "Go to Griffey" | One card. Marty plans around the furniture, drives there, and turns to face it |
| "Ripken, then Barry Bonds, then Mantle" | Multi-stop tour, in order, across floors: Marty takes the ramps himself. Also splits on commas, "and", "after that" and arrows |
| "3rd floor", "floor five", "top floor", "lobby", "the vault", "upstairs", "downstairs" | Go to a floor (one ramp at a time) and pull into the middle |
| "go to heanderson" | Typo tolerance: the closest card name within 1–2 letters ("heanderson → henderson"). The correction is shown under the message. Ties are never guessed |
| "Go to Bonds" | Two Bonds cards exist, so Marty asks which one |
| "go around the welcome desk" / "lap the floor" | A closed loop clear of the furniture, on Marty's current floor |
| "nearest card", "the dock", "the middle", "the other side" | Named places on Marty's current floor |
| "Go to Honus Wagner" | The card sits in a locked vault: Marty explains it's unreachable |

### Battery

Battery drains from **measured simulated movement**, not time. Each move counts the distance driven, the turning, and extra for climbing ramps (going down costs nothing extra). How big the battery is comes from `BATTERY_CAPACITY` in `.env.local`, default **100**. At `1` (the baseline), driving costs 2.5% per meter, turning 0.05% per radian, and climbing an extra 2% per meter of incline (about 7% per floor), so a full charge drives about 118 ft. At 100, everything costs 1/100 of that, and a full charge drives over 2 miles. Lower the number to make battery a real constraint; restart the app after changing it. The HUD shows the battery %, the **driving range** above the 10% reserve, and during a trip the distance left and the ETA. Every floor has a charging dock (1% per second); "home" in the reserve rule means the dock on the floor the trip ends on. The numbers live in `lib/twin/battery.ts`.

### Points and bonuses

Every card has base points according to how sought-after it is (Mantle 60, Robinson 50, Aaron 40, Griffey 35, and so on; `lib/twin/environment.ts`). When Marty reaches a card on your trip, you earn its points (Ruth 100, Gehrig and Cobb 70, Mantle and DiMaggio 60…). A card's base points pay out again 2 minutes after a visit. Bonuses are a treat, not a feed: every 1½–3 minutes a **bonus** (+20 to +80) spawns on a reachable card, at most two at a time, and lasts 2½–4 minutes, long enough to drive a few floors for it. Badges on the map show what each card is worth right now; bonus cards glow gold. The leaderboard and active bonuses sit under the map (`lib/game/game.ts`).

### When nobody's talking

If the chat goes quiet for a little over a minute and someone is watching, Marty thinks out loud: a wry, slightly existential musing ("Why does a robot care this much about cardboard?"), an idea for viewers, or a look at a card on his floor. Each musing waits twice as long as the one before (up to 15 minutes) until someone speaks, which resets the clock. With a text model the lines are written fresh from a rotating set of topics; without one, Marty uses built-in musings. They're marked **thinking** in the chat.

### Units

The **in / cm** toggle next to the view switch shows every distance in inches and feet or in centimeters and meters: the HUD, map grid and labels, the decision trace and Marty's own lines. Marty's lines go to everyone at once, so distances in them are stored as markers and each browser shows them in its own units. The setting is remembered per browser.

### Operator controls

The gear icon on the map has Stop, Resume (finishes the remaining stops), Dock, Reset (clears chat, scores and battery for everyone), speed, heading, a battery slider for testing, and the clearance overlay. Operators can also drag Marty to a new spot on the floor being viewed. Set `OPERATOR_KEY` to require a key for all of these; it's entered in the gear menu and remembered in that browser.

### Keyboard driving (FPV)

In the **FPV** view, operators can drive Marty from the keyboard. The Scout has Mecanum wheels, so he moves in any direction without turning first:

| Key | Does |
| --- | --- |
| W / S | Forward / backward |
| A / D | Strafe left / right |
| Q / E | Rotate left / right |
| Shift (hold) | Precision mode: about 25% speed |
| Space | Stop (the same operator stop as the gear menu) |

Keys combine: W+D drives diagonally, and W+E drives forward while turning right. Held keys set one velocity command: **forward**, **strafe** and **rotate**, each from −1 to 1. The diagonal is normalized, so W+D is no faster than W alone (`lib/twin/teleop.ts`). A small panel in the FPV view's bottom-left corner shows the layout. Keys light up while held, and the panel shows when precision mode is on. The status chip in the HUD reads **manual** while someone is driving.

Driving goes through the same operator channel as the gear menu (`POST /api/live/operator { action: "drive", forward, strafe, rotate }`), with the same `OPERATOR_KEY` check. On the server it runs through the same motion, clearance and battery as every trip:
- Marty can't drive into walls or furniture: he keeps the planner's clearance, and slides along an obstacle he brushes against. Ramp lanes and openings count as obstacles, so he stays on his floor.
- Battery drains by the distance he actually covers, and he can't be driven on an empty battery.
- Taking the wheel stops a running trip like an operator stop does. **Resume** in the gear menu continues it afterwards. Jev's decisions aren't carried out while someone is driving.

Stopping:
- Letting go of all the keys stops Marty.
- He also stops if the browser window loses focus, the tab is hidden, you click into the chat or any other text box, or you leave the FPV view.
- While keys are held, the browser repeats the command every 200 ms. If the server hears nothing for 600 ms (closed tab, lost connection), Marty stops on his own.
- Keys typed into the chat or other inputs never drive him. Ctrl, Alt and ⌘ shortcuts are left alone.

Mouse, touch and chat requests work as before. The panel is hidden on phones and tablets, which have no keyboard. Like everything else here, this drives the simulated Marty; see **Future hardware**.

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

### Card catalog

**Cards** (top-right of the map) opens the catalog: every card, with its thumbnail, name, year, team, manufacturer, set, card number, floor, position, which way it faces, points and **CardSight status**. Anyone can look. Filter by text or floor; **go** sends Marty there.

At the top, one line says whether CardSight is working: no key set, key rejected, can't reach CardSight, or "connected, N of M cards matched". Each row shows that card's own status: matched (exact), likely, not found or error, plus the catalog card it was matched to. **check** looks that card up again and shows what was searched, what came back and why each result was accepted or rejected. **Check all with CardSight** does every card.

As the operator, enter the operator key in the gear menu if one is set, then:
- **Edit** turns the table into a form.
- **Add card** adds a row. New cards get an ID from the name and year ("piazza-92"), and a Lahman ID from the name when it's unambiguous, so Marty has stats. **more** shows other names viewers can use, the Lahman and Wikipedia IDs, a CardSight ID to pin the exact card, and a note.
- **✕** removes a card.
- **Save** checks everything first. Duplicate IDs, impossible years, unknown floors and positions off the floor are refused, with the reason on the row. A card Marty can't reach (blocked, or behind the vault bars) is saved with a warning.
- Saved changes reach everyone watching immediately (map, 3D, game, chat), and CardSight looks up any card whose name, year, set, manufacturer or number changed.
- **Built-in cards** goes back to the 35 that ship with the app.

Positions are measured from the floor's west wall and south wall, in inches or centimeters (the **in / cm** toggle); "faces" is the side Marty looks at it from. Edits are saved to `catalog.json` in the data folder (`~/.marty-live` unless `MARTY_DATA_DIR` says otherwise), so they survive updating the app. Delete that file to go back to the built-in cards.

### Real card images (CardSight AI)

With `CARDSIGHT_API_KEY` set, each card in the room is linked to the real card in the [CardSight AI](https://cardsight.ai) catalog, and its front image is shown:
- **2D:** hover a card for a preview with its details; click still sends Marty. On a phone, tapping a card opens it full size, with a **Send Marty** button.
- **3D / FPV:** the real image replaces the drawn placeholder on the wall, at the card's real proportions.

**How cards are matched** (`lib/cardsight/match.ts`): each card's search comes from its catalog fields: player, year, set and printed card number, e.g. 1952 Topps #311 for Mantle and 1982 Topps Traded #98T for Ripken. The app searches the catalog and accepts a result only if the name, year and release agree. A matching card number makes it an **exact** match; without a number to check, as with the T206 Wagner, it's labelled a **likely** match. If nothing certain turns up, the card keeps its placeholder and shows "No certain match": the app never guesses. To pin a specific catalog card, put its CardSight ID in the card's row in the catalog (**more** → CardSight ID).

**If you only see placeholders**, open the gear menu on the map and click **Check card images**. It looks every card up again and shows, per card, what happened:
- whether the key is set, and whether CardSight accepted it;
- which searches ran, and how many results each returned;
- the closest catalog results, and why each one was or wasn't accepted;
- whether the image downloaded.

Only the operator can run it, because it spends CardSight lookups. The server's Terminal window also logs one line per card. Stray spaces or quotes around the key in `.env.local` are ignored. Each card tries several searches, most specific first, and reads the year from the release name when the year field is missing.

The search runs once per card (and again when you edit the card). Results are saved to `cardsight-matches.json` in the data folder; delete that file to search everything again. Images are fetched by the server, cached in `.cache/cardsight/`, and served from `/api/cards/<card id>/image`, so the key never reaches the browser. The image route only serves the room's own cards, so the app can't be used to pull arbitrary images on your key.

**Card backs:** CardSight provides one image per card, the front. To show a back, or to replace a front, drop your own image in `public/cards/`, e.g. `mantle-52-back.jpg` (see `public/cards/README.md`). The 2D card view then shows both sides, with a flip button on phones.

### 3D and first-person views

The **2D / 3D / FPV** switch at the bottom-right of the map changes only how the room is drawn. All three views show the same live simulation: Marty's position and heading, the route, cards, bonuses and points come from the server stream. Switching never touches the simulation, so Marty keeps driving. Your choice is remembered in this browser.

- **2D**: the top-down map of one floor.
- **3D**: an observer camera on a dollhouse cutaway: the floors above the one you're viewing are hidden, so you see into it, with the floors below underneath and the ramp openings to look down through. Drag to orbit, scroll or pinch to zoom, right-drag to pan. Click a card to request it.
- **Floors**: the numbers on the left of the map pick which floor you're looking at (2D and 3D). The green dot marks Marty's floor, and the HUD always says which floor he's on. Pick his floor again, or ⌖, to follow him as he changes floors.
- **Arriving at a card**, Marty turns in place to face it squarely: the route plan includes that final turn, and it's counted in the time and battery estimates. In FPV the camera then tilts so the card (a real 3.5 in card, from about 3.3 in away) fills most of the frame, and eases back out as he drives off. The framing rule, `framing()` in `lib/twin/space3d.ts`, is tested for every reachable card.
- **FPV**: the view from a camera on Marty's nose, about 2.3 in up, tilted up 5°. The floor above is his ceiling. On ramps he rises with the incline and looks along it. It moves with every pose update, and turns are damped slightly so they feel like a camera rather than a cut. A reticle, floor, heading and position readout, and labels sit on top: card name and current points for cards on his floor within about 3 ft ahead, plus a **NEXT** marker on the trip's next stop.

The 2D→3D mapping lives in `lib/twin/space3d.ts`. It holds the axes, heights of walls and furniture, card placement and the FPV camera mount, and its tests check that the camera follows the same poses the 2D map draws. Rendering uses Three.js through React Three Fiber (`components/three/Room3D.tsx`). That code loads only when someone opens a 3D view. Without WebGL, the 3D views show a short notice and the 2D map still works.

### Environment

The building is plain data in `lib/twin/environment.ts`, with all sizes in real units:

| | Size |
| --- | --- |
| Each floor | 8 ft (east–west) × 4 ft (north–south) |
| Floor to floor | 16 in |
| Ramps | 64 in long, 7.5 in wide: a 16 in rise at about 14°, gentle enough for the treads. A switchback, like a parking garage: odd floors climb along the south wall heading east, even floors along the north wall heading west. Each floor has an opening where the ramp from below arrives |
| Marty | 4 in wide × 4.3 in long. The planner keeps his turning circle (half his diagonal, 2.9 in) plus ½ in clearance away from everything, on a ¼ in (1 cm) grid |
| Cards | 2.5 × 3.5 in, mounted with their centre about 2.75 in up. Marty stops about 5 in from a card and turns to face it |

| Floor | Theme | Cards |
| --- | --- | --- |
| 1 | Lobby · modern era | Griffey (1989 UD), Ichiro (2001), Ohtani (2018 Update), Jeter (1993 SP), Trout (2011 Update), Pujols (2001 Bowman Chrome) |
| 2 | The '80s & '90s | Henderson, Ripken (1982 Traded), Gwynn, Mattingly (1984 Donruss), McGwire, Barry Bonds, Frank Thomas (1990 Leaf) |
| 3 | The '70s | Schmidt, Brett, Ozzie Smith, Reggie Jackson, Bobby Bonds |
| 4 | The '60s | Maris, Rose, Nolan Ryan, Bench, Koufax |
| 5 | The '50s | Jackie Robinson, Mantle, Mays, Aaron, Banks, Ted Williams, Clemente |
| 6 | The Vault · pre-war | Ruth and Gehrig (1933 Goudey), Cobb (T206), DiMaggio (1941 Play Ball), Honus Wagner (T206, locked in a cage, unreachable by design) |

Positions are fictional. The origin of each floor is its south-west corner, +y north. All map elements go through one world→screen transform (`lib/twin/geometry.ts`).

### Future hardware

Marty's position comes only from the `PoseSource` interface in `lib/twin/motion.ts`. `SimulatedMotion` is the only implementation. A real Scout telemetry adapter could implement the same interface later. Movement commands go through `MotionCommands` (`follow`, `drive`, `stop`), so a hardware adapter would also receive keyboard driving as forward / strafe / rotate velocities. No hardware integration exists in this prototype.

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
| Orchestration | The live session asks for facts on arrival at a card and for viewers' questions. Async; failures fall back to built-in lines; never touches motion | `src/lib/live/session.ts` |
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

### Light and dark mode

The sun / moon button in the top bar switches between light and dark. The first time you visit, the app follows your computer's setting (macOS: System Settings → Appearance); after you press the button it remembers your choice in that browser. The 3D views recolour too. Colours live as variables at the top of `src/app/globals.css` (`:root` for dark, `:root[data-theme="light"]` for light), so tweaking the light palette is a one-place edit.

### Succulents

Nine potted succulents decorate the building. Five small bowls sit on furniture next to cards: the lobby desk, the '80s display case, the '70s shelf, the '50s gallery case and the vault pedestal. Four bigger pots stand in floor corners by the wall cards. The floor pots are small obstacles that Marty drives around. Every card that was reachable still is (there's a test for it). They show up as little rosettes on the 2D map and as potted plants in 3D and FPV. Positions are in `DECOR` in `src/lib/twin/environment.ts`.

The 3D view draws a built-in succulent (a glazed bowl of echeveria rosettes) unless you upload your own model: **gear menu → Plants → Upload .glb** (operator only). It's saved as `models/succulent.glb` in the data folder, so updates keep it. Any GLB works: it's scaled to fit each pot's spot, base down. **Use built-in** removes it. For the [Succulent Bowl Planter by jerovdl](https://sketchfab.com/3d-models/succulent-bowl-planter-crafted-by-jerovdl-faa94790ebd3431ebff4648e9667d6a8) on Sketchfab, sign in, click **Download 3D Model**, and pick **GLB**. Check the license shown on the model page: most Sketchfab downloads are CC Attribution, which means crediting the author wherever the app is shown publicly. ZIPs and `.gltf` files are refused with a note on what to download instead. Files can be up to 60 MB.

### Marty's voice (ElevenLabs)

With `ELEVENLABS_API_KEY` set, a **🔇 Voice** button appears in the map's top-right corner. Click it (it turns to **🔊 Voice**) and Marty reads his new chat lines out loud: replies, arrivals and his musings when it's quiet. Lines already in the chat aren't read back; each Marty message gets a small 🔈 button to hear it on demand. Voice is per viewer and off until they turn it on (browsers only allow sound after a click). If the browser still holds the sound back after a reload, the button pulses **Tap to hear**.

The key stays on the server. Browsers ask for a line by its chat ID (`/api/live/speech/<id>`), never with free text, so the key can only ever read Marty's own lines. Each line is sent to ElevenLabs once and shared by everyone listening (separately for inch and centimeter viewers, since distances are read aloud: "3 feet 4 inches"). Nothing is sent to ElevenLabs while nobody has the voice on. If a call fails, hovering the Voice button says why (key rejected, out of credits, unknown voice, can't reach ElevenLabs).

To change the voice, copy a voice ID from the ElevenLabs Voice Library into `ELEVENLABS_VOICE_ID` and restart.

## Architecture

```
src/
  lib/live/           the live session (one Marty, many viewers), its server singleton, stream types, built-in lines
  lib/decision/       batch.ts: Jev batch arbitration + rules; contracts.ts: shared API shapes
  lib/jev/            Jev API types (from the published OpenAPI spec) + server-only client
  lib/game/           points, bonuses, leaderboard
  lib/cardsight/      CardSight AI client (server), strict card matching, image cache + local overrides
  lib/twin/           environment & cards, geometry, occupancy grid, A*, resolution, typo matching,
                      multi-floor routes and ramps, battery, motion (PoseSource + SimulatedMotion), teleop, 2D↔3D mapping
  lib/units.ts        inches/feet vs cm/m formatting, and the distance markers used in shared chat text
  lib/voice/          Marty's voice: persona + OpenAI calls (server), built-in lines; elevenlabs.ts: speech (server)
  lib/baseball/       knowledge store, fact building/selection, Wikipedia client, commentary policy, service
  scripts/            import-lahman.ts (Lahman CSV → data/baseball/knowledge.json)
  data/baseball/      generated knowledge file + its license/attribution note
  app/api/live/stream GET: Server-Sent Events (snapshot, chat, telemetry, trip, game)
  app/api/live/chat   POST { handle, text }: queue a viewer message
  app/api/decor       GET: is a plant model uploaded? /api/decor/model GET the .glb, PUT/DELETE (operator) to replace/remove it
  app/api/live/speech/<id> GET: one of Marty's lines as audio (ElevenLabs, cached)
  app/api/live/operator POST { action, key? }: stop, resume, dock, reset, place, rotate, speed, battery, drive (keyboard teleop)
  app/api/cards       GET: card artwork for the room (CardSight link + image URLs); /api/cards/<id>/image proxies the front
  app/api/status      GET: which models are configured, whether an operator key is required (no secrets)
  components/         Studio (header), Popover, live/LiveView + LiveChat + useLive + useTeleop/TeleopPad (keyboard driving), twin/TwinMap (SVG),
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
