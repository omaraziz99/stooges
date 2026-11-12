// Command relay runs the chat backend: a Nostr relay over WebSockets.
//
// Environment (or .env in the working directory):
//
//	PORT              port to listen on (set by Railway; default 7777)
//	ADDR              full listen address, overrides PORT (e.g. 127.0.0.1:7777)
//	DB_PATH           SQLite file (default "stooges.db"; use a volume in production)
//	KPI_AGENT_PUBKEY  the KPI agent's public key; only it may publish reports.
//	                  Locally, KPI_AGENT_SECRET in .env works too.
//	MANAGER_PUBKEYS   comma-separated hex public keys that may read everyone's KPI
//	                  report; everyone else reads only their own
//	ALLOWED_ORIGINS   comma-separated web origins allowed to connect (default: any)
package main

import (
	"context"
	"encoding/hex"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/btcsuite/btcd/btcec/v2"

	"stooges/be/internal/accounts"
	"stooges/be/internal/config"
	"stooges/be/internal/nostr"
	"stooges/be/internal/relay"
	"stooges/be/internal/store"
)

const relayKeyMeta = "relay_secret_key"

func main() {
	log := slog.New(slog.NewTextHandler(os.Stdout, nil))
	if err := run(log); err != nil {
		log.Error("relay stopped", "err", err)
		os.Exit(1)
	}
}

func run(log *slog.Logger) error {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	if err := config.LoadDotEnv(".env"); err != nil {
		return err
	}
	addr := envOr("ADDR", ":"+envOr("PORT", "7777"))
	dbPath := envOr("DB_PATH", "stooges.db")

	st, err := store.Open(dbPath)
	if err != nil {
		return err
	}
	defer st.Close()

	key, err := loadOrCreateKey(ctx, st)
	if err != nil {
		return err
	}

	opts := relay.Options{
		KPIPublisher:   kpiPublisher(log),
		Managers:       managers(log),
		AllowedOrigins: splitList(os.Getenv("ALLOWED_ORIGINS")),
	}
	r := relay.New(st, key, log, opts)
	if err := r.EnsureDefaultChannel(ctx); err != nil {
		return err
	}

	// /api/* is email sign-up and log-in; everything else is the relay.
	mux := http.NewServeMux()
	mux.Handle("/api/", accounts.New(st, log, opts.AllowedOrigins))
	mux.Handle("/", r)

	srv := &http.Server{Addr: addr, Handler: mux, ReadHeaderTimeout: 10 * time.Second}
	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		srv.Shutdown(shutdownCtx)
	}()

	log.Info("relay listening", "addr", addr, "db", dbPath, "relay_pubkey", r.PubKey())
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}

// loadOrCreateKey returns the relay's signing key, creating and saving one on first run.
func loadOrCreateKey(ctx context.Context, st *store.Store) (*btcec.PrivateKey, error) {
	stored, ok, err := st.GetMeta(ctx, relayKeyMeta)
	if err != nil {
		return nil, err
	}
	if ok {
		b, err := hex.DecodeString(stored)
		if err != nil {
			return nil, err
		}
		priv, _ := btcec.PrivKeyFromBytes(b)
		return priv, nil
	}
	priv, err := btcec.NewPrivateKey()
	if err != nil {
		return nil, err
	}
	if err := st.SetMeta(ctx, relayKeyMeta, hex.EncodeToString(priv.Serialize())); err != nil {
		return nil, err
	}
	return priv, nil
}

// kpiPublisher returns the KPI agent's pubkey from KPI_AGENT_PUBKEY, or
// derives it from KPI_AGENT_SECRET when both run from the same .env locally.
func kpiPublisher(log *slog.Logger) string {
	if pub := strings.TrimSpace(os.Getenv("KPI_AGENT_PUBKEY")); pub != "" {
		return pub
	}
	if b, err := hex.DecodeString(strings.TrimSpace(os.Getenv("KPI_AGENT_SECRET"))); err == nil && len(b) == 32 {
		priv, _ := btcec.PrivKeyFromBytes(b)
		return nostr.PubKeyHex(priv)
	}
	log.Warn("KPI reports disabled: set KPI_AGENT_PUBKEY (see `go run ./cmd/kpi -keygen`)")
	return ""
}

// managers reads MANAGER_PUBKEYS, skipping entries that are not public keys.
func managers(log *slog.Logger) []string {
	var out []string
	for _, m := range splitList(os.Getenv("MANAGER_PUBKEYS")) {
		m = strings.ToLower(m)
		if b, err := hex.DecodeString(m); err != nil || len(b) != 32 {
			log.Warn("ignoring MANAGER_PUBKEYS entry: expected 64 hex characters", "entry", m)
			continue
		}
		out = append(out, m)
	}
	if len(out) == 0 {
		log.Warn("no managers set: people can read their own KPI report, but nobody can read the team's (set MANAGER_PUBKEYS)")
	} else {
		log.Info("managers can read every KPI report; everyone else only their own", "managers", len(out))
	}
	return out
}

func splitList(s string) []string {
	var out []string
	for _, part := range strings.Split(s, ",") {
		if p := strings.TrimSpace(part); p != "" {
			out = append(out, p)
		}
	}
	return out
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
