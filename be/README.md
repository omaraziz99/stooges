# be: relay, seed tool, and KPI agent

A small [Nostr](https://github.com/nostr-protocol/nips) relay that powers the chat app in `../fe`,
plus two command-line tools. See the [root README](../README.md) for deployment.

```
cmd/relay/       the chat server (WebSockets + SQLite)
cmd/seed/        loads fictional sample data (seed/project-orbit.json)
cmd/kpi/         the KPI agent
internal/nostr/  event hashing, Schnorr signatures, filters
internal/store/  SQLite storage (pure Go, no cgo)
internal/relay/  WebSocket protocol (relay.go) and per-kind rules (policy.go)
internal/client/ minimal client used by seed and kpi
internal/kpi/    conversation grouping, prompts, Gemini/Claude clients, cache, report
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
| `ALLOWED_ORIGINS` | any | Comma-separated web origins allowed to connect |
| `SEED_ON_START` | | `true` loads the fictional demo channel on start (Docker image only; idempotent) |

Settings can also go in `be/.env` (see `.env.example`).

What it supports:
- **NIP-01**: `EVENT`, `REQ`, `CLOSE`, `EOSE`, `OK`, with filters on ids, authors, kinds, `#tag`, since/until/limit.
- **NIP-42 login**: it sends an `AUTH` challenge on connect, and publishing requires signing it.
- **Channels (NIP-29 subset)**: `#general` is created on first start. Kind `9007` creates a channel,
  and the relay answers with a relay-signed kind `39000` metadata event.
- **Allowed kinds**: `0` profile, `9` message (threads via `["e", root, "", "root"]`), `7` reaction,
  `5` delete own events, `30078` with `d=kpi-report` from the KPI agent only. Everything else is refused.
- Every event's ID and signature is verified before it's stored.

## Seed

```bash
go run ./cmd/seed                                  # into ws://localhost:7777
go run ./cmd/seed -relay wss://your-relay.example  # into a deployed relay
```

Each fictional user signs in and posts their own messages. Re-running adds no duplicates.

## KPI agent

```bash
go run ./cmd/kpi -keygen          # once: KPI_AGENT_SECRET for .env, KPI_AGENT_PUBKEY for the relay
go run ./cmd/kpi                  # review #project-orbit with Gemini and publish the report
go run ./cmd/kpi -dry-run         # preview what would be sent, no API calls
go run ./cmd/kpi -provider claude # use Claude (ANTHROPIC_API_KEY) instead
```

How it works:
1. Reads the channel from the relay and groups messages into whole conversations (a thread, or a
   run of messages with no gap over 45 minutes). A single message is never judged out of context.
2. Sends conversations to the model in batches of 8 (`-batch`) and asks for contributions in four
   pillars: technical leadership, knowledge sharing, industry intelligence, ownership & initiative.
3. Validates every finding in code. It must cite messages the contributor actually wrote, and must
   name a real participant, pillar, and impact level.
4. Writes one review per person from that person's evidence only: a headline, summary,
   evidence-linked highlights, and 1-on-1 questions. There is no score, and no weaknesses are
   written.
5. Publishes the report to the relay, signed with the agent key. The app shows it live, and
   managers open a person's review with `/kpi-<name>`.

It is quota-friendly. The sample channel takes about 3 requests plus one per person (about 9 in
total). Results are cached in `.kpi-cache.json` (git-ignored), so re-runs only send new or changed
conversations. If the API quota runs out, the run stops at once, keeps its progress, and the next
run finishes the rest.
