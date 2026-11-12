package relay

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	"stooges/be/internal/nostr"
	"stooges/be/internal/store"
)

const (
	maxFutureSkew    = 15 * time.Minute
	maxMessageChars  = 8000
	maxProfileBytes  = 4096
	maxChannelName   = 64
	maxChannelAbout  = 280
	defaultChannelID = "general"
	kpiReportTag     = "kpi-report" // d tag of the KPI report (kind 30078)
	maxReportBytes   = 900 * 1024
)

var channelIDPattern = regexp.MustCompile(`^[a-z0-9_-]{1,32}$`)

// handleEvent validates an EVENT against the platform rules, stores it, and
// broadcasts it. Every path answers with an OK message (NIP-01).
func (r *Relay) handleEvent(ctx context.Context, c *client, ev *nostr.Event) {
	reject := func(reason string) { c.reply(encode("OK", ev.ID, false, reason)) }

	if ev.Tags == nil {
		ev.Tags = []nostr.Tag{}
	}
	if err := ev.Verify(); err != nil {
		reject("invalid: " + err.Error())
		return
	}
	if ev.CreatedAt > time.Now().Add(maxFutureSkew).Unix() {
		reject("invalid: created_at is too far in the future")
		return
	}

	c.mu.Lock()
	authed := c.pubkey
	c.mu.Unlock()
	if authed == "" {
		reject("auth-required: sign in before publishing")
		return
	}
	if authed != ev.PubKey {
		reject("restricted: event author does not match the signed-in key")
		return
	}

	var extra []*nostr.Event // relay-authored events to store and broadcast too
	switch ev.Kind {
	case nostr.KindProfile:
		if len(ev.Content) > maxProfileBytes {
			reject("invalid: profile is too large")
			return
		}

	case nostr.KindChatMessage:
		if strings.TrimSpace(ev.Content) == "" {
			reject("invalid: message is empty")
			return
		}
		if len([]rune(ev.Content)) > maxMessageChars {
			reject(fmt.Sprintf("invalid: message is longer than %d characters", maxMessageChars))
			return
		}
		if err := r.requireChannel(ctx, ev); err != nil {
			reject(err.Error())
			return
		}

	case nostr.KindReaction:
		if ev.TagValue("e") == "" {
			reject("invalid: reaction needs an e tag")
			return
		}
		if err := r.requireChannel(ctx, ev); err != nil {
			reject(err.Error())
			return
		}

	case nostr.KindDeletion:
		ids := ev.TagValues("e")
		if len(ids) == 0 {
			reject("invalid: deletion needs at least one e tag")
			return
		}
		if err := r.requireChannel(ctx, ev); err != nil {
			reject(err.Error())
			return
		}
		// Only the author's own events are removed; other IDs are ignored.
		if _, err := r.store.DeleteOwn(ctx, ids, ev.PubKey); err != nil {
			r.log.Error("delete failed", "err", err)
			reject("error: could not delete")
			return
		}

	case nostr.KindCreateGroup:
		meta, err := r.createChannel(ctx, ev)
		if err != nil {
			reject(err.Error())
			return
		}
		extra = append(extra, meta)

	case nostr.KindAppData:
		// The KPI report: only the configured agent may publish it.
		if ev.TagValue("d") != kpiReportTag {
			reject("blocked: only KPI reports are accepted for kind 30078")
			return
		}
		if r.kpiPublisher == "" || ev.PubKey != r.kpiPublisher {
			reject("restricted: only the KPI agent can publish reports (set KPI_AGENT_PUBKEY on the relay)")
			return
		}
		if len(ev.Content) > maxReportBytes || !json.Valid([]byte(ev.Content)) {
			reject("invalid: report must be JSON under 900 KB")
			return
		}

	default:
		reject(fmt.Sprintf("blocked: kind %d is not supported", ev.Kind))
		return
	}

	saved, err := r.store.Save(ctx, ev)
	if err != nil {
		r.log.Error("save failed", "err", err)
		reject("error: could not store event")
		return
	}
	if !saved {
		c.reply(encode("OK", ev.ID, true, "duplicate: already have this event"))
		return
	}
	c.reply(encode("OK", ev.ID, true, ""))
	r.broadcast(ev)
	for _, e := range extra {
		r.broadcast(e)
	}
}

// requireChannel checks the event's h tag names an existing channel.
func (r *Relay) requireChannel(ctx context.Context, ev *nostr.Event) error {
	id := ev.TagValue("h")
	if id == "" {
		return errors.New("invalid: missing h (channel) tag")
	}
	ok, err := r.store.GroupExists(ctx, id)
	if err != nil {
		r.log.Error("channel lookup failed", "err", err)
		return errors.New("error: channel lookup failed")
	}
	if !ok {
		return fmt.Errorf("invalid: unknown channel %q", id)
	}
	return nil
}

// createChannel handles a kind 9007 event: ["h", id], optional ["name", ...]
// and ["about", ...]. It records the channel and returns the relay-signed
// kind 39000 metadata event that clients use to list channels.
func (r *Relay) createChannel(ctx context.Context, ev *nostr.Event) (*nostr.Event, error) {
	id := ev.TagValue("h")
	if !channelIDPattern.MatchString(id) {
		return nil, errors.New("invalid: channel id must be 1-32 characters of a-z, 0-9, - or _")
	}
	name := strings.TrimSpace(ev.TagValue("name"))
	if name == "" {
		name = id
	}
	about := strings.TrimSpace(ev.TagValue("about"))
	if len([]rune(name)) > maxChannelName || len([]rune(about)) > maxChannelAbout {
		return nil, errors.New("invalid: channel name or description is too long")
	}
	err := r.store.CreateGroup(ctx, id, name, about, ev.PubKey, time.Now().Unix())
	if errors.Is(err, store.ErrGroupExists) {
		return nil, fmt.Errorf("invalid: channel %q already exists", id)
	}
	if err != nil {
		r.log.Error("create channel failed", "err", err)
		return nil, errors.New("error: could not create channel")
	}
	return r.saveChannelMetadata(ctx, id, name, about)
}

// saveChannelMetadata signs and stores the kind 39000 event describing a channel.
func (r *Relay) saveChannelMetadata(ctx context.Context, id, name, about string) (*nostr.Event, error) {
	meta := &nostr.Event{
		CreatedAt: time.Now().Unix(),
		Kind:      nostr.KindGroupMetadata,
		Tags: []nostr.Tag{
			{"d", id},
			{"name", name},
			{"about", about},
			{"public"},
			{"open"},
		},
	}
	if err := meta.Sign(r.key); err != nil {
		return nil, err
	}
	if _, err := r.store.Save(ctx, meta); err != nil {
		return nil, err
	}
	return meta, nil
}

// EnsureDefaultChannel creates the #general channel on first start.
func (r *Relay) EnsureDefaultChannel(ctx context.Context) error {
	exists, err := r.store.GroupExists(ctx, defaultChannelID)
	if err != nil || exists {
		return err
	}
	about := "Company-wide chat"
	if err := r.store.CreateGroup(ctx, defaultChannelID, defaultChannelID, about, r.pubkey, time.Now().Unix()); err != nil {
		return err
	}
	_, err = r.saveChannelMetadata(ctx, defaultChannelID, defaultChannelID, about)
	return err
}
