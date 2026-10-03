# Jev Decision Studio

A chat app that shows a structured AI decision engine at work. For each message you send, the app:

1. adds the message to the conversation,
2. sends one **batched** request to Jev with five typed questions (`choice`, `score` and `noul`),
3. walks through the steps on screen: request received → intent classified → alternatives evaluated → result selected → downstream effect,
4. animates the probabilities and scores that came back,
5. applies a deterministic policy to choose an **action** (answer, troubleshoot, escalate, …) and a priority,
6. records the decision in a session timeline, and
7. writes the reply with a separate text model (Claude), or uses a clearly labelled scripted reply.

## Quick start

```bash
npm install
npm run dev          # http://localhost:3000
```

With no configuration the app runs in **Demo mode**. Everything works, but the decisions come from a local keyword heuristic. Every place that shows them labels them **SIMULATED** (amber), and they are never presented as Jev output.

Requires Node 20.9+.

## Enabling live Jev integration

```bash
cp .env.example .env.local
# edit .env.local:
JEV_API_KEY=your-typesafe-api-key        # required for Live mode
ANTHROPIC_API_KEY=your-anthropic-key     # optional: generated replies in Live mode
npm run dev
```

Restart the server and the **Live** toggle in the header becomes available. In Live mode:

- `POST /api/decide` calls `POST https://api.typesafe.ai/v1/systemone` from the server, with the key sent as `Authorization: Bearer …`.
- The response is checked for every expected answer and type. Nothing gets filled in. If a field is missing the request fails and you can retry it.
- The inspector shows values exactly as Jev returned them, and the **Request** and **Response** tabs show the raw JSON.
- If Live mode is requested and the key is missing, the API returns `503 not_configured`. It never falls back to simulated data on its own.

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `JEV_API_KEY` | for Live | — | Jev / TypeSafe API key (`TYPESAFE_API_KEY` is also accepted) |
| `JEV_MODEL` | no | `jev-latest` | Any name from `GET /v1/models` |
| `JEV_API_BASE` | no | `https://api.typesafe.ai` | Override for a proxy or a mock |
| `ANTHROPIC_API_KEY` | no | — | Claude-generated replies in Live mode |
| `ANTHROPIC_MODEL` | no | `claude-opus-5-5` | Reply model |

Keys are read only in server code (`src/lib/jev/client.ts`, `src/lib/respond/generate.ts`). None of them uses the `NEXT_PUBLIC_` prefix, and `/api/status` reports only whether each integration is configured.

## What is asked of Jev

Each message goes out as **one request** with the message and up to 6 recent turns as JSON `state`:

| Name | Type | Question |
| --- | --- | --- |
| `intent` | `choice` | question / task / problem / complaint / feedback / smalltalk |
| `urgency` | `score` | 0 can wait … 3 critical |
| `sentiment` | `score` | 0 very negative … 4 very positive |
| `escalate` | `noul` | "This should be handed to a human" |
| `clarify` | `noul` | "Too vague to act on without a clarifying question" |

The policy in `src/lib/decision/policy.ts` turns the answers into an effect:

- `escalate ≥ 0.6` → escalate to a human
- otherwise `clarify ≥ 0.6` → ask a clarifying question
- otherwise the action follows the intent
- the urgency score sets the priority from P3 to P0
- low intent confidence and a negative tone add flags

Each rule that fires is listed in the inspector with the numbers it used.

## Architecture

```
src/
  lib/jev/           Jev API types (from the published OpenAPI spec) + server-only client
  lib/decision/      question set, policy, demo simulator, engine (decide())
  lib/respond/       reply generation (Claude or scripted), separate from the decision layer
  app/api/decide     POST: message → DecisionResult
  app/api/respond    POST: message + selected effect → reply
  app/api/status     GET: which integrations are configured (no secrets)
  components/        Studio (state + session persistence), Chat, Inspector, Timeline, Viz
```

- **Decision, reply and UI layers are kept separate.** The reply generator only sees the selected action and its directive. It does not see the raw probabilities.
- **Session persistence:** the conversation and timeline are kept in `sessionStorage`, so they survive a reload but end when the tab closes. A request cut off by a reload is marked retryable.
- **Errors and retries:** the server retries Jev once on 429, 529, 5xx or network errors and respects `retry-after`. The UI shows inline errors with **Retry** for the decision and **Retry reply** for the reply.
- **Dependencies:** `next`, `react`, `react-dom` and `@anthropic-ai/sdk`. There is no CSS framework.

## Scripts

```bash
npm run dev        # development server
npm run build      # production build (includes type-check)
npm start          # serve the production build
npm run typecheck  # tsc --noEmit
```
