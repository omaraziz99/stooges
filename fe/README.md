# fe: web app

Slack-style chat UI (React 19, Vite, Tailwind 4) for the relay in `../be`, with the KPI insights
dashboard and the `/kpi-<name>` review command.

```bash
pnpm install
pnpm dev          # http://localhost:5173, connects to ws://<this host>:7777
pnpm typecheck
pnpm test         # the review-suggestion rules (src/lib/reviews.test.ts)
pnpm build
```

Set `VITE_RELAY_URL` to use another relay, e.g. `wss://your-relay.up.railway.app` (see `.env.example`).
On Vercel, set it under Project → Environment Variables and use `fe` as the root directory.

## Features

- A landing page for visitors who are not signed in: a live demo of the chat and KPI agent, a cast of kopi-shop mascots, and product screenshots; **Try now** opens Create account (`#/signup`), **Log in** the Log in tab (`#/login`)
- Create an account with name, email and password, or log in with email and password (the password never leaves the browser; see `be/README.md`)
- Channels, threads, emoji reactions, deleting your own messages, live updates
- **Team insights dashboard** (`#/team`, opened from **KPI insights** in the sidebar): a page of its
  own with a 3D clay landscape of the team's evidence per KPI item, every person as a card grouped by
  level, and a page per person (`#/team/<name>`) with the AI-drafted review, their level's items
  (click one to filter), evidence per week, and evidence linked back to the original messages.
  Managers see everyone; anyone else sees only their own
- **Performance reviews**: **Suggested reviews** lists people with no review on record, none in 90
  days, or no chat evidence this period, and managers book, reschedule or cancel a review from it
  or from a person's page. The booked person sees their next review on their own page. Run
  `pnpm test` to check the suggestion rules (`src/lib/reviews.test.ts`)
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
