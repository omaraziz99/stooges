# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

A team chat app (Slack-style) plus an AI "KPI insights" agent. Two independent projects, no root build:
`be/` (Go module `stooges/be`) and `fe/` (React 19 + Vite + Tailwind 4, pnpm). `README.md`,
`be/README.md` and `fe/README.md` are detailed and current: env vars, deploy steps, protocol rules,
demo logins. Read them before changing behaviour they describe, and update them when you do.

## Commands

Whole stack from the repo root: `docker compose up --build` (relay with sample data on :7777, web
app on :5173). The KPI agent runs inside the relay container: `docker compose exec relay kpi -sample`.

Backend, from `be/`:

```bash
go run ./cmd/kpi -keygen >> .env   # once, so the relay accepts KPI reports locally
go run ./cmd/relay                 # ws://localhost:7777 (also serves /api and /files)
go run ./cmd/seed                  # fictional demo data into the running relay + stooges.db
go run ./cmd/kpi -sample           # KPI report from keyword rules: no AI, no API key
go run ./cmd/kpi -dry-run          # show what would be sent to the model, no API calls
go test ./...
go test ./internal/relay -run TestName   # single test
```

Frontend, from `fe/`:

```bash
pnpm install
pnpm dev          # http://localhost:5173, connects to ws://<host>:7777 unless VITE_RELAY_URL is set
pnpm typecheck    # the only check: no test runner or linter is configured
pnpm build
```

Relay tests start a real relay on `httptest` with a temp SQLite file (`newTestRelayWith` in
`be/internal/relay/relay_test.go`); follow that pattern rather than mocking the store.

## Architecture

**Everything is Nostr events over one WebSocket.** The Go server (`be/cmd/relay/main.go`) muxes
three things on one port: `/api/*` (email sign-up/log-in, `internal/accounts`), `/files`
(attachments, `internal/files`), and `/` (the relay, `internal/relay`). The frontend has no other
data API.

**Identity is a secp256k1 key held in the browser.** The accounts API never sees the password: it
stores a bcrypt hash of a PBKDF2-derived auth key and the chat key encrypted with the password
(NIP-49). See `fe/src/lib/auth.ts`. Every published event is signed client-side.

**Relay rules live in one place.** `handleEvent` in `be/internal/relay/policy.go` is an allowlist
switch on event kind; a kind without a case is rejected. A new event type needs a case there.
Publishing requires NIP-42 auth, and the event author must equal the signed-in key. Reads are
public except KPI reports, filtered by `canRead` in `relay.go` (owner, managers, and the agent).
The manager flag comes from `accounts.role`, looked up at AUTH time; there is no API that sets it.

**Channels** are a NIP-29 subset. The relay keeps a `groups` table and emits relay-signed kind
`39000` metadata events; clients build the channel list from those. Deleting a channel publishes a
`39000` tombstone tagged `["deleted"]`.

**The KPI agent (`cmd/kpi`) is an external client, not part of the server.** It reads the relay
over WebSocket, calls an LLM, and publishes signed kind `30078` reports that the relay accepts only
from `KPI_AGENT_PUBKEY`. Pipeline in `be/internal/kpi`:
`source.go` LoadChannel (consent filtering) → `kpi.go` BuildUnits (group into conversations) →
`report.go` Evaluate (batches, cache) → `kpi.go` Validate (code checks every finding) →
`review.go` WriteReviews → `source.go` PublishReport (one team report + one per person).
Providers implement the `Agent` interface in `parse.go`: `Gemini`, `Claude`, `SampleAgent`.

**Storage** is pure-Go SQLite (`modernc.org/sqlite`, `CGO_ENABLED=0`). The schema is the `schema`
const in `be/internal/store/store.go`, applied with `CREATE TABLE IF NOT EXISTS`; there is no
migration tool.

## Cross-stack contracts (change both sides together)

- Event kinds and `d` tags: `be/internal/nostr/event.go` ↔ `fe/src/lib/chat.ts` (`Kind`,
  `CONSENT_TAG`) and `fe/src/lib/kpi.ts` (`REPORT_KIND`, `REPORT_TAG`).
- Report JSON: the `json` tags on `Report`/`Person` in `be/internal/kpi/report.go` ↔ the types and
  `parseReport` in `fe/src/lib/kpi.ts`. "Pillar" means KPI item: the old name is kept in the report
  format and the code, so don't rename it on one side only.
- The KPI framework (levels, items, weights) exists only in `be/internal/kpi/framework.go` and ships
  inside the report; the frontend reads `report.levels` / `report.pillars`. Don't hardcode items in
  `fe/`. Each person's level comes from `be/seed/team.json`.

## Privacy invariants (don't weaken)

- The agent reads only channels marked `["kpi","on"]`, and only messages from people with their own
  signed `kpi-consent`. Everyone else's messages become placeholders before anything reaches a model
  (`unitsFromEvents` in `source.go`).
- Findings must cite messages the contributor actually wrote, on an item of their own level
  (`Validate`). Reviews have no score, ranking or weaknesses (`ReviewSystemPrompt` in `review.go`).
- A personal report (`d=kpi-report:<pubkey>`) is sent only to that person and to managers.

## Frontend conventions

- One `RelayClient` (`src/lib/relay.ts`) per signed-in key; it handles AUTH, reconnect and
  publish-until-OK. React access is through the context and hooks in `src/state/relay.tsx`.
  `useSubscription` dedupes by event ID and batches to one render per animation frame. Components
  derive chat state from raw events with the builders in `src/lib/chat.ts`.
- i18n: English strings written inline are the keys. Wrap them with `useT()` and add the Manglish
  version to the `MANGLISH` table in `src/lib/i18n.ts`; a missing entry falls back to English. Never
  translate message content, names, or AI-written report text.
- Themes are `teh-susu` (light) and `kopi-o` (dark). The `stooges-theme` localStorage key is also
  read by an inline script in `index.html`, so rename both together.
- Wrap every localStorage access in try/catch (see `src/lib/keys.ts`, `src/lib/prefs.tsx`).

## Demo data

All data is fictional (`be/seed/demo.json`). The seed is idempotent and gives each user a stable key
derived from their name (`keyFor`). Accounts aren't events, so the seed writes them straight into
the relay's SQLite file: `-db` must point at the relay's `DB_PATH`, and against a remote relay it
skips accounts.
