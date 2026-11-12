package nostr

import (
	"encoding/json"
	"testing"

	"github.com/btcsuite/btcd/btcec/v2"
)

func TestSignAndVerify(t *testing.T) {
	priv, err := btcec.NewPrivateKey()
	if err != nil {
		t.Fatal(err)
	}
	ev := &Event{CreatedAt: 1700000000, Kind: KindChatMessage, Tags: []Tag{{"h", "general"}}, Content: "hello"}
	if err := ev.Sign(priv); err != nil {
		t.Fatal(err)
	}
	if err := ev.Verify(); err != nil {
		t.Fatalf("freshly signed event should verify: %v", err)
	}

	tampered := *ev
	tampered.Content = "goodbye"
	if tampered.Verify() == nil {
		t.Fatal("changed content must fail verification")
	}

	// Recomputing the ID after a change still fails: the old signature doesn't match.
	tampered = *ev
	tampered.Content = "x"
	tampered.ID = tampered.ComputeID()
	if tampered.Verify() == nil {
		t.Fatal("re-hashed event with old signature must fail verification")
	}
}

// Serialize must escape strings the way JSON.stringify does, so IDs match JS clients.
func TestSerializeEscaping(t *testing.T) {
	ev := &Event{
		PubKey:    "ab",
		CreatedAt: 1,
		Kind:      9,
		Tags:      []Tag{{"h", "a\"b"}},
		Content:   "line1\nline2\t<b>&\\ \u0001 é 😀",
	}
	got := string(ev.Serialize())
	want := `[0,"ab",1,9,[["h","a\"b"]],"line1\nline2\t<b>&\\ \u0001 é 😀"]`
	if got != want {
		t.Fatalf("serialize mismatch\n got: %s\nwant: %s", got, want)
	}
	// It must also be valid JSON that round-trips to the same content.
	var parsed []any
	if err := json.Unmarshal([]byte(got), &parsed); err != nil {
		t.Fatalf("not valid JSON: %v", err)
	}
	if parsed[5] != ev.Content {
		t.Fatalf("content did not round-trip: %q", parsed[5])
	}
}

func TestEmptyTagsSerializeAsArray(t *testing.T) {
	ev := &Event{PubKey: "ab", CreatedAt: 1, Kind: 0, Content: ""}
	if got := string(ev.Serialize()); got != `[0,"ab",1,0,[],""]` {
		t.Fatalf("got %s", got)
	}
}

func TestFilterMatches(t *testing.T) {
	ev := &Event{ID: "id1", PubKey: "pk1", CreatedAt: 100, Kind: 9, Tags: []Tag{{"h", "general"}, {"e", "root1", "", "root"}}}

	var f Filter
	if err := json.Unmarshal([]byte(`{"kinds":[9,7],"#h":["general"],"since":50}`), &f); err != nil {
		t.Fatal(err)
	}
	if !f.Matches(ev) {
		t.Fatal("expected match")
	}

	cases := map[string]string{
		"wrong kind":    `{"kinds":[7]}`,
		"wrong channel": `{"#h":["random"]}`,
		"too old":       `{"until":99}`,
		"wrong author":  `{"authors":["pk2"]}`,
		"missing tag":   `{"#p":["pk1"]}`,
	}
	for name, raw := range cases {
		var f Filter
		if err := json.Unmarshal([]byte(raw), &f); err != nil {
			t.Fatal(err)
		}
		if f.Matches(ev) {
			t.Errorf("%s: expected no match", name)
		}
	}
}
