// Command kpi reads team channels from the relay, asks an AI model what each
// person visibly contributed to their level's KPI items (be/internal/kpi/
// framework.go), drafts a review per person, and publishes the report to the
// relay for the dashboard and the /kpi-<name> command.
//
//	go run ./cmd/kpi -keygen                     # once: create the agent identity
//	go run ./cmd/kpi                             # review every channel marked for KPI insights, with Gemini
//	go run ./cmd/kpi -channel project-orbit      # only this channel
//	go run ./cmd/kpi -provider claude
//	go run ./cmd/kpi -dry-run                    # preview what would be sent, no API calls
//	go run ./cmd/kpi -sample                     # demo report from keyword rules: no AI, no API key
//	go run ./cmd/kpi -team seed/team.json        # each person's level (default file shown)
//	go run ./cmd/kpi -relay wss://your-relay.up.railway.app
//
// Settings come from the environment or .env:
//
//	GEMINI_API_KEY, GEMINI_MODEL   for -provider gemini (default)
//	ANTHROPIC_API_KEY              for -provider claude
//	KPI_AGENT_SECRET               the agent's signing key (from -keygen)
package main

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"

	"github.com/btcsuite/btcd/btcec/v2"

	"stooges/be/internal/config"
	"stooges/be/internal/kpi"
	"stooges/be/internal/nostr"
)

func main() {
	relayURL := flag.String("relay", "ws://localhost:7777", "relay WebSocket URL")
	channels := flag.String("channel", "", "comma-separated channel IDs to review (default: every channel marked for KPI insights)")
	out := flag.String("out", "", "also write the report to this file (optional)")
	provider := flag.String("provider", "gemini", `AI provider: "gemini" or "claude"`)
	model := flag.String("model", "", "model name (default: GEMINI_MODEL or "+kpi.DefaultGeminiModel+" for gemini, "+kpi.DefaultModel+" for claude)")
	batch := flag.Int("batch", 8, "conversations sent per request (fewer requests = less quota)")
	parallel := flag.Int("parallel", 2, "requests in flight at once")
	cachePath := flag.String("cache", ".kpi-cache.json", `result cache so re-runs only send new conversations ("" to disable)`)
	dryRun := flag.Bool("dry-run", false, "show the conversations that would be sent, without calling the model")
	keygen := flag.Bool("keygen", false, "print a new agent key pair and exit")
	sample := flag.Bool("sample", false, "build a sample report from keyword rules instead of an AI model (for demos; no API key needed)")
	teamPath := flag.String("team", "seed/team.json", "JSON file with each person's KPI level")
	envFile := flag.String("env", ".env", "file with settings (environment variables take priority)")
	flag.Parse()

	if *keygen {
		printNewKey()
		return
	}
	if err := config.LoadDotEnv(*envFile); err != nil {
		log.Fatalf("read %s: %v", *envFile, err)
	}

	var agentKey *btcec.PrivateKey
	if !*dryRun {
		var err error
		if agentKey, err = loadAgentKey(); err != nil {
			log.Fatal(err)
		}
	}

	team, err := kpi.LoadTeam(*teamPath)
	if err != nil {
		log.Fatal(err)
	}

	var agent kpi.Agent
	switch {
	case *sample:
		agent = kpi.SampleAgent{}
		*cachePath = "" // instant, and keeps sample results out of the AI cache
	default:
		switch *provider {
		case "gemini":
			modelName := firstNonEmpty(*model, os.Getenv("GEMINI_MODEL"), kpi.DefaultGeminiModel)
			key := os.Getenv("GEMINI_API_KEY")
			if key == "" && !*dryRun {
				log.Fatalf("no Gemini API key: set GEMINI_API_KEY (in %s or the environment), or use -dry-run", *envFile)
			}
			agent = kpi.NewGemini(key, modelName)
		case "claude":
			if !*dryRun && os.Getenv("ANTHROPIC_API_KEY") == "" && os.Getenv("ANTHROPIC_AUTH_TOKEN") == "" {
				log.Fatalf("no Claude API key: set ANTHROPIC_API_KEY (in %s or the environment), or use -dry-run", *envFile)
			}
			agent = kpi.NewClaude(firstNonEmpty(*model, kpi.DefaultModel))
		default:
			log.Fatalf(`unknown -provider %q: use "gemini" or "claude"`, *provider)
		}
	}

	opts := options{
		relayURL: *relayURL, channels: splitList(*channels), out: *out, cachePath: *cachePath,
		batch: *batch, parallel: *parallel, dryRun: *dryRun, agentKey: agentKey, team: team,
	}
	if err := run(agent, opts); err != nil {
		log.Fatal(err)
	}
}

// loadAgentKey reads KPI_AGENT_SECRET (64 hex characters).
func loadAgentKey() (*btcec.PrivateKey, error) {
	secret := strings.TrimSpace(os.Getenv("KPI_AGENT_SECRET"))
	if secret == "" {
		return nil, fmt.Errorf("no agent key: run `go run ./cmd/kpi -keygen`, put KPI_AGENT_SECRET in .env, and give the relay its KPI_AGENT_PUBKEY")
	}
	b, err := hex.DecodeString(secret)
	if err != nil || len(b) != 32 {
		return nil, fmt.Errorf("KPI_AGENT_SECRET must be 64 hex characters")
	}
	priv, _ := btcec.PrivKeyFromBytes(b)
	return priv, nil
}

func printNewKey() {
	priv, err := btcec.NewPrivateKey()
	if err != nil {
		log.Fatal(err)
	}
	fmt.Println("# Agent (where cmd/kpi runs, e.g. be/.env). Keep this secret.")
	fmt.Printf("KPI_AGENT_SECRET=%s\n\n", hex.EncodeToString(priv.Serialize()))
	fmt.Println("# Relay (e.g. Railway variables). Public; only this key may publish KPI reports.")
	fmt.Printf("KPI_AGENT_PUBKEY=%s\n", nostr.PubKeyHex(priv))
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}

type options struct {
	relayURL  string
	channels  []string
	out       string
	cachePath string
	batch     int
	parallel  int
	dryRun    bool
	agentKey  *btcec.PrivateKey
	team      kpi.Team
}

func run(agent kpi.Agent, opts options) error {
	model := agent.ModelName()
	if len(opts.channels) == 0 {
		marked, err := kpi.ReviewableChannels(opts.relayURL)
		if err != nil {
			return fmt.Errorf("list channels: %w", err)
		}
		if len(marked) == 0 {
			return fmt.Errorf("no channel is marked for KPI insights; a channel's creator turns that on from its header in the app")
		}
		opts.channels = marked
	}
	var units []kpi.Unit
	for _, ch := range opts.channels {
		u, err := kpi.LoadChannel(opts.relayURL, ch)
		if err != nil {
			return fmt.Errorf("load #%s: %w", ch, err)
		}
		fmt.Printf("#%s: %d conversations\n", ch, len(u))
		units = append(units, u...)
	}
	kpi.AssignLevels(units, opts.team)
	if len(units) == 0 {
		return fmt.Errorf("nothing to review: no one who has opted in to KPI insights has posted in these channels (the sample data opts its users in: go run ./cmd/seed)")
	}

	if opts.dryRun {
		for i := range units {
			u := &units[i]
			fmt.Printf("\n===== %s %d/%d (%d messages, %s) =====\n%s", u.Kind, i+1, len(units), len(u.Messages),
				strings.Join(u.Participants(), ", "), u.Transcript())
		}
		fmt.Printf("\nDry run: %d conversations would be sent to %s. Nothing was sent.\n", len(units), model)
		return nil
	}

	cache, err := kpi.OpenCache(opts.cachePath)
	if err != nil {
		return fmt.Errorf("open cache %s: %w (delete it to start fresh)", opts.cachePath, err)
	}
	saveCache := func() {
		if err := cache.Save(); err != nil {
			fmt.Printf("warning: could not save cache: %v\n", err)
		}
	}

	fmt.Printf("Reviewing with %s, up to %d conversations per request...\n", model, opts.batch)
	res := kpi.Evaluate(context.Background(), agent, units, kpi.EvalOptions{
		Model: model, Cache: cache, BatchSize: opts.batch, Parallel: opts.parallel,
		Progress: func(done, total, size, kept int, err error) {
			status := fmt.Sprintf("%d contribution(s)", kept)
			if err != nil {
				status = "failed: " + err.Error()
			}
			fmt.Printf("  request %d/%d (%d conversations): %s\n", done, total, size, status)
		},
	})
	saveCache() // keep progress even if the run stopped early
	fmt.Printf("%d conversations from cache, %d reviewed now, %d request(s) made\n", res.Cached, res.Sent, res.Requests)
	if len(res.Evidence) == 0 && len(res.Skipped) == len(units) {
		return fmt.Errorf("no conversation could be reviewed; first error: %s", res.Skipped[0])
	}

	report := kpi.BuildReport(units, res.Evidence, model, opts.channels, res.Skipped)

	quota := res.Quota
	if res.Completed {
		fmt.Println("\nWriting per-person reviews (used by /kpi-<name>)...")
		failed, q := kpi.WriteReviews(context.Background(), agent, &report, kpi.ReviewOptions{
			Model: model, Cache: cache, Parallel: opts.parallel,
			Progress: func(name string, cached bool, err error) {
				switch {
				case err != nil:
					fmt.Printf("  %s: failed: %v\n", name, err)
				case cached:
					fmt.Printf("  %s: from cache\n", name)
				default:
					fmt.Printf("  %s: written\n", name)
				}
			},
		})
		saveCache()
		report.Skipped = append(report.Skipped, failed...)
		if quota == nil {
			quota = q
		}
	} else {
		// Reviews depend on everyone's full evidence; writing them now would
		// spend quota on drafts that the next run replaces.
		fmt.Println("\nSkipping written reviews until every conversation has been reviewed.")
	}

	if err := kpi.PublishReport(opts.relayURL, opts.agentKey, report); err != nil {
		return fmt.Errorf("publish report: %w (does the relay have KPI_AGENT_PUBKEY=%s?)", err, nostr.PubKeyHex(opts.agentKey))
	}
	fmt.Printf("\nPublished the report to %s: %d pieces of evidence for %d people\n", opts.relayURL, len(res.Evidence), len(report.People))
	fmt.Println("Managers can read all of it; everyone else only their own part.")

	if opts.out != "" {
		pretty, _ := json.MarshalIndent(report, "", "  ")
		if err := os.MkdirAll(filepath.Dir(opts.out), 0o755); err != nil {
			return err
		}
		if err := os.WriteFile(opts.out, pretty, 0o644); err != nil {
			return err
		}
		fmt.Printf("Also wrote %s\n", opts.out)
	}

	if quota != nil {
		fmt.Printf("\nStopped early: %v.\nProgress is saved in %s. Run the same command again after the quota resets to finish; finished conversations won't be sent again.\n",
			quota, opts.cachePath)
	} else if len(report.Skipped) > 0 {
		fmt.Printf("%d item(s) failed; run again to retry them:\n  %s\n", len(report.Skipped), strings.Join(report.Skipped, "\n  "))
	}
	return nil
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
