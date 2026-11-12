package relay

import (
	"strings"
	"testing"

	"stooges/be/internal/nostr"
)

func TestAnyMemberCanDeleteAChannel(t *testing.T) {
	url := newTestRelay(t)
	creator, ch := dial(t, url)
	creator.login(ch)
	other, ch2 := dial(t, url)
	other.login(ch2)

	if ok, reason := creator.publish(creator.signed(nostr.KindCreateGroup, "", nostr.Tag{"h", "temp"})); !ok {
		t.Fatalf("create channel: %s", reason)
	}
	if ok, reason := creator.publish(creator.signed(nostr.KindChatMessage, "hello", nostr.Tag{"h", "temp"})); !ok {
		t.Fatalf("post: %s", reason)
	}

	if ok, reason := other.publish(other.signed(nostr.KindDeleteGroup, "", nostr.Tag{"h", "nope"})); ok || !strings.Contains(reason, "unknown channel") {
		t.Fatalf("deleting a missing channel should fail, got ok=%v %q", ok, reason)
	}

	// The creator watches channel metadata, so it sees the deletion live.
	creator.send("REQ", "meta", map[string]any{"kinds": []int{nostr.KindGroupMetadata}})
	if msg := creator.read(); msg[0] != "EVENT" {
		t.Fatalf("expected the channel's metadata, got %v", msg)
	}
	if msg := creator.read(); msg[0] != "EOSE" {
		t.Fatalf("expected EOSE, got %v", msg)
	}

	// Someone who didn't create the channel deletes it.
	if ok, reason := other.publish(other.signed(nostr.KindDeleteGroup, "", nostr.Tag{"h", "temp"})); !ok {
		t.Fatalf("member delete: %s", reason)
	}
	msg := creator.read()
	ev, _ := msg[2].(map[string]any)
	tags, _ := ev["tags"].([]any)
	deleted := false
	for _, tag := range tags {
		if tt, _ := tag.([]any); len(tt) > 0 && tt[0] == "deleted" {
			deleted = true
		}
	}
	if msg[0] != "EVENT" || !deleted {
		t.Fatalf("expected a live deleted-channel event, got %v", msg)
	}

	// The channel and its messages are gone: posting fails, history is empty.
	if ok, reason := creator.publish(creator.signed(nostr.KindChatMessage, "again", nostr.Tag{"h", "temp"})); ok || !strings.Contains(reason, "unknown channel") {
		t.Fatalf("posting to a deleted channel should fail, got ok=%v %q", ok, reason)
	}
	creator.send("REQ", "hist", map[string]any{"kinds": []int{nostr.KindChatMessage}, "#h": []string{"temp"}})
	if msg := creator.read(); msg[0] != "EOSE" {
		t.Fatalf("messages should be deleted with the channel, got %v", msg)
	}

	// The name can be used again.
	if ok, reason := creator.publish(creator.signed(nostr.KindCreateGroup, "", nostr.Tag{"h", "temp"})); !ok {
		t.Fatalf("re-create channel: %s", reason)
	}
}
