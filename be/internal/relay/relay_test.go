package relay

import (
	"context"
	"io"
	"log/slog"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/btcsuite/btcd/btcec/v2"
	"github.com/gorilla/websocket"

	"stooges/be/internal/nostr"
	"stooges/be/internal/store"
)

type testConn struct {
	t    *testing.T
	ws   *websocket.Conn
	priv *btcec.PrivateKey
}

func newTestRelay(t *testing.T) string {
	t.Helper()
	st, err := store.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	key, _ := btcec.NewPrivateKey()
	r := New(st, key, slog.New(slog.NewTextHandler(io.Discard, nil)), Options{KPIPublisher: agentPub})
	if err := r.EnsureDefaultChannel(context.Background()); err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)
	return "ws" + strings.TrimPrefix(srv.URL, "http")
}

// dial connects and returns the AUTH challenge the relay sends first.
func dial(t *testing.T, url string) (*testConn, string) {
	t.Helper()
	ws, _, err := websocket.DefaultDialer.Dial(url, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { ws.Close() })
	priv, _ := btcec.NewPrivateKey()
	c := &testConn{t: t, ws: ws, priv: priv}
	msg := c.read()
	if msg[0] != "AUTH" {
		t.Fatalf("expected AUTH challenge first, got %v", msg)
	}
	return c, msg[1].(string)
}

func (c *testConn) send(parts ...any) {
	c.t.Helper()
	if err := c.ws.WriteJSON(parts); err != nil {
		c.t.Fatal(err)
	}
}

func (c *testConn) read() []any {
	c.t.Helper()
	c.ws.SetReadDeadline(time.Now().Add(3 * time.Second))
	var msg []any
	if err := c.ws.ReadJSON(&msg); err != nil {
		c.t.Fatalf("read: %v", err)
	}
	return msg
}

func (c *testConn) signed(kind int, content string, tags ...nostr.Tag) *nostr.Event {
	c.t.Helper()
	ev := &nostr.Event{CreatedAt: time.Now().Unix(), Kind: kind, Tags: tags, Content: content}
	if err := ev.Sign(c.priv); err != nil {
		c.t.Fatal(err)
	}
	return ev
}

// publish sends an event and returns the relay's OK result and message.
func (c *testConn) publish(ev *nostr.Event) (bool, string) {
	c.t.Helper()
	c.send("EVENT", ev)
	for {
		msg := c.read()
		if msg[0] == "OK" && msg[1] == ev.ID {
			return msg[2].(bool), msg[3].(string)
		}
	}
}

func (c *testConn) login(challenge string) {
	c.t.Helper()
	auth := c.signed(nostr.KindAuth, "", nostr.Tag{"relay", "ws://test"}, nostr.Tag{"challenge", challenge})
	c.send("AUTH", auth)
	msg := c.read()
	if msg[0] != "OK" || msg[2] != true {
		c.t.Fatalf("auth failed: %v", msg)
	}
}

func TestPublishRequiresLogin(t *testing.T) {
	url := newTestRelay(t)
	c, _ := dial(t, url)
	ok, reason := c.publish(c.signed(nostr.KindChatMessage, "hi", nostr.Tag{"h", "general"}))
	if ok || !strings.HasPrefix(reason, "auth-required") {
		t.Fatalf("expected auth-required, got ok=%v %q", ok, reason)
	}
}

func TestChatFlow(t *testing.T) {
	url := newTestRelay(t)
	alice, ch := dial(t, url)
	alice.login(ch)
	bob, ch2 := dial(t, url)
	bob.login(ch2)

	// Bob lists channels: #general exists from startup.
	bob.send("REQ", "channels", map[string]any{"kinds": []int{nostr.KindGroupMetadata}})
	if msg := bob.read(); msg[0] != "EVENT" {
		t.Fatalf("expected channel metadata, got %v", msg)
	}
	if msg := bob.read(); msg[0] != "EOSE" {
		t.Fatalf("expected EOSE, got %v", msg)
	}

	// Alice creates #random; Bob sees the new metadata live.
	if ok, reason := alice.publish(alice.signed(nostr.KindCreateGroup, "",
		nostr.Tag{"h", "random"}, nostr.Tag{"name", "Random"})); !ok {
		t.Fatalf("create channel: %s", reason)
	}
	if msg := bob.read(); msg[0] != "EVENT" || msg[1] != "channels" {
		t.Fatalf("expected live channel metadata, got %v", msg)
	}

	// Creating it again is rejected.
	if ok, _ := alice.publish(alice.signed(nostr.KindCreateGroup, "", nostr.Tag{"h", "random"})); ok {
		t.Fatal("duplicate channel should be rejected")
	}

	// Bob subscribes to #random, Alice posts, Bob receives it live.
	bob.send("REQ", "random", map[string]any{"kinds": []int{9, 7, 5}, "#h": []string{"random"}})
	if msg := bob.read(); msg[0] != "EOSE" {
		t.Fatalf("expected empty history then EOSE, got %v", msg)
	}
	post := alice.signed(nostr.KindChatMessage, "hello bob", nostr.Tag{"h", "random"})
	if ok, reason := alice.publish(post); !ok {
		t.Fatalf("post: %s", reason)
	}
	msg := bob.read()
	if msg[0] != "EVENT" || msg[1] != "random" {
		t.Fatalf("expected live message, got %v", msg)
	}
	got := msg[2].(map[string]any)
	if got["content"] != "hello bob" {
		t.Fatalf("wrong content: %v", got["content"])
	}

	// Posting to a channel that doesn't exist is rejected.
	if ok, _ := alice.publish(alice.signed(nostr.KindChatMessage, "x", nostr.Tag{"h", "nope"})); ok {
		t.Fatal("unknown channel should be rejected")
	}

	// Bob can't delete Alice's message: the deletion is stored but removes nothing.
	bob.publish(bob.signed(nostr.KindDeletion, "", nostr.Tag{"e", post.ID}, nostr.Tag{"h", "random"}))
	bob.read() // Bob receives his own deletion event on the "random" subscription
	bob.send("REQ", "check", map[string]any{"ids": []string{post.ID}})
	if msg := bob.read(); msg[0] != "EVENT" {
		t.Fatalf("message should survive someone else's deletion, got %v", msg)
	}
	bob.read() // EOSE

	// Alice deletes her own message; it's gone from history.
	if ok, reason := alice.publish(alice.signed(nostr.KindDeletion, "", nostr.Tag{"e", post.ID}, nostr.Tag{"h", "random"})); !ok {
		t.Fatalf("delete: %s", reason)
	}
	bob.read() // live deletion event
	bob.send("REQ", "check2", map[string]any{"ids": []string{post.ID}})
	if msg := bob.read(); msg[0] != "EOSE" {
		t.Fatalf("deleted message should be gone, got %v", msg)
	}
}

func TestProfileIsReplaceable(t *testing.T) {
	url := newTestRelay(t)
	c, ch := dial(t, url)
	c.login(ch)

	first := c.signed(nostr.KindProfile, `{"name":"old"}`)
	first.CreatedAt -= 10
	first.Sign(c.priv)
	c.publish(first)
	c.publish(c.signed(nostr.KindProfile, `{"name":"new"}`))

	c.send("REQ", "p", map[string]any{"kinds": []int{0}, "authors": []string{nostr.PubKeyHex(c.priv)}})
	msg := c.read()
	if msg[0] != "EVENT" {
		t.Fatalf("expected profile, got %v", msg)
	}
	if content := msg[2].(map[string]any)["content"]; content != `{"name":"new"}` {
		t.Fatalf("expected newest profile only, got %v", content)
	}
	if msg := c.read(); msg[0] != "EOSE" {
		t.Fatalf("expected only one profile, got %v", msg)
	}
}

func TestRejectsUnsupportedKindAndBadSignature(t *testing.T) {
	url := newTestRelay(t)
	c, ch := dial(t, url)
	c.login(ch)

	if ok, reason := c.publish(c.signed(1, "a note")); ok || !strings.HasPrefix(reason, "blocked") {
		t.Fatalf("kind 1 should be blocked, got ok=%v %q", ok, reason)
	}

	ev := c.signed(nostr.KindChatMessage, "hi", nostr.Tag{"h", "general"})
	ev.Content = "tampered"
	if ok, reason := c.publish(ev); ok || !strings.HasPrefix(reason, "invalid") {
		t.Fatalf("tampered event should be invalid, got ok=%v %q", ok, reason)
	}
}
