package relay

import (
	"strconv"
	"strings"
	"testing"
	"time"

	"stooges/be/internal/nostr"
)

// booking is a one-hour performance review for person, starting tomorrow.
func booking(d, person string) []nostr.Tag {
	start := time.Now().Add(24 * time.Hour).Unix()
	return []nostr.Tag{
		{"d", d}, {"p", person}, {"title", "Performance review"},
		{"start", strconv.FormatInt(start, 10)}, {"end", strconv.FormatInt(start+3600, 10)},
	}
}

func TestOnlyManagersBookReviews(t *testing.T) {
	url := newTestRelay(t)
	employee, ch := dial(t, url)
	employee.login(ch)
	someone := nostr.PubKeyHex(employee.priv)
	if ok, reason := employee.publish(employee.signed(nostr.KindCalendarEvent, "", booking("r1", someone)...)); ok || !strings.HasPrefix(reason, "restricted") {
		t.Fatalf("an employee must not book a review, got ok=%v %q", ok, reason)
	}

	boss, chBoss := dial(t, url)
	boss.priv = bossKey
	boss.login(chBoss)
	if ok, reason := boss.publish(boss.signed(nostr.KindCalendarEvent, "Bring your goals", booking("r1", someone)...)); !ok {
		t.Fatalf("a manager should book a review: %s", reason)
	}
	for name, tags := range map[string][]nostr.Tag{
		"no person":         {{"d", "r2"}, {"start", "1800000000"}},
		"two people":        {{"d", "r2"}, {"p", someone}, {"p", bossPub}, {"start", "1800000000"}},
		"no start":          {{"d", "r2"}, {"p", someone}},
		"ends before start": {{"d", "r2"}, {"p", someone}, {"start", "1800000000"}, {"end", "1700000000"}},
		"no d tag":          {{"p", someone}, {"start", "1800000000"}},
	} {
		if ok, _ := boss.publish(boss.signed(nostr.KindCalendarEvent, "", tags...)); ok {
			t.Errorf("%s: the booking should be rejected", name)
		}
	}
}

func TestOnlyThePersonAndManagersSeeABooking(t *testing.T) {
	url := newTestRelay(t)
	maya, chMaya := dial(t, url)
	leo, chLeo := dial(t, url)
	mayaPub := nostr.PubKeyHex(maya.priv)
	bookings := map[string]any{"kinds": []int{nostr.KindCalendarEvent}}

	boss, chBoss := dial(t, url)
	boss.priv = bossKey
	boss.login(chBoss)
	if ok, reason := boss.publish(boss.signed(nostr.KindCalendarEvent, "", booking("maya-q4", mayaPub)...)); !ok {
		t.Fatalf("a manager should book a review: %s", reason)
	}

	// Maya subscribes before signing in, as the web app does: nothing until
	// her login proves who she is, then her booking.
	maya.send("REQ", "b", bookings)
	if msg := maya.read(); msg[0] != "EOSE" {
		t.Fatalf("no booking should be readable before login, got %v", msg)
	}
	maya.login(chMaya)
	if msg := maya.read(); msg[0] != "EVENT" || msg[2].(map[string]any)["pubkey"] != bossPub {
		t.Fatalf("Maya should get her booking after login, got %v", msg)
	}

	leo.login(chLeo)
	leo.send("REQ", "b", bookings)
	if msg := leo.read(); msg[0] != "EOSE" {
		t.Fatalf("Leo must not see Maya's booking, got %v", msg)
	}

	boss.send("REQ", "b", bookings)
	if msg := boss.read(); msg[0] != "EVENT" {
		t.Fatalf("a manager should see the booking, got %v", msg)
	}
	if msg := boss.read(); msg[0] != "EOSE" {
		t.Fatalf("expected one booking, got %v", msg)
	}
}
