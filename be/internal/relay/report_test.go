package relay

import (
	"strings"
	"testing"

	"github.com/btcsuite/btcd/btcec/v2"

	"stooges/be/internal/nostr"
)

// The KPI agent's key, allowed to publish reports in newTestRelay.
var (
	agentKey, _ = btcec.NewPrivateKey()
	agentPub    = nostr.PubKeyHex(agentKey)
)

func TestOnlyTheAgentCanPublishReports(t *testing.T) {
	url := newTestRelay(t)
	report := nostr.Tag{"d", "kpi-report"}

	user, ch := dial(t, url)
	user.login(ch)
	if ok, reason := user.publish(user.signed(nostr.KindAppData, `{"people":[]}`, report)); ok || !strings.HasPrefix(reason, "restricted") {
		t.Fatalf("a regular user must not publish a report, got ok=%v %q", ok, reason)
	}

	agent, ch2 := dial(t, url)
	agent.priv = agentKey
	agent.login(ch2)
	if ok, reason := agent.publish(agent.signed(nostr.KindAppData, `{"people":[]}`, nostr.Tag{"d", "something-else"})); ok || !strings.HasPrefix(reason, "blocked") {
		t.Fatalf("other app data must be blocked, got ok=%v %q", ok, reason)
	}
	if ok, _ := agent.publish(agent.signed(nostr.KindAppData, `not json`, report)); ok {
		t.Fatal("a report must be valid JSON")
	}

	// A dashboard subscribes, then the agent publishes twice; only the latest is kept.
	user.send("REQ", "kpi", map[string]any{"kinds": []int{nostr.KindAppData}, "#d": []string{"kpi-report"}})
	if msg := user.read(); msg[0] != "EOSE" {
		t.Fatalf("no report yet, got %v", msg)
	}
	first := agent.signed(nostr.KindAppData, `{"version":1}`, report)
	first.CreatedAt -= 60
	first.Sign(agentKey)
	if ok, reason := agent.publish(first); !ok {
		t.Fatalf("agent should publish: %s", reason)
	}
	if msg := user.read(); msg[0] != "EVENT" || msg[2].(map[string]any)["content"] != `{"version":1}` {
		t.Fatalf("subscriber should get the report live, got %v", msg)
	}
	if ok, reason := agent.publish(agent.signed(nostr.KindAppData, `{"version":2}`, report)); !ok {
		t.Fatalf("agent should publish an update: %s", reason)
	}
	user.read() // live update

	user.send("REQ", "latest", map[string]any{"kinds": []int{nostr.KindAppData}, "#d": []string{"kpi-report"}})
	msg := user.read()
	if msg[0] != "EVENT" || msg[2].(map[string]any)["content"] != `{"version":2}` {
		t.Fatalf("only the newest report should be stored, got %v", msg)
	}
	if msg := user.read(); msg[0] != "EOSE" {
		t.Fatalf("older report should have been replaced, got %v", msg)
	}
}
