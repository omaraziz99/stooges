// Package client is a minimal Nostr client for the command-line tools (seed,
// KPI agent): connect, sign in with NIP-42, publish, and query.
package client

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/btcsuite/btcd/btcec/v2"
	"github.com/gorilla/websocket"

	"stooges/be/internal/nostr"
)

const timeout = 15 * time.Second

// Conn is one WebSocket connection to the relay.
type Conn struct {
	url       string
	ws        *websocket.Conn
	challenge string
	priv      *btcec.PrivateKey // set by Login
}

// Dial connects and reads the relay's NIP-42 challenge, which it sends first.
func Dial(url string) (*Conn, error) {
	ws, _, err := websocket.DefaultDialer.Dial(url, nil)
	if err != nil {
		return nil, err
	}
	ws.SetReadLimit(4 << 20)
	c := &Conn{url: url, ws: ws}
	msg, err := c.readUntil(func(m []json.RawMessage) bool { return str(m[0]) == "AUTH" })
	if err != nil {
		ws.Close()
		return nil, fmt.Errorf("waiting for login challenge: %w", err)
	}
	c.challenge = str(msg[1])
	return c, nil
}

// Close closes the connection.
func (c *Conn) Close() error { return c.ws.Close() }

// Login answers the challenge with priv, which then signs everything published.
func (c *Conn) Login(priv *btcec.PrivateKey) error {
	auth := &nostr.Event{CreatedAt: time.Now().Unix(), Kind: nostr.KindAuth,
		Tags: []nostr.Tag{{"relay", c.url}, {"challenge", c.challenge}}}
	if err := auth.Sign(priv); err != nil {
		return err
	}
	ok, reason, err := c.send("AUTH", auth)
	if err != nil {
		return err
	}
	if !ok {
		return fmt.Errorf("login rejected: %s", reason)
	}
	c.priv = priv
	return nil
}

// Publish signs and sends an event. ok/reason are the relay's verdict;
// err is a connection problem.
func (c *Conn) Publish(kind int, at time.Time, content string, tags ...nostr.Tag) (ev *nostr.Event, ok bool, reason string, err error) {
	if c.priv == nil {
		return nil, false, "", fmt.Errorf("publish before Login")
	}
	ev = &nostr.Event{CreatedAt: at.Unix(), Kind: kind, Tags: tags, Content: content}
	if err := ev.Sign(c.priv); err != nil {
		return nil, false, "", err
	}
	ok, reason, err = c.send("EVENT", ev)
	return ev, ok, reason, err
}

// Query returns the stored events matching filter (up to the relay's EOSE).
func (c *Conn) Query(subID string, filter map[string]any) ([]nostr.Event, error) {
	if err := c.ws.WriteJSON([]any{"REQ", subID, filter}); err != nil {
		return nil, err
	}
	var events []nostr.Event
	for {
		msg, err := c.readUntil(func(m []json.RawMessage) bool { return str(m[1]) == subID })
		if err != nil {
			return nil, err
		}
		switch str(msg[0]) {
		case "EVENT":
			var ev nostr.Event
			if len(msg) >= 3 && json.Unmarshal(msg[2], &ev) == nil {
				events = append(events, ev)
			}
		case "EOSE":
			c.ws.WriteJSON([]any{"CLOSE", subID})
			return events, nil
		case "CLOSED":
			return nil, fmt.Errorf("relay closed subscription %s: %s", subID, string(msg[len(msg)-1]))
		}
	}
}

// send writes a message carrying ev and waits for the relay's OK for it.
func (c *Conn) send(typ string, ev *nostr.Event) (bool, string, error) {
	if err := c.ws.WriteJSON([]any{typ, ev}); err != nil {
		return false, "", err
	}
	msg, err := c.readUntil(func(m []json.RawMessage) bool {
		return len(m) >= 4 && str(m[0]) == "OK" && str(m[1]) == ev.ID
	})
	if err != nil {
		return false, "", err
	}
	var ok bool
	json.Unmarshal(msg[2], &ok)
	return ok, str(msg[3]), nil
}

func (c *Conn) readUntil(match func([]json.RawMessage) bool) ([]json.RawMessage, error) {
	c.ws.SetReadDeadline(time.Now().Add(timeout))
	for {
		var msg []json.RawMessage
		if err := c.ws.ReadJSON(&msg); err != nil {
			return nil, err
		}
		if len(msg) >= 2 && match(msg) {
			return msg, nil
		}
	}
}

func str(raw json.RawMessage) string {
	var s string
	json.Unmarshal(raw, &s)
	return s
}
