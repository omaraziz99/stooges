// Command seed loads sample channels and conversations into a running relay.
// Each dummy user signs in over WebSocket like a real client, so the data goes
// through the same validation as the app. Keys are derived from user names,
// so re-running the seed creates no duplicates. It also creates the demo email
// accounts (see demo_accounts in the seed file) in the relay's database, and
// the performance reviews the demo manager has booked (see reviews).
//
//	go run ./cmd/seed                                        # seed/demo.json -> ws://localhost:7777, accounts in stooges.db
//	go run ./cmd/seed -relay ws://localhost:7777 -db /path/to/stooges.db
package main

import (
	"cmp"
	"context"
	"crypto/sha256"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	"slices"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/btcsuite/btcd/btcec/v2"

	"stooges/be/internal/accounts"
	"stooges/be/internal/client"
	"stooges/be/internal/config"
	"stooges/be/internal/nostr"
	"stooges/be/internal/store"
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

type demoAccount struct {
	Name     string `json:"name"` // one of Users; the account owns their messages
	Email    string `json:"email"`
	Password string `json:"password"`
	Role     string `json:"role"` // employee or manager
}

// review is a performance review a manager has booked, days from the day the
// seed runs (negative: in the past), so the dashboard's suggestions stay
// meaningful whenever the demo is started.
type review struct {
	By          string `json:"by"` // a manager in demo_accounts
	Person      string `json:"person"`
	DaysFromNow int    `json:"days_from_now"`
	Note        string `json:"note,omitempty"`
}

type seedFile struct {
	Users []string `json:"users"`
	// DemoAccounts are email logins for seeded users, to show the app with.
	DemoAccounts []demoAccount `json:"demo_accounts"`
	Channels     []channel     `json:"channels"`
	Reviews      []review      `json:"reviews"`
}

// demoZone is the time zone of the demo data (its messages are at +08:00);
// seeded reviews start at 10:00 there.
var demoZone = time.FixedZone("+08:00", 8*60*60)

func main() {
	file := flag.String("file", "seed/demo.json", "seed data file")
	relayURL := flag.String("relay", "ws://localhost:7777", "relay WebSocket URL")
	dbPath := flag.String("db", "", `the relay's SQLite file, for the demo accounts (default: DB_PATH, else "stooges.db")`)
	flag.Parse()
	if err := config.LoadDotEnv(".env"); err != nil {
		log.Fatal(err)
	}
	if *dbPath == "" {
		*dbPath = cmp.Or(os.Getenv("DB_PATH"), "stooges.db")
	}
	if err := run(*file, *relayURL, *dbPath); err != nil {
		log.Fatal(err)
	}
}

func run(path, relayURL, dbPath string) error {
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

	// Accounts first: the relay decides at sign-in whether someone is a
	// manager, and only managers may book reviews.
	haveAccounts, err := seedAccounts(seed.DemoAccounts, dbPath)
	if err != nil {
		return err
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

	if haveAccounts {
		if err := seedReviews(seed.Reviews, users, &stats); err != nil {
			return err
		}
	} else if len(seed.Reviews) > 0 {
		fmt.Println("Skipped review bookings: they need the demo manager's account (see -db).")
	}

	fmt.Printf("done: %d new events, %d already there, %d users, %d channels\n",
		stats.added, stats.duplicates, len(seed.Users), len(seed.Channels))
	return nil
}

// seedReviews books the demo performance reviews as their manager: NIP-52
// calendar events (kind 31923) for one person each, from 10:00 for an hour.
// A booking that is already there is left alone, so changes made in the app
// survive a re-seed.
func seedReviews(reviews []review, users map[string]*client.Conn, stats *counter) error {
	for _, rv := range reviews {
		d := "seed-review-" + strings.ToLower(strings.ReplaceAll(rv.Person, " ", "-"))
		existing, err := users[rv.By].Query("review", map[string]any{
			"kinds": []int{nostr.KindCalendarEvent}, "authors": []string{nostr.PubKeyHex(keyFor(rv.By))}, "#d": []string{d},
		})
		if err != nil {
			return err
		}
		if len(existing) > 0 {
			stats.duplicates++
			continue
		}
		day := time.Now().In(demoZone).AddDate(0, 0, rv.DaysFromNow)
		start := time.Date(day.Year(), day.Month(), day.Day(), 10, 0, 0, 0, demoZone)
		_, ok, reason, err := users[rv.By].Publish(nostr.KindCalendarEvent, time.Now(), rv.Note,
			nostr.Tag{"d", d},
			nostr.Tag{"p", nostr.PubKeyHex(keyFor(rv.Person))},
			nostr.Tag{"title", "Performance review: " + rv.Person},
			nostr.Tag{"start", strconv.FormatInt(start.Unix(), 10)},
			nostr.Tag{"end", strconv.FormatInt(start.Add(time.Hour).Unix(), 10)},
		)
		stats.add(ok, reason, err)
	}
	return nil
}

// seedAccounts creates the demo email accounts, and reports whether it did.
// Accounts live in the relay's database rather than in events, so this writes
// to it directly; it must be the same file the relay uses.
func seedAccounts(accts []demoAccount, dbPath string) (bool, error) {
	if len(accts) == 0 {
		return false, nil
	}
	if _, err := os.Stat(dbPath); err != nil {
		fmt.Printf("Skipped demo accounts: no relay database at %s (pass -db with the relay's DB_PATH).\n", dbPath)
		return false, nil
	}
	st, err := store.Open(dbPath)
	if err != nil {
		return false, err
	}
	defer st.Close()

	fmt.Println("\nDemo accounts (fictional; log in with email and password):")
	for _, a := range accts {
		if _, err := accounts.Provision(context.Background(), st, a.Email, a.Password, keyFor(a.Name), a.Role); err != nil {
			return false, fmt.Errorf("demo account %s: %w", a.Email, err)
		}
		fmt.Printf("  %-8s  %-12s  %-20s  %s\n", a.Role, a.Name, a.Email, a.Password)
	}
	fmt.Println("Managers see everyone's KPI report; employees see only their own.")
	fmt.Println()
	return true, nil
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
	for _, a := range s.DemoAccounts {
		if !slices.Contains(s.Users, a.Name) {
			return fmt.Errorf("demo account %q is not in users", a.Name)
		}
		if a.Role != store.RoleEmployee && a.Role != store.RoleManager {
			return fmt.Errorf("demo account %q: role must be %q or %q", a.Name, store.RoleEmployee, store.RoleManager)
		}
	}
	for _, rv := range s.Reviews {
		manager := slices.ContainsFunc(s.DemoAccounts, func(a demoAccount) bool { return a.Name == rv.By && a.Role == store.RoleManager })
		if !manager || !slices.Contains(s.Users, rv.Person) {
			return fmt.Errorf("review of %q by %q: the person must be in users and the booker a manager in demo_accounts", rv.Person, rv.By)
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
