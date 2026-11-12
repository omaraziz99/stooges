# Builds the relay plus the seed and KPI tools into one small image.
# Cross-compiles on the build machine, so building for Railway's linux/amd64
# on an Apple Silicon Mac stays fast.
FROM --platform=$BUILDPLATFORM golang:1.26-alpine AS build
ARG TARGETOS TARGETARCH
WORKDIR /src
COPY go.mod go.sum ./
# HTTP/1.1 plus retries: some networks reset the module proxy's HTTP/2 streams.
RUN for i in 1 2 3; do GODEBUG=http2client=0 go mod download && exit 0; sleep 3; done; exit 1
COPY . .
# Pure-Go SQLite, so no cgo is needed.
ENV CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH
RUN go build -trimpath -ldflags="-s -w" -o /out/relay ./cmd/relay \
 && go build -trimpath -ldflags="-s -w" -o /out/seed ./cmd/seed \
 && go build -trimpath -ldflags="-s -w" -o /out/kpi ./cmd/kpi

FROM alpine:3.22
# CA certificates let the KPI tool call the Gemini/Claude APIs over HTTPS.
RUN apk add --no-cache ca-certificates && mkdir -p /data
COPY --from=build /out/ /usr/local/bin/
COPY seed /app/seed
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh
WORKDIR /app
# On Railway, mount a volume at /data so messages survive redeploys.
ENV DB_PATH=/data/stooges.db
EXPOSE 7777
CMD ["docker-entrypoint.sh"]
