// Command seed loads sample channels and conversations into a running relay.
// Each dummy user signs in over WebSocket like a real client, so the data goes
// through the same validation as the app. Keys are derived from user names,
// so re-running the seed creates no duplicates.
//
//	go run ./cmd/seed                                        # seed/demo.json -> ws://localhost:7777
//	go run ./cmd/seed -relay wss://your-relay.up.railway.app
package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	"slices"
	"sort"
	"strings"
	"time"

	"github.com/btcsuite/btcd/btcec/v2"

	"stooges/be/internal/client"
	"stooges/be/internal/nostr"
)

type reaction struct {
	Emoji string   `json:"emoji"`
	By    []string `json:"by"`
}

type message struct {
	Author    string     `json:"author"`
	At        time.Time  `json:"at"`
	Text      string     `json:"text"`
	Reactions []reaction `json:"reactions,omitempty"`
	Replies   []message  `json:"replies,omitempty"`
}

type channel struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	About     string    `json:"about"`
	KPIReview bool      `json:"kpi_review"` // a work channel the KPI agent may read
	Messages  []message `json:"messages"`
}

type seedFile struct {
	Users []string `json:"users"`
	// DemoAccounts names the two users to sign in as when showing the app.
	DemoAccounts struct {
		Employee string `json:"employee"`
		Manager  string `json:"manager"`
	} `json:"demo_accounts"`
	Channels []channel `json:"channels"`
}

func main() {
	file := flag.String("file", "seed/demo.json", "seed data file")
	relayURL := flag.String("relay", "ws://localhost:7777", "relay WebSocket URL")
	flag.Parse()
	if err := run(*file, *relayURL); err != nil {
		log.Fatal(err)
	}
}

func run(path, relayURL string) error {
	raw, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	var seed seedFile
	if err := json.Unmarshal(raw, &seed); err != nil {
		return fmt.Errorf("parse %s: %w", path, err)
	}
	if err := validate(&seed); err != nil {
		return err
	}
	// Profiles and channels are dated just before the earliest message.
	var start time.Time
	for i := range seed.Channels {
		msgs := seed.Channels[i].Messages
		sort.SliceStable(msgs, func(a, b int) bool { return msgs[a].At.Before(msgs[b].At) })
		if start.IsZero() || msgs[0].At.Before(start) {
			start = msgs[0].At
		}
	}

	// Sign every user in.
	users := map[string]*client.Conn{}
	for _, name := range seed.Users {
		c, err := client.Dial(relayURL)
		if err != nil {
			return fmt.Errorf("connect as %s: %w", name, err)
		}
		defer c.Close()
		if err := c.Login(keyFor(name)); err != nil {
			return fmt.Errorf("sign in %s: %w", name, err)
		}
		users[name] = c
	}

	var stats counter
	// Fixed timestamps keep every event ID stable across runs.
	for _, name := range seed.Users {
		profile, _ := json.Marshal(map[string]string{"name": name})
		_, ok, reason, err := users[name].Publish(nostr.KindProfile, start.Add(-time.Hour), string(profile))
		stats.add(ok, reason, err)
		// Without an opt-in the KPI agent would not read their messages.
		_, ok, reason, err = users[name].Publish(nostr.KindAppData, start.Add(-time.Hour), `{"consent":true}`,
			nostr.Tag{"d", nostr.KPIConsentTag})
		stats.add(ok, reason, err)
	}

	for i := range seed.Channels {
		if err := seedChannel(&seed.Channels[i], users, start, &stats); err != nil {
			return err
		}
	}

	fmt.Printf("done: %d new events, %d already there, %d users, %d channels\n",
		stats.added, stats.duplicates, len(seed.Users), len(seed.Channels))

	// Keys are derived from names, so anyone with this repository can derive
	// them too: demo data only.
	secret := func(name string) string { return hex.EncodeToString(keyFor(name).Serialize()) }
	employee, manager := seed.DemoAccounts.Employee, seed.DemoAccounts.Manager
	fmt.Println("\nDemo accounts. In the app, sign in with an existing key and paste the secret key:")
	fmt.Printf("  Employee  %-12s secret key %s\n", employee, secret(employee))
	fmt.Printf("  Manager   %-12s secret key %s\n", manager, secret(manager))
	fmt.Printf("\nThe manager sees everyone's KPI report; others see only their own. To make this account a manager,\nset this on the relay (be/.env locally) and restart it:\n  MANAGER_PUBKEYS=%s\n",
		nostr.PubKeyHex(keyFor(manager)))
	return nil
}

// seedChannel creates one channel, as the author of its first message, and posts its history.
func seedChannel(ch *channel, users map[string]*client.Conn, start time.Time, stats *counter) error {
	creator := users[ch.Messages[0].Author]
	kpi := "off"
	if ch.KPIReview {
		kpi = "on"
	}
	_, ok, reason, err := creator.Publish(nostr.KindCreateGroup, start.Add(-2*time.Hour), "",
		nostr.Tag{"h", ch.ID}, nostr.Tag{"name", ch.Name}, nostr.Tag{"about", ch.About}, nostr.Tag{"kpi", kpi})
	switch {
	case err != nil:
		return err
	case ok:
		fmt.Printf("created #%s (KPI review %s)\n", ch.ID, kpi)
	case strings.Contains(reason, "already exists"):
		fmt.Printf("#%s already exists, adding to it (KPI review %s)\n", ch.ID, kpi)
		// It may predate the KPI review setting, so set it as its creator.
		_, ok, reason, err := creator.Publish(nostr.KindEditGroup, start.Add(-2*time.Hour), "",
			nostr.Tag{"h", ch.ID}, nostr.Tag{"kpi", kpi})
		if err != nil {
			return err
		}
		if !ok {
			fmt.Printf("warning: could not set KPI review for #%s: %s\n", ch.ID, reason)
		}
	default:
		return fmt.Errorf("create #%s: %s", ch.ID, reason)
	}

	channelTag := nostr.Tag{"h", ch.ID}
	var post func(m message, root string) error
	post = func(m message, root string) error {
		tags := []nostr.Tag{channelTag}
		if root != "" {
			tags = append(tags, nostr.Tag{"e", root, "", "root"})
		}
		ev, ok, reason, err := users[m.Author].Publish(nostr.KindChatMessage, m.At, m.Text, tags...)
		stats.add(ok, reason, err)
		if err != nil || !ok {
			return fmt.Errorf("post by %s at %s: %s %v", m.Author, m.At.Format(time.RFC3339), reason, err)
		}
		for _, r := range m.Reactions {
			for _, who := range r.By {
				_, ok, reason, err := users[who].Publish(nostr.KindReaction, m.At.Add(30*time.Second), r.Emoji,
					nostr.Tag{"e", ev.ID}, nostr.Tag{"p", ev.PubKey}, channelTag)
				stats.add(ok, reason, err)
			}
		}
		for _, reply := range m.Replies {
			if err := post(reply, ev.ID); err != nil {
				return err
			}
		}
		return nil
	}
	for _, m := range ch.Messages {
		if err := post(m, ""); err != nil {
			return err
		}
	}
	return nil
}

// validate checks the file is complete and every author and reactor is a declared user.
func validate(s *seedFile) error {
	if len(s.Channels) == 0 {
		return fmt.Errorf("seed needs at least one channel")
	}
	for _, name := range []string{s.DemoAccounts.Employee, s.DemoAccounts.Manager} {
		if !slices.Contains(s.Users, name) {
			return fmt.Errorf("demo account %q is not in users", name)
		}
	}
	var check func(m message) error
	check = func(m message) error {
		if !slices.Contains(s.Users, m.Author) {
			return fmt.Errorf("author %q is not in users", m.Author)
		}
		for _, r := range m.Reactions {
			for _, who := range r.By {
				if !slices.Contains(s.Users, who) {
					return fmt.Errorf("reactor %q is not in users", who)
				}
			}
		}
		for _, reply := range m.Replies {
			if err := check(reply); err != nil {
				return err
			}
		}
		return nil
	}
	for _, ch := range s.Channels {
		if ch.ID == "" || len(ch.Messages) == 0 {
			return fmt.Errorf("every channel needs an id and at least one message")
		}
		for _, m := range ch.Messages {
			if err := check(m); err != nil {
				return fmt.Errorf("#%s: %w", ch.ID, err)
			}
		}
	}
	return nil
}

type counter struct{ added, duplicates int }

func (c *counter) add(ok bool, reason string, err error) {
	switch {
	case err != nil || !ok:
		log.Printf("warning: %s %v", reason, err)
	case strings.HasPrefix(reason, "duplicate"):
		c.duplicates++
	default:
		c.added++
	}
}

// keyFor derives a stable key from the name, so each dummy user keeps the
// same identity every time the seed runs. Only for sample data.
func keyFor(name string) *btcec.PrivateKey {
	sum := sha256.Sum256([]byte("stooges-seed:" + name))
	priv, _ := btcec.PrivKeyFromBytes(sum[:])
	return priv
}
