#!/bin/sh
# Starts the relay. With SEED_ON_START=true it also loads the fictional demo
# data once the relay is up, so a fresh deploy never starts empty. Seeding is
# idempotent: data already there is skipped.
set -e

if [ "$SEED_ON_START" != "true" ]; then
	exec relay
fi

relay &
pid=$!
trap 'kill -TERM "$pid" 2>/dev/null' TERM INT

port="${PORT:-7777}"
i=0
until wget -q -O /dev/null "http://127.0.0.1:$port/" 2>/dev/null; do
	i=$((i + 1))
	if [ "$i" -ge 100 ]; then
		echo "relay did not start; skipping seed" >&2
		break
	fi
	sleep 0.1
done
seed -file /app/seed/project-orbit.json -relay "ws://127.0.0.1:$port" || echo "seed failed" >&2

wait "$pid"
