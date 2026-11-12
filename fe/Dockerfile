# Builds the web app and serves it with nginx, for `docker compose up` (../compose.yaml).
# VITE_RELAY_URL is left unset, so the app connects to ws://<page host>:7777.
FROM node:24-slim AS build
RUN npm install -g pnpm@9.12.0
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM nginx:1.29-alpine
COPY --from=build /app/dist /usr/share/nginx/html
