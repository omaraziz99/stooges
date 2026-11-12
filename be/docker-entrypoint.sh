#!/bin/sh
# Starts the relay. With SEED_ON_START=true it also loads the fictional demo
# data once the relay is up, so a fresh deploy never starts empty. Seeding is
# idempotent: data already there is skipped.
set -e

# Local demo only (compose.yaml sets KPI_SAMPLE_ON_START): create a KPI agent
# key on the volume, readable by the relay and `kpi` as /app/.env, so the
# sample report below can be published. Never set it on a hosted relay: the
# agent's secret key would then live on the server.
if [ "$KPI_SAMPLE_ON_START" = "true" ]; then
	[ -f /data/kpi-agent.env ] || kpi -keygen > /data/kpi-agent.env
	ln -sf /data/kpi-agent.env /app/.env
fi

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
seed -file /app/seed/demo.json -relay "ws://127.0.0.1:$port" -db "$DB_PATH" || echo "seed failed" >&2

# Once per volume, so a restart never overwrites a report from a real AI run.
if [ "$KPI_SAMPLE_ON_START" = "true" ] && [ ! -f /data/.kpi-sample-done ]; then
	kpi -sample -relay "ws://127.0.0.1:$port" && touch /data/.kpi-sample-done || echo "sample KPI report failed" >&2
fi

wait "$pid"
