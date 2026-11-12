// Package relay is a small Nostr relay for the chat platform. It speaks NIP-01
// over WebSockets, requires NIP-42 login before publishing, and supports a
// subset of NIP-29 channels: create a channel, post messages, react, delete.
package relay

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/btcsuite/btcd/btcec/v2"
	"github.com/gorilla/websocket"

	"stooges/be/internal/nostr"
	"stooges/be/internal/store"
)

const (
	maxMessageBytes  = 1024 * 1024 // room for a KPI report; chat messages are capped far lower
	maxSubsPerConn   = 20
	maxFiltersPerReq = 10
	sendBuffer       = 1024
	writeTimeout     = 10 * time.Second
	pongWait         = 60 * time.Second
	pingInterval     = 25 * time.Second
)

// Relay serves the WebSocket protocol and NIP-11 info document.
type Relay struct {
	store    *store.Store
	key      *btcec.PrivateKey
	pubkey   string
	log      *slog.Logger
	upgrader websocket.Upgrader

	kpiPublisher string // only this pubkey may publish KPI reports ("" = nobody)

	mu      sync.RWMutex
	clients map[*client]struct{}
}

// Options configures a relay.
type Options struct {
	// KPIPublisher is the hex pubkey of the KPI agent. Empty disables reports.
	KPIPublisher string
	// AllowedOrigins limits which web pages may connect, e.g.
	// ["https://stooges.vercel.app"]. Empty allows any origin: identity comes
	// from signed events, not cookies, so this is defence in depth.
	AllowedOrigins []string
}

// New creates a relay. key signs relay-authored events such as channel metadata.
func New(st *store.Store, key *btcec.PrivateKey, log *slog.Logger, opts Options) *Relay {
	allowed := map[string]bool{}
	for _, o := range opts.AllowedOrigins {
		allowed[strings.TrimRight(strings.TrimSpace(o), "/")] = true
	}
	return &Relay{
		store:        st,
		key:          key,
		pubkey:       nostr.PubKeyHex(key),
		log:          log,
		kpiPublisher: strings.ToLower(strings.TrimSpace(opts.KPIPublisher)),
		upgrader: websocket.Upgrader{
			ReadBufferSize:  4096,
			WriteBufferSize: 4096,
			CheckOrigin: func(req *http.Request) bool {
				origin := req.Header.Get("Origin")
				return len(allowed) == 0 || origin == "" || allowed[origin]
			},
		},
		clients: map[*client]struct{}{},
	}
}

// PubKey returns the relay's public key (hex).
func (r *Relay) PubKey() string { return r.pubkey }

// ServeHTTP upgrades WebSocket requests and answers plain HTTP with relay info.
func (r *Relay) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	if websocket.IsWebSocketUpgrade(req) {
		r.serveWS(w, req)
		return
	}
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Headers", "Accept")
	if req.Header.Get("Accept") == "application/nostr+json" {
		w.Header().Set("Content-Type", "application/nostr+json")
		json.NewEncoder(w).Encode(map[string]any{
			"name":           "stooges relay",
			"description":    "Simple chat relay: channels, threads, reactions.",
			"pubkey":         r.pubkey,
			"supported_nips": []int{1, 9, 11, 25, 29, 42},
			"software":       "stooges/be",
			"version":        "0.1.0",
		})
		return
	}
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Write([]byte("stooges relay is running. Connect with a WebSocket client.\n"))
}

func (r *Relay) serveWS(w http.ResponseWriter, req *http.Request) {
	conn, err := r.upgrader.Upgrade(w, req, nil)
	if err != nil {
		return // the upgrader already wrote an HTTP error
	}
	c := &client{
		conn:      conn,
		send:      make(chan []byte, sendBuffer),
		done:      make(chan struct{}),
		challenge: randomHex(16),
		subs:      map[string][]nostr.Filter{},
	}
	r.mu.Lock()
	r.clients[c] = struct{}{}
	r.mu.Unlock()
	defer func() {
		r.mu.Lock()
		delete(r.clients, c)
		r.mu.Unlock()
		c.close()
	}()

	go c.writeLoop()

	conn.SetReadLimit(maxMessageBytes)
	conn.SetReadDeadline(time.Now().Add(pongWait))
	conn.SetPongHandler(func(string) error {
		return conn.SetReadDeadline(time.Now().Add(pongWait))
	})

	// NIP-42: challenge the client right away; it must answer before publishing.
	c.reply(encode("AUTH", c.challenge))

	ctx := req.Context()
	for {
		_, data, err := conn.ReadMessage()
		if err != nil {
			return
		}
		conn.SetReadDeadline(time.Now().Add(pongWait))
		r.handleMessage(ctx, c, data)
	}
}

func (r *Relay) handleMessage(ctx context.Context, c *client, data []byte) {
	var msg []json.RawMessage
	if err := json.Unmarshal(data, &msg); err != nil || len(msg) < 2 {
		c.reply(encode("NOTICE", "invalid: expected a JSON array like [\"EVENT\", {...}]"))
		return
	}
	var typ string
	if err := json.Unmarshal(msg[0], &typ); err != nil {
		c.reply(encode("NOTICE", "invalid: first element must be a string"))
		return
	}
	switch typ {
	case "EVENT":
		var ev nostr.Event
		if err := json.Unmarshal(msg[1], &ev); err != nil {
			c.reply(encode("NOTICE", "invalid: malformed event"))
			return
		}
		r.handleEvent(ctx, c, &ev)
	case "REQ":
		r.handleReq(ctx, c, msg[1:])
	case "CLOSE":
		var subID string
		if json.Unmarshal(msg[1], &subID) == nil {
			c.mu.Lock()
			delete(c.subs, subID)
			c.mu.Unlock()
		}
	case "AUTH":
		var ev nostr.Event
		if err := json.Unmarshal(msg[1], &ev); err != nil {
			c.reply(encode("NOTICE", "invalid: malformed auth event"))
			return
		}
		r.handleAuth(c, &ev)
	default:
		c.reply(encode("NOTICE", "invalid: unknown message type "+typ))
	}
}

func (r *Relay) handleReq(ctx context.Context, c *client, args []json.RawMessage) {
	var subID string
	if err := json.Unmarshal(args[0], &subID); err != nil || subID == "" || len(subID) > 64 {
		c.reply(encode("NOTICE", "invalid: subscription id must be a 1-64 character string"))
		return
	}
	filterArgs := args[1:]
	if len(filterArgs) == 0 || len(filterArgs) > maxFiltersPerReq {
		c.reply(encode("CLOSED", subID, "invalid: send between 1 and 10 filters"))
		return
	}
	filters := make([]nostr.Filter, 0, len(filterArgs))
	for _, raw := range filterArgs {
		var f nostr.Filter
		if err := json.Unmarshal(raw, &f); err != nil {
			c.reply(encode("CLOSED", subID, "invalid: "+err.Error()))
			return
		}
		filters = append(filters, f)
	}

	// Register before querying so no event published in between is missed.
	// Clients de-duplicate by event ID if one arrives twice.
	c.mu.Lock()
	if _, exists := c.subs[subID]; !exists && len(c.subs) >= maxSubsPerConn {
		c.mu.Unlock()
		c.reply(encode("CLOSED", subID, "rate-limited: too many open subscriptions"))
		return
	}
	c.subs[subID] = filters
	c.mu.Unlock()

	seen := map[string]bool{}
	for _, f := range filters {
		events, err := r.store.Query(ctx, f)
		if err != nil {
			r.log.Error("query failed", "err", err)
			c.reply(encode("CLOSED", subID, "error: query failed"))
			c.mu.Lock()
			delete(c.subs, subID)
			c.mu.Unlock()
			return
		}
		for i := range events {
			if seen[events[i].ID] {
				continue
			}
			seen[events[i].ID] = true
			c.reply(encode("EVENT", subID, &events[i]))
		}
	}
	c.reply(encode("EOSE", subID))
}

func (r *Relay) handleAuth(c *client, ev *nostr.Event) {
	fail := func(reason string) { c.reply(encode("OK", ev.ID, false, reason)) }
	if ev.Kind != nostr.KindAuth {
		fail("invalid: auth event must be kind 22242")
		return
	}
	if err := ev.Verify(); err != nil {
		fail("invalid: " + err.Error())
		return
	}
	if ev.TagValue("challenge") != c.challenge {
		fail("invalid: challenge does not match")
		return
	}
	if age := time.Now().Unix() - ev.CreatedAt; age > 600 || age < -600 {
		fail("invalid: auth event is too old or too far in the future")
		return
	}
	c.mu.Lock()
	c.pubkey = ev.PubKey
	c.mu.Unlock()
	c.reply(encode("OK", ev.ID, true, ""))
}

// broadcast sends a newly stored event to every subscription that matches it.
func (r *Relay) broadcast(ev *nostr.Event) {
	data, err := json.Marshal(ev)
	if err != nil {
		return
	}
	r.mu.RLock()
	clients := make([]*client, 0, len(r.clients))
	for c := range r.clients {
		clients = append(clients, c)
	}
	r.mu.RUnlock()

	for _, c := range clients {
		var subIDs []string
		c.mu.Lock()
		for id, filters := range c.subs {
			for i := range filters {
				if filters[i].Matches(ev) {
					subIDs = append(subIDs, id)
					break
				}
			}
		}
		c.mu.Unlock()
		for _, id := range subIDs {
			idJSON, _ := json.Marshal(id)
			msg := make([]byte, 0, len(data)+len(idJSON)+12)
			msg = append(msg, `["EVENT",`...)
			msg = append(msg, idJSON...)
			msg = append(msg, ',')
			msg = append(msg, data...)
			msg = append(msg, ']')
			c.broadcastSend(msg)
		}
	}
}

// client is one WebSocket connection.
type client struct {
	conn      *websocket.Conn
	send      chan []byte
	done      chan struct{}
	closeOnce sync.Once
	challenge string

	mu     sync.Mutex
	pubkey string // set after a successful NIP-42 AUTH
	subs   map[string][]nostr.Filter
}

// reply queues a direct response, waiting if the buffer is full.
// Only call it from this client's own read loop.
func (c *client) reply(msg []byte) {
	select {
	case c.send <- msg:
	case <-c.done:
	}
}

// broadcastSend queues a live event without blocking other clients; a client
// too slow to keep up is disconnected instead of stalling the relay.
func (c *client) broadcastSend(msg []byte) {
	select {
	case c.send <- msg:
	case <-c.done:
	default:
		c.close()
	}
}

func (c *client) close() {
	c.closeOnce.Do(func() {
		close(c.done)
		c.conn.Close()
	})
}

func (c *client) writeLoop() {
	ticker := time.NewTicker(pingInterval)
	defer ticker.Stop()
	for {
		select {
		case msg := <-c.send:
			c.conn.SetWriteDeadline(time.Now().Add(writeTimeout))
			if err := c.conn.WriteMessage(websocket.TextMessage, msg); err != nil {
				c.close()
				return
			}
		case <-ticker.C:
			c.conn.SetWriteDeadline(time.Now().Add(writeTimeout))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				c.close()
				return
			}
		case <-c.done:
			return
		}
	}
}

func encode(parts ...any) []byte {
	b, err := json.Marshal(parts)
	if err != nil {
		b, _ = json.Marshal([]any{"NOTICE", "error: could not encode response"})
	}
	return b
}

func randomHex(n int) string {
	b := make([]byte, n)
	rand.Read(b)
	return hex.EncodeToString(b)
}
