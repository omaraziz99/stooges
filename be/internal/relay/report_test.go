package relay

import (
	"strings"
	"testing"
	"time"

	"github.com/btcsuite/btcd/btcec/v2"

	"stooges/be/internal/nostr"
)

// The KPI agent's key, allowed to publish reports in newTestRelay, and a
// manager's key, allowed to read all of them.
var (
	agentKey, _ = btcec.NewPrivateKey()
	agentPub    = nostr.PubKeyHex(agentKey)
	bossKey, _  = btcec.NewPrivateKey()
	bossPub     = nostr.PubKeyHex(bossKey)
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

	boss, ch3 := dial(t, url)
	boss.priv = bossKey
	boss.login(ch3)
	// A manager's dashboard subscribes, then the agent publishes twice; only the latest is kept.
	boss.send("REQ", "kpi", map[string]any{"kinds": []int{nostr.KindAppData}, "#d": []string{"kpi-report"}})
	if msg := boss.read(); msg[0] != "EOSE" {
		t.Fatalf("no report yet, got %v", msg)
	}
	first := agent.signed(nostr.KindAppData, `{"version":1}`, report)
	first.CreatedAt -= 60
	first.Sign(agentKey)
	if ok, reason := agent.publish(first); !ok {
		t.Fatalf("agent should publish: %s", reason)
	}
	if msg := boss.read(); msg[0] != "EVENT" || msg[2].(map[string]any)["content"] != `{"version":1}` {
		t.Fatalf("subscriber should get the report live, got %v", msg)
	}
	if ok, reason := agent.publish(agent.signed(nostr.KindAppData, `{"version":2}`, report)); !ok {
		t.Fatalf("agent should publish an update: %s", reason)
	}
	boss.read() // live update

	boss.send("REQ", "latest", map[string]any{"kinds": []int{nostr.KindAppData}, "#d": []string{"kpi-report"}})
	msg := boss.read()
	if msg[0] != "EVENT" || msg[2].(map[string]any)["content"] != `{"version":2}` {
		t.Fatalf("only the newest report should be stored, got %v", msg)
	}
	if msg := boss.read(); msg[0] != "EOSE" {
		t.Fatalf("older report should have been replaced, got %v", msg)
	}
}

func TestOnlyManagersCanReadReports(t *testing.T) {
	managerKey, _ := btcec.NewPrivateKey()
	url := newTestRelayWith(t, Options{KPIPublisher: agentPub}, nostr.PubKeyHex(managerKey))
	filter := map[string]any{"kinds": []int{nostr.KindAppData}, "#d": []string{"kpi-report"}}

	agent, ch := dial(t, url)
	agent.priv = agentKey
	agent.login(ch)
	first := agent.signed(nostr.KindAppData, `{"version":1}`, nostr.Tag{"d", "kpi-report"})
	first.CreatedAt -= 60
	first.Sign(agentKey)
	if ok, reason := agent.publish(first); !ok {
		t.Fatalf("agent should publish: %s", reason)
	}

	// Like the web app, the manager subscribes before signing in. Nothing is
	// sent until the login proves who it is; then the stored report arrives.
	manager, ch := dial(t, url)
	manager.priv = managerKey
	manager.send("REQ", "kpi", filter)
	if msg := manager.read(); msg[0] != "EOSE" {
		t.Fatalf("no report before login, got %v", msg)
	}
	manager.login(ch)
	if msg := manager.read(); msg[0] != "EVENT" || msg[2].(map[string]any)["content"] != `{"version":1}` {
		t.Fatalf("manager should get the stored report after login, got %v", msg)
	}

	// Anyone else gets neither the stored report nor live updates.
	user, ch := dial(t, url)
	user.login(ch)
	user.send("REQ", "kpi", filter)
	if msg := user.read(); msg[0] != "EOSE" {
		t.Fatalf("a regular user must not read the report, got %v", msg)
	}
	user.send("REQ", "all", map[string]any{})
	for {
		msg := user.read()
		if msg[0] == "EOSE" {
			break
		}
		if msg[0] == "EVENT" && msg[2].(map[string]any)["kind"] == float64(nostr.KindAppData) {
			t.Fatal("an unfiltered query must not leak the report")
		}
	}

	if ok, reason := agent.publish(agent.signed(nostr.KindAppData, `{"version":2}`, nostr.Tag{"d", "kpi-report"})); !ok {
		t.Fatalf("agent should publish an update: %s", reason)
	}
	if msg := manager.read(); msg[0] != "EVENT" || msg[2].(map[string]any)["content"] != `{"version":2}` {
		t.Fatalf("manager should get the update live, got %v", msg)
	}
	// The user's open, unfiltered subscription must not have received it: the
	// next thing they hear is the end of a fresh, empty query.
	user.send("REQ", "ping", map[string]any{"ids": []string{"none"}})
	if msg := user.read(); msg[0] != "EOSE" || msg[1] != "ping" {
		t.Fatalf("a regular user must not get report updates, got %v", msg)
	}
}

// kpiOn reports whether channel metadata read off the wire is marked for KPI review.
func kpiOn(ev any) bool {
	for _, t := range ev.(map[string]any)["tags"].([]any) {
		if parts := t.([]any); len(parts) == 2 && parts[0] == "kpi" && parts[1] == "on" {
			return true
		}
	}
	return false
}

func TestOptInIsPublishedByThePersonAndReadableByTheAgent(t *testing.T) {
	// Even with reports restricted to managers, opt-ins stay readable: the
	// agent reads them without signing in.
	managerKey, _ := btcec.NewPrivateKey()
	url := newTestRelayWith(t, Options{KPIPublisher: agentPub}, nostr.PubKeyHex(managerKey))
	consent := nostr.Tag{"d", "kpi-consent"}

	user, ch := dial(t, url)
	user.login(ch)
	yes := user.signed(nostr.KindAppData, `{"consent":true}`, consent)
	yes.CreatedAt -= 60
	yes.Sign(user.priv)
	if ok, reason := user.publish(yes); !ok {
		t.Fatalf("a user should be able to opt in: %s", reason)
	}
	if ok, _ := user.publish(user.signed(nostr.KindAppData, `not json`, consent)); ok {
		t.Fatal("consent must be JSON")
	}
	if ok, reason := user.publish(user.signed(nostr.KindAppData, `{"consent":false}`, consent)); !ok {
		t.Fatalf("a user should be able to opt out: %s", reason)
	}

	reader, _ := dial(t, url) // not signed in, like the KPI agent when it reads
	reader.send("REQ", "c", map[string]any{"kinds": []int{nostr.KindAppData}, "#d": []string{"kpi-consent"}})
	msg := reader.read()
	if msg[0] != "EVENT" || msg[2].(map[string]any)["content"] != `{"consent":false}` {
		t.Fatalf("only the newest choice should be stored, got %v", msg)
	}
	if msg := reader.read(); msg[0] != "EOSE" {
		t.Fatalf("the earlier opt-in should have been replaced, got %v", msg)
	}
}

func TestKPIReviewIsOffUnlessTheCreatorTurnsItOn(t *testing.T) {
	url := newTestRelay(t)
	metaOf := func(c *testConn, id string) any {
		c.send("REQ", "meta-"+id, map[string]any{"kinds": []int{nostr.KindGroupMetadata}, "#d": []string{id}})
		msg := c.read()
		if msg[0] != "EVENT" {
			t.Fatalf("expected metadata for %s, got %v", id, msg)
		}
		if end := c.read(); end[0] != "EOSE" {
			t.Fatalf("expected exactly one metadata event for %s, got %v", id, end)
		}
		c.send("CLOSE", "meta-"+id)
		return msg[2]
	}

	creator, ch := dial(t, url)
	creator.login(ch)
	if ok, reason := creator.publish(creator.signed(nostr.KindCreateGroup, "", nostr.Tag{"h", "lunch"})); !ok {
		t.Fatalf("create channel: %s", reason)
	}
	if kpiOn(metaOf(creator, "lunch")) {
		t.Fatal("channels must not be reviewed unless someone asks for it")
	}

	other, ch2 := dial(t, url)
	other.login(ch2)
	turnOn := func(c *testConn, id string) (bool, string) {
		return c.publish(c.signed(nostr.KindEditGroup, "", nostr.Tag{"h", id}, nostr.Tag{"kpi", "on"}))
	}
	if ok, reason := turnOn(other, "lunch"); ok || !strings.HasPrefix(reason, "restricted") {
		t.Fatalf("only the creator may change a channel, got ok=%v %q", ok, reason)
	}
	if ok, reason := turnOn(creator, "lunch"); !ok {
		t.Fatalf("the creator should be able to turn review on: %s", reason)
	}
	if !kpiOn(metaOf(other, "lunch")) {
		t.Fatal("the channel should now be marked for review")
	}
	if ok, reason := creator.publish(creator.signed(nostr.KindEditGroup, "", nostr.Tag{"h", "lunch"}, nostr.Tag{"kpi", "off"})); !ok {
		t.Fatalf("the creator should be able to turn review off: %s", reason)
	}
	if kpiOn(metaOf(other, "lunch")) {
		t.Fatal("the mark should be gone after turning review off")
	}

	if ok, reason := creator.publish(creator.signed(nostr.KindCreateGroup, "", nostr.Tag{"h", "work"}, nostr.Tag{"kpi", "on"})); !ok {
		t.Fatalf("create reviewed channel: %s", reason)
	}
	if !kpiOn(metaOf(other, "work")) {
		t.Fatal("a channel created with review on should be marked")
	}
}

func TestEachPersonReadsOnlyTheirOwnReport(t *testing.T) {
	url := newTestRelay(t)
	maya, chMaya := dial(t, url)
	leo, chLeo := dial(t, url)
	mayaPub, leoPub := nostr.PubKeyHex(maya.priv), nostr.PubKeyHex(leo.priv)
	everyReport := map[string]any{"kinds": []int{nostr.KindAppData}}
	contentOf := func(msg []any) any { return msg[2].(map[string]any)["content"] }

	agent, ch := dial(t, url)
	agent.priv = agentKey
	agent.login(ch)
	publish := func(d, content string) {
		t.Helper()
		if ok, reason := agent.publish(agent.signed(nostr.KindAppData, content, nostr.Tag{"d", d})); !ok {
			t.Fatalf("agent should publish %s: %s", d, reason)
		}
	}
	publish("kpi-report", `{"who":"team"}`)
	publish("kpi-report:"+mayaPub, `{"who":"maya"}`)
	publish("kpi-report:"+leoPub, `{"who":"leo"}`)

	// Maya subscribes to everything before signing in, as the web app does.
	// She gets nothing until her login proves who she is, then only her own.
	maya.send("REQ", "all", everyReport)
	if msg := maya.read(); msg[0] != "EOSE" {
		t.Fatalf("nothing should be readable before login, got %v", msg)
	}
	maya.login(chMaya)
	if msg := maya.read(); msg[0] != "EVENT" || contentOf(msg) != `{"who":"maya"}` {
		t.Fatalf("Maya should get her own report after login, got %v", msg)
	}

	// Leo, signed in, asks for everything, and for Maya's by name.
	leo.login(chLeo)
	leo.send("REQ", "all", everyReport, map[string]any{"#d": []string{"kpi-report:" + mayaPub, "kpi-report"}})
	if msg := leo.read(); msg[0] != "EVENT" || contentOf(msg) != `{"who":"leo"}` {
		t.Fatalf("Leo should get only his own report, got %v", msg)
	}
	if msg := leo.read(); msg[0] != "EOSE" {
		t.Fatalf("Leo must not get the team's or Maya's report, got %v", msg)
	}

	// A manager gets all three.
	boss, chBoss := dial(t, url)
	boss.priv = bossKey
	boss.login(chBoss)
	boss.send("REQ", "all", everyReport)
	got := map[any]bool{}
	for msg := boss.read(); msg[0] != "EOSE"; msg = boss.read() {
		got[contentOf(msg)] = true
	}
	if len(got) != 3 {
		t.Fatalf("a manager should read the team report and both personal ones, got %v", got)
	}

	// Live updates follow the same rule: Maya's new report reaches Maya and
	// the manager, not Leo.
	time.Sleep(1100 * time.Millisecond) // a replacement must be newer by at least a second
	publish("kpi-report:"+mayaPub, `{"who":"maya","v":2}`)
	if msg := maya.read(); msg[0] != "EVENT" || contentOf(msg) != `{"who":"maya","v":2}` {
		t.Fatalf("Maya should get her update live, got %v", msg)
	}
	if msg := boss.read(); msg[0] != "EVENT" || contentOf(msg) != `{"who":"maya","v":2}` {
		t.Fatalf("the manager should get Maya's update live, got %v", msg)
	}
	leo.send("REQ", "ping", map[string]any{"ids": []string{"none"}})
	if msg := leo.read(); msg[0] != "EOSE" || msg[1] != "ping" {
		t.Fatalf("Leo must not get Maya's update, got %v", msg)
	}
}
