# Builds the relay plus the seed and KPI tools into one small image.
FROM golang:1.26-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
# Pure-Go SQLite, so no cgo is needed.
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/relay ./cmd/relay \
 && CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/seed ./cmd/seed \
 && CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/kpi ./cmd/kpi

FROM alpine:3.22
# CA certificates let the KPI tool call the Gemini/Claude APIs over HTTPS.
RUN apk add --no-cache ca-certificates && mkdir -p /data
COPY --from=build /out/ /usr/local/bin/
COPY seed /app/seed
WORKDIR /app
# Mount a volume at /data so messages survive redeploys.
ENV DB_PATH=/data/stooges.db
EXPOSE 7777
CMD ["relay"]
