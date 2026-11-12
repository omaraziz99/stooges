# fe: web app

Slack-style chat UI (React 19, Vite, Tailwind 4) for the relay in `../be`, with the KPI insights
dashboard and the `/kpi-<name>` review command.

```bash
pnpm install
pnpm dev          # http://localhost:5173, connects to ws://<this host>:7777
pnpm typecheck
pnpm build
```

Set `VITE_RELAY_URL` to use another relay, e.g. `wss://your-relay.up.railway.app` (see `.env.example`).
On Vercel, set it under Project → Environment Variables and use `fe` as the root directory.

## Features

- Accounts are keys generated in the browser, or sign in with an existing `nsec` key
- Channels, threads, emoji reactions, deleting your own messages, live updates
- **KPI insights**: team totals per pillar, a profile per person with an AI-drafted review and
  evidence linked back to the original messages
- **`/kpi-<name>`** in any channel opens a private review panel, with name suggestions as you type.
  Commands are never posted
- Works at phone width

## Layout

```
src/lib/relay.ts     WebSocket client: login, subscriptions, publish with OK
src/lib/chat.ts      chat model and publish actions
src/lib/kpi.ts       KPI report types and the /kpi command parser
src/state/relay.tsx  React context and hooks (useSubscription, useChannels, useKpiReport)
src/components/      Sidebar, ChannelView, ThreadPanel, Composer, KpiDashboard, KpiReviewPanel, ...
```
