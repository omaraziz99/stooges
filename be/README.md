# be: relay, seed tool, and KPI agent

A small [Nostr](https://github.com/nostr-protocol/nips) relay that powers the chat app in `../fe`,
plus two command-line tools. See the [root README](../README.md) for deployment.

```
cmd/relay/       the chat server (WebSockets + SQLite)
cmd/seed/        loads fictional sample data (seed/demo.json)
cmd/kpi/         the KPI agent
internal/nostr/  event hashing, Schnorr signatures, filters
internal/store/  SQLite storage (pure Go, no cgo)
internal/relay/  WebSocket protocol (relay.go) and per-kind rules (policy.go)
internal/client/ minimal client used by seed and kpi
internal/kpi/    conversation grouping, prompts, Gemini/Claude clients, cache, report
internal/accounts/ email sign-up and log-in API
internal/origin/  ALLOWED_ORIGINS matching
internal/config/ .env loader
```

## Relay

```bash
go run ./cmd/relay            # ws://localhost:7777
go test ./...
```

| Variable | Default | Purpose |
|---|---|---|
| `PORT` / `ADDR` | `7777` | Listen port (Railway sets `PORT`); `ADDR` overrides with a full address |
| `DB_PATH` | `stooges.db` | SQLite file; use a volume in production (`/data/stooges.db` in the Docker image) |
| `KPI_AGENT_PUBKEY` | | The only key allowed to publish KPI reports. Locally, `KPI_AGENT_SECRET` in `.env` also works |
| `ALLOWED_ORIGINS` | any | Comma-separated web origins allowed to connect, e.g. `https://stooges.vercel.app,http://localhost:5173`; `*` wildcards allowed. Rejected origins are logged |
| `SEED_ON_START` | | `true` loads the fictional demo channel on start (Docker image only; idempotent) |

Settings can also go in `be/.env` (see `.env.example`).

What it supports:
- **NIP-01**: `EVENT`, `REQ`, `CLOSE`, `EOSE`, `OK`, with filters on ids, authors, kinds, `#tag`, since/until/limit.
- **NIP-42 login**: it sends an `AUTH` challenge on connect, and publishing requires signing it.
- **Channels (NIP-29 subset)**: there is no default channel (a `#general` made by older versions is
  removed on start, with its messages). Kind `9007` creates a channel,
  and the relay answers with a relay-signed kind `39000` metadata event.
- **Allowed kinds**: `0` profile, `9` message (threads via `["e", root, "", "root"]`), `7` reaction,
  `5` delete own events, `9002` turn KPI review of a channel on or off (creator only), and `30078`
  with `d=kpi-report` (KPI agent only) or `d=kpi-consent` (a person's own opt-in). Everything else
  is refused.
- **Work channels**: a channel is reviewed by the KPI agent only if its creator marks it, with
  `["kpi", "on"]` at creation or a kind `9002` later. The relay-signed metadata then carries the
  same tag, which the app shows as a badge and a lock icon.
- **Reading**: everything is public except KPI reports. The team report (`d=kpi-report`) is sent
  only to signed-in manager accounts (account type, `accounts.role = 'manager'`). Each person's own report
  (`d=kpi-report:<their pubkey>`) is sent to that person and to managers, nobody else.
- Every event's ID and signature is verified before it's stored.

## Accounts (email + password)

The same server answers `POST /api/signup` and `POST /api/login` (CORS follows `ALLOWED_ORIGINS`).
The password never reaches the server: the browser sends a PBKDF2-derived auth key (stored only as a
bcrypt hash) and the user's chat key encrypted with the password (NIP-49 `ncryptsec`), which the
server hands back after a successful log-in for the browser to decrypt. A leaked database holds no
usable keys or passwords. Wrong password and unknown email get the same answer, and 10 failed
attempts lock an email for 15 minutes. There is no password reset: the key can only be decrypted with
the password.

Each account has a type: `employee` (everyone who signs up) or `manager`, who can read everyone's
KPI report. Only the server sets it; there is no API for it.

## Seed

```bash
go run ./cmd/seed                                      # into ws://localhost:7777 and stooges.db
go run ./cmd/seed -relay ws://localhost:7777 -db PATH  # the relay's DB_PATH, if not stooges.db
```

Each fictional user signs in, opts in to KPI insights, and posts their own messages. Three work
channels are created with KPI review on and two private ones with it off. Re-running adds no
duplicates. It also creates the demo email accounts listed under `demo_accounts` in
`seed/demo.json` (an employee, Maya Chen, and a manager, Priya Nair). Accounts live in the relay's
database, not in events, so the seed writes them to the relay's SQLite file (`-db`, default
`DB_PATH` or `stooges.db`); against a remote relay it skips them. In the Docker image this happens
automatically with `SEED_ON_START=true`.

## KPI agent

```bash
go run ./cmd/kpi -keygen          # once: KPI_AGENT_SECRET for .env, KPI_AGENT_PUBKEY for the relay
go run ./cmd/kpi                  # review every channel marked for KPI insights and publish the report
go run ./cmd/kpi -dry-run         # preview what would be sent, no API calls
go run ./cmd/kpi -provider claude # use Claude (ANTHROPIC_API_KEY) instead
```

Privacy rules, enforced in code before anything is sent to a model:
- **Work channels only.** The agent refuses a channel that its creator has not marked for KPI review.
- **Opt-in.** Only people who have published their own signed opt-in are read. Anyone else's
  messages are replaced by a placeholder (no name, no text), their reactions are ignored, and
  they do not appear in the report. Opting out takes effect on the next run.

How it works:
1. Reads the channel from the relay and groups messages into whole conversations (a thread, or a
   run of messages with no gap over 45 minutes). A single message is never judged out of context.
2. Sends conversations to the model in batches of 8 (`-batch`) and asks for contributions in four
   pillars: technical leadership, knowledge sharing, industry intelligence, ownership & initiative.
3. Validates every finding in code. It must cite messages the contributor actually wrote, and must
   name a real participant, pillar, and impact level. People are told apart by public key, so an
   account that copies someone's display name is listed separately, as `Name (abc123)`.
4. Writes one review per person from that person's evidence only: a headline, summary,
   evidence-linked highlights, and 1-on-1 questions. There is no score, and no weaknesses are
   written.
5. Publishes the team report to the relay, signed with the agent key, plus one report per person
   that holds only that person's evidence and review. The app shows them live: managers see
   everyone and open a review with `/kpi-<name>`; everyone else sees only their own.

It is quota-friendly. The sample data takes about 5 requests plus one per person (about 12 in
total). Results are cached in `.kpi-cache.json` (git-ignored), so re-runs only send new or changed
conversations. If the API quota runs out, the run stops at once, keeps its progress, and the next
run finishes the rest.
