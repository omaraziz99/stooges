// Command seed loads a channel of sample conversation into a running relay.
// Each dummy user signs in over WebSocket like a real client, so the data goes
// through the same validation as the app. Keys are derived from user names,
// so re-running the seed creates no duplicates.
//
//	go run ./cmd/seed                                        # seed/project-orbit.json -> ws://localhost:7777
//	go run ./cmd/seed -relay wss://your-relay.up.railway.app
package main

import (
	"crypto/sha256"
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

type seedFile struct {
	Channel struct {
		ID    string `json:"id"`
		Name  string `json:"name"`
		About string `json:"about"`
	} `json:"channel"`
	Users    []string  `json:"users"`
	Messages []message `json:"messages"`
}

func main() {
	file := flag.String("file", "seed/project-orbit.json", "seed data file")
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
	sort.SliceStable(seed.Messages, func(i, j int) bool { return seed.Messages[i].At.Before(seed.Messages[j].At) })
	start := seed.Messages[0].At

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
	}

	creator := users[seed.Messages[0].Author]
	_, ok, reason, err := creator.Publish(nostr.KindCreateGroup, start.Add(-2*time.Hour), "",
		nostr.Tag{"h", seed.Channel.ID}, nostr.Tag{"name", seed.Channel.Name}, nostr.Tag{"about", seed.Channel.About})
	switch {
	case err != nil:
		return err
	case ok:
		fmt.Printf("created channel #%s\n", seed.Channel.ID)
	case strings.Contains(reason, "already exists"):
		fmt.Printf("channel #%s already exists, adding to it\n", seed.Channel.ID)
	default:
		return fmt.Errorf("create channel: %s", reason)
	}

	channelTag := nostr.Tag{"h", seed.Channel.ID}
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
	for _, m := range seed.Messages {
		if err := post(m, ""); err != nil {
			return err
		}
	}

	fmt.Printf("done: %d new events, %d already there, %d users\n", stats.added, stats.duplicates, len(seed.Users))
	return nil
}

// validate checks every author and reactor is a declared user.
func validate(s *seedFile) error {
	if s.Channel.ID == "" || len(s.Messages) == 0 {
		return fmt.Errorf("seed needs a channel id and at least one message")
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
	for _, m := range s.Messages {
		if err := check(m); err != nil {
			return err
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
