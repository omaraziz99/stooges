# Stooges

A small team chat app with an AI "KPI insights" agent.

- **Chat:** channels, threads, emoji reactions, live updates (a Slack-style UI).
- **KPI agent:** reads team channels and builds an evidence log of "glue work" that commit counts
  miss: technical leadership, knowledge sharing, industry intelligence, and ownership. Managers
  type `/kpi-<name>` in any channel to open a private, AI-drafted review for that person.

All data in this repo is fictional (`be/seed/demo.json`).

| Folder | What | Stack | Deploy to |
|---|---|---|---|
| [`be/`](be/README.md) | Relay (chat server), seed tool, KPI agent | Go, SQLite, WebSockets ([Nostr](https://github.com/nostr-protocol/nips) protocol) | Railway |
| [`fe/`](fe/README.md) | Web app | React 19, Vite, Tailwind 4 | Vercel |

## Run locally

```bash
# 1. Relay
cd be
go run ./cmd/kpi -keygen >> .env     # creates the KPI agent's key pair
go run ./cmd/relay                   # ws://localhost:7777

# 2. Sample data (another terminal)
cd be && go run ./cmd/seed           # fictional channels; prints two demo logins

# 3. Web app (another terminal)
cd fe && pnpm install && pnpm dev    # http://localhost:5173

# 4. KPI agent (needs GEMINI_API_KEY in be/.env, see be/.env.example)
cd be && go run ./cmd/kpi
```

Open the app, create an account, go to **#project-orbit**, and type `/kpi-maya`.

The agent only reads channels marked **KPI insights on** (a badge in the channel header, set by
the channel's creator) and only messages from people who opted in (**KPI insights** in the
sidebar). A new account is not opted in.

The sample data has three work channels with review on (`#project-orbit`, `#platform-infra`,
`#design-system`), two private ones the agent never reads (`#lunch-club`, `#weekend-hikers`), and
seven opted-in people. The seed tool prints secret keys for two of them, an employee (Maya Chen)
and a manager (Priya Nair), so you can sign in as either. It also prints the `MANAGER_PUBKEYS`
line that makes Priya a manager: she then sees everyone's report, while Maya sees only her own. These keys are derived from the names, so treat them
as public.

## Deploy

### 1. Relay on Railway

1. New project → **Deploy from GitHub repo** → pick this repo. In the service **Settings**, set
   **Root Directory** to `be`. Railway builds `be/Dockerfile` (see `be/railway.json`).
2. **Volumes** → add a volume mounted at `/data`, so messages survive redeploys.
3. **Variables** (none of these are secrets; keep API keys off the server):
   - `KPI_AGENT_PUBKEY`: the public key printed by `go run ./cmd/kpi -keygen`
   - `SEED_ON_START=true`: loads the fictional sample channels on start (safe to keep on;
     re-seeding adds no duplicates)
   - `MANAGER_PUBKEYS`: comma-separated public keys of the managers allowed to read everyone's
     KPI report. Each manager gets theirs from **Copy public key** in the app's sidebar. Everyone
     else can read only their own report; unset, nobody can read the team's.
   - `ALLOWED_ORIGINS`: your Vercel URL, e.g. `https://stooges.vercel.app` (optional, recommended)
4. **Networking** → **Generate Domain**. Your relay URL is `wss://<that-domain>`.

Or from the CLI, inside `be/`: `railway login`, `railway init`, `railway up`, then add the volume,
variables, and domain as above.

### 2. Web app on Vercel

1. **Add New → Project** → import this repo. Set **Root Directory** to `fe` (Vite is detected).
2. **Environment Variables**: `VITE_RELAY_URL=wss://<your-railway-domain>`
3. Deploy.

### 3. KPI report

Run the agent from your machine against the deployed relay; the report appears in the app live:

```bash
cd be && go run ./cmd/kpi -relay wss://<your-railway-domain>
```

Run it from your own machine so the Gemini key and `KPI_AGENT_SECRET` never sit on the hosting
platform.

## Before using real data

This is a proof of concept. Before pointing it at real conversations:

- **Access:** anyone who can open the app can read every channel. A person can read only their own
  KPI report, and the keys in `MANAGER_PUBKEYS` can read everyone's, but every manager sees every
  person. Restrict who can sign in, and limit each manager to their own reports.
- **Keys:** identities are keys stored in the browser's localStorage.
- **AI provider:** the agent sends chat text to Gemini (or Claude). Free-tier Gemini data may be
  used to improve Google's products; use a paid or company-approved account.
- **People:** tell the team what is collected and why, keep DMs and private channels out, and treat
  the output as evidence for 1-on-1 conversations, never as a score. Opt-in and work-channel
  marking are enforced, and people can see their own report, but they see it at the same time as
  their manager rather than first, and who has opted in is visible to anyone who can reach the relay.
