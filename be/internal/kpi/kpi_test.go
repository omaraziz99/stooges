package kpi

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/btcsuite/btcd/btcec/v2"

	"stooges/be/internal/nostr"
)

var t0 = time.Date(2026, 9, 3, 9, 0, 0, 0, time.UTC)

func msg(id, author string, minutes int, text string) Message {
	return Message{ID: id, Author: author, At: t0.Add(time.Duration(minutes) * time.Minute), Text: text}
}

func TestBuildUnitsGroupsThreadsAndConversations(t *testing.T) {
	top := []Message{
		msg("a", "Alice", 0, "deploy is green"),
		msg("b", "Alice", 5, "https://go.dev/blog"),
		msg("c", "Bob", 6, "nice"),
		msg("d", "Alice", 120, "retro moved to Friday"),    // has replies -> thread
		msg("e", "Carol", 400, "new design tokens are in"), // gap -> new conversation
	}
	replies := map[string][]Message{
		"d": {msg("d2", "Dave", 125, "works for me"), msg("d1", "Dave", 122, "same time?")},
	}
	units := BuildUnits("proj", top, replies)
	if len(units) != 3 {
		t.Fatalf("want 3 units, got %d", len(units))
	}
	if units[0].Kind != "conversation" || len(units[0].Messages) != 3 {
		t.Errorf("first unit should be a 3-message conversation, got %s with %d", units[0].Kind, len(units[0].Messages))
	}
	if units[1].Kind != "thread" || units[1].ID != "d" || units[1].Messages[1].ID != "d1" {
		t.Errorf("second unit should be thread d with replies in time order, got %+v", units[1])
	}
	if units[2].ID != "e" {
		t.Errorf("third unit should start at e, got %s", units[2].ID)
	}
}

func TestValidateGuardrails(t *testing.T) {
	u := &Unit{ID: "x", Kind: "thread", Channel: "proj", Messages: []Message{
		{ID: "1", Author: "Carol", At: t0, Text: "Onboarding guide draft is ready, feedback welcome", Reactions: map[string][]string{"🙌": {"Alice", "Carol"}}},
		{ID: "2", Author: "Bob", At: t0.Add(time.Minute), Text: "Step 3: run migrations before seeding, or the seed fails"},
	}}
	findings := []Finding{
		{Contributor: "Carol", Pillar: KnowledgeSharing, Summary: "Shared a walkthrough.", Impact: ImpactMedium, EvidenceRefs: []string{"m1"}},
		{Contributor: "Bob", Pillar: TechnicalLeadership, Summary: "Corrected the setup order.", Impact: ImpactHigh, EvidenceRefs: []string{"m2", "m2"}},
		{Contributor: "Ghost", Pillar: KnowledgeSharing, Summary: "x", Impact: ImpactLow, EvidenceRefs: []string{"m1"}},          // not a participant
		{Contributor: "Bob", Pillar: "vibes", Summary: "x", Impact: ImpactLow, EvidenceRefs: []string{"m2"}},                     // bad pillar
		{Contributor: "Bob", Pillar: KnowledgeSharing, Summary: "Took credit.", Impact: ImpactLow, EvidenceRefs: []string{"m1"}}, // cites someone else's message
		{Contributor: "Bob", Pillar: KnowledgeSharing, Summary: "x", Impact: "huge", EvidenceRefs: []string{"m2"}},               // bad impact
	}
	kept, dropped := Validate(u, findings)
	if len(kept) != 2 || len(dropped) != 4 {
		t.Fatalf("want 2 kept / 4 dropped, got %d / %d: %v", len(kept), len(dropped), dropped)
	}
	if kept[0].Endorsements != 1 {
		t.Errorf("self-reaction must not count as endorsement; got %d", kept[0].Endorsements)
	}
	if len(kept[1].MessageIDs) != 1 {
		t.Errorf("duplicate refs should collapse, got %v", kept[1].MessageIDs)
	}
}

// fakeEvaluator answers per unit; a batch fails if any unit in it fails.
type fakeEvaluator struct {
	byUnit map[string][]Finding
	fail   map[string]error
}

func (f fakeEvaluator) EvaluateBatch(_ context.Context, units []*Unit) ([][]Finding, error) {
	out := make([][]Finding, len(units))
	for i, u := range units {
		if err := f.fail[u.ID]; err != nil {
			return nil, err
		}
		out[i] = f.byUnit[u.ID]
	}
	return out, nil
}

func TestEvaluateAndReport(t *testing.T) {
	units := []Unit{
		{ID: "u1", Kind: "conversation", Channel: "proj", Messages: []Message{msg("1", "Alice", 0, "https://go.dev/blog — the new iterator helpers would simplify our pagination code")}},
		{ID: "u2", Kind: "thread", Channel: "proj", Messages: []Message{msg("2", "Bob", 60*24*30, "Release plan: freeze 10 Oct, launch 24 Oct"), msg("3", "Dave", 60*24*30+5, "ok")}},
		{ID: "u3", Kind: "conversation", Channel: "proj", Messages: []Message{msg("4", "Carol", 10, "hi")}},
	}
	ev := fakeEvaluator{
		byUnit: map[string][]Finding{
			"u1": {{Contributor: "Alice", Pillar: IndustryIntelligence, Summary: "Shared a Go release note with a recommendation.", Impact: ImpactMedium, EvidenceRefs: []string{"m1"}}},
			"u2": {{Contributor: "Bob", Pillar: OwnershipInitiative, Summary: "Set the release plan.", Impact: ImpactHigh, EvidenceRefs: []string{"m1"}}},
		},
		fail: map[string]error{"u3": ErrRefused},
	}
	// Batch size 1 so u3's failure doesn't take u1 and u2 down with it.
	res := Evaluate(context.Background(), ev, units, EvalOptions{Model: "m", BatchSize: 1, Parallel: 2})
	if len(res.Evidence) != 2 || len(res.Skipped) != 1 || res.Completed {
		t.Fatalf("want 2 evidence / 1 skipped / incomplete, got %d / %d / %v", len(res.Evidence), len(res.Skipped), res.Completed)
	}

	r := BuildReport(units, res.Evidence, "test-model", []string{"proj"}, res.Skipped)
	if len(r.People) != 4 {
		t.Fatalf("everyone who wrote should appear, got %d people", len(r.People))
	}
	if r.People[0].Name != "Alice" || r.People[3].Name != "Dave" {
		t.Errorf("people should be alphabetical, got %s..%s", r.People[0].Name, r.People[3].Name)
	}
	if r.Team.Counts[OwnershipInitiative] != 1 || r.Team.Counts[KnowledgeSharing] != 0 {
		t.Errorf("team counts wrong: %v", r.Team.Counts)
	}
	if len(r.Team.ByMonth) != 2 {
		t.Errorf("want evidence spread over 2 months, got %v", r.Team.ByMonth)
	}
	dave := r.People[3]
	if dave.Evidence == nil || len(dave.Evidence) != 0 {
		t.Errorf("people without evidence get an empty list, not null")
	}
	data, err := json.Marshal(r)
	if err != nil || !strings.Contains(string(data), `"se_problem_solving":0`) {
		t.Errorf("report JSON should include zero counts for every pillar: %v", err)
	}
}

func TestEvaluateReportsErrors(t *testing.T) {
	units := []Unit{{ID: "abcdefghijklmnop", Kind: "thread", Messages: []Message{msg("1", "A", 0, "x")}}}
	res := Evaluate(context.Background(), fakeEvaluator{fail: map[string]error{"abcdefghijklmnop": errors.New("server error")}}, units, EvalOptions{BatchSize: 4})
	if len(res.Skipped) != 1 || !strings.Contains(res.Skipped[0], "server error") {
		t.Fatalf("got %v", res.Skipped)
	}
}

func TestUnitsFromEvents(t *testing.T) {
	alice, _ := btcec.NewPrivateKey()
	bob, _ := btcec.NewPrivateKey()
	sign := func(k *btcec.PrivateKey, kind int, at time.Time, content string, tags ...nostr.Tag) nostr.Event {
		ev := nostr.Event{CreatedAt: at.Unix(), Kind: kind, Content: content, Tags: tags}
		ev.Sign(k)
		return ev
	}
	h := nostr.Tag{"h", "proj"}
	root := sign(alice, nostr.KindChatMessage, t0, "Proposal: move defaults to YAML", h)
	reply := sign(bob, nostr.KindChatMessage, t0.Add(time.Minute), "Agree", h, nostr.Tag{"e", root.ID, "", "root"})
	gone := sign(bob, nostr.KindChatMessage, t0.Add(2*time.Minute), "oops", h)
	chat := []nostr.Event{
		reply, root, gone,
		sign(bob, nostr.KindReaction, t0.Add(3*time.Minute), "👀", nostr.Tag{"e", root.ID}, h),
		sign(bob, nostr.KindDeletion, t0.Add(4*time.Minute), "", nostr.Tag{"e", gone.ID}, h),
		sign(alice, nostr.KindDeletion, t0.Add(4*time.Minute), "", nostr.Tag{"e", reply.ID}, h), // not hers: ignored
	}
	profiles := []nostr.Event{
		sign(alice, nostr.KindProfile, t0, `{"name":"Alice"}`),
		sign(bob, nostr.KindProfile, t0.Add(-time.Hour), `{"name":"Old Bob"}`),
		sign(bob, nostr.KindProfile, t0, `{"name":"Bob"}`),
	}

	consents := []nostr.Event{
		sign(alice, nostr.KindAppData, t0, `{"consent":true}`, nostr.Tag{"d", nostr.KPIConsentTag}),
		sign(bob, nostr.KindAppData, t0, `{"consent":true}`, nostr.Tag{"d", nostr.KPIConsentTag}),
	}

	units := unitsFromEvents("proj", chat, profiles, consents)
	if len(units) != 1 || units[0].Kind != "thread" {
		t.Fatalf("want one thread (deleted message dropped), got %+v", units)
	}
	msgs := units[0].Messages
	if len(msgs) != 2 || msgs[0].Author != "Alice" || msgs[1].Author != "Bob" {
		t.Fatalf("want Alice's root and Bob's surviving reply, got %+v", msgs)
	}
	if got := msgs[0].Reactions["👀"]; len(got) != 1 || got[0] != "Bob" {
		t.Errorf("reaction should be attributed to Bob by latest name, got %v", got)
	}
}

func TestSchemaAndPromptCoverEveryPillar(t *testing.T) {
	var schema map[string]any
	if err := json.Unmarshal(findingsSchema, &schema); err != nil {
		t.Fatalf("schema is not valid JSON: %v", err)
	}
	prompt := SystemPrompt()
	for _, p := range Pillars {
		if !strings.Contains(string(findingsSchema), string(p.ID)) || !strings.Contains(prompt, string(p.ID)) {
			t.Errorf("pillar %s missing from schema or prompt", p.ID)
		}
	}
}

// Display names are free text. Someone who takes a colleague's name must not
// have their messages credited to that colleague, or the other way round.
func TestSameNameDifferentKeysStaySeparate(t *testing.T) {
	maya, _ := btcec.NewPrivateKey()
	impostor, _ := btcec.NewPrivateKey()
	sign := func(k *btcec.PrivateKey, kind int, at time.Time, content string, tags ...nostr.Tag) nostr.Event {
		ev := nostr.Event{CreatedAt: at.Unix(), Kind: kind, Content: content, Tags: tags}
		ev.Sign(k)
		return ev
	}
	h := nostr.Tag{"h", "proj"}
	chat := []nostr.Event{
		sign(maya, nostr.KindChatMessage, t0, "Root cause is the retry loop; fix is in review", h),
		sign(impostor, nostr.KindChatMessage, t0.Add(time.Minute), "me too", h),
	}
	profiles := []nostr.Event{
		sign(maya, nostr.KindProfile, t0, `{"name":"Maya Chen"}`),
		sign(impostor, nostr.KindProfile, t0, `{"name":"Maya Chen"}`),
	}

	consents := []nostr.Event{
		sign(maya, nostr.KindAppData, t0, `{"consent":true}`, nostr.Tag{"d", nostr.KPIConsentTag}),
		sign(impostor, nostr.KindAppData, t0, `{"consent":true}`, nostr.Tag{"d", nostr.KPIConsentTag}),
	}

	units := unitsFromEvents("proj", chat, profiles, consents)
	if len(units) != 1 || len(units[0].Messages) != 2 {
		t.Fatalf("want one conversation of two messages, got %+v", units)
	}
	real, fake := units[0].Messages[0], units[0].Messages[1]
	if real.Author == fake.Author {
		t.Fatalf("the two accounts must be shown under different names, both are %q", real.Author)
	}

	// The model credits the real Maya but also cites the impostor's message.
	kept, _ := Validate(&units[0], []Finding{{
		Contributor: real.Author, Pillar: TechnicalLeadership, Summary: "Diagnosed the retry loop",
		Impact: ImpactMedium, EvidenceRefs: []string{"m1", "m2"},
	}})
	if len(kept) != 1 || kept[0].Pubkey != nostr.PubKeyHex(maya) || len(kept[0].MessageIDs) != 1 {
		t.Fatalf("evidence should cite only the real author's message, got %+v", kept)
	}

	report := BuildReport(units, kept, "test-model", []string{"proj"}, nil)
	if len(report.People) != 2 {
		t.Fatalf("want two separate people, got %d", len(report.People))
	}
	for _, p := range report.People {
		wantEvidence := 0
		if p.Pubkey == nostr.PubKeyHex(maya) {
			wantEvidence = 1
		}
		if len(p.Evidence) != wantEvidence || p.Messages != 1 {
			t.Errorf("%s (%s): %d evidence, %d messages", p.Name, p.Pubkey[:6], len(p.Evidence), p.Messages)
		}
	}
}

// Only people who opted in are read. Everyone else keeps their place in the
// conversation but their name and words never reach the model or the report.
func TestOnlyOptedInPeopleAreReviewed(t *testing.T) {
	alice, _ := btcec.NewPrivateKey()
	bob, _ := btcec.NewPrivateKey()
	carol, _ := btcec.NewPrivateKey()
	sign := func(k *btcec.PrivateKey, kind int, at time.Time, content string, tags ...nostr.Tag) nostr.Event {
		ev := nostr.Event{CreatedAt: at.Unix(), Kind: kind, Content: content, Tags: tags}
		ev.Sign(k)
		return ev
	}
	h := nostr.Tag{"h", "proj"}
	consent := nostr.Tag{"d", nostr.KPIConsentTag}
	root := sign(alice, nostr.KindChatMessage, t0, "Wrote up the rollback steps in the wiki", h)
	chat := []nostr.Event{
		root,
		sign(bob, nostr.KindChatMessage, t0.Add(time.Minute), "my private opinion", h, nostr.Tag{"e", root.ID, "", "root"}),
		sign(bob, nostr.KindReaction, t0.Add(2*time.Minute), "👍", nostr.Tag{"e", root.ID}, h),
		// Much later, a conversation among people who are not opted in.
		sign(bob, nostr.KindChatMessage, t0.Add(5*time.Hour), "anyone for lunch", h),
		sign(carol, nostr.KindChatMessage, t0.Add(5*time.Hour+time.Minute), "yes", h),
	}
	profiles := []nostr.Event{
		sign(alice, nostr.KindProfile, t0, `{"name":"Alice"}`),
		sign(bob, nostr.KindProfile, t0, `{"name":"Bob"}`),
		sign(carol, nostr.KindProfile, t0, `{"name":"Carol"}`),
	}
	consents := []nostr.Event{
		sign(alice, nostr.KindAppData, t0, `{"consent":true}`, consent),
		sign(carol, nostr.KindAppData, t0, `{"consent":false}`, consent), // opted out
	}

	units := unitsFromEvents("proj", chat, profiles, consents)
	if len(units) != 1 {
		t.Fatalf("the conversation with nobody opted in should be dropped, got %d units", len(units))
	}
	transcript := units[0].Transcript()
	for _, leaked := range []string{"Bob", "my private opinion", "👍"} {
		if strings.Contains(transcript, leaked) {
			t.Errorf("transcript must not contain %q:\n%s", leaked, transcript)
		}
	}
	if !strings.Contains(transcript, "rollback steps") {
		t.Errorf("Alice opted in, so her message should be there:\n%s", transcript)
	}

	// Even if the model credits the placeholder, nothing is recorded for it.
	kept, _ := Validate(&units[0], []Finding{
		{Contributor: "Alice", Pillar: KnowledgeSharing, Summary: "Documented rollback", Impact: ImpactLow, EvidenceRefs: []string{"m1"}},
		{Contributor: units[0].Messages[1].Author, Pillar: KnowledgeSharing, Summary: "x", Impact: ImpactLow, EvidenceRefs: []string{"m2"}},
	})
	if len(kept) != 1 || kept[0].Contributor != "Alice" {
		t.Fatalf("only Alice's contribution should be kept, got %+v", kept)
	}
	report := BuildReport(units, kept, "test-model", []string{"proj"}, nil)
	if len(report.People) != 1 || report.People[0].Name != "Alice" {
		t.Fatalf("only opted-in people appear in the report, got %+v", report.People)
	}
}

// A personal report must carry nothing about anyone else.
func TestPersonalReportHoldsOnlyThatPerson(t *testing.T) {
	units := []Unit{{ID: "1", Kind: "conversation", Channel: "proj", Messages: []Message{
		{ID: "1", Author: "Alice", AuthorKey: "a", At: t0, Text: "Wrote the runbook"},
		{ID: "2", Author: "Bob", AuthorKey: "b", At: t0.Add(time.Minute), Text: "Fixed the flaky test"},
	}}}
	kept, _ := Validate(&units[0], []Finding{
		{Contributor: "Alice", Pillar: KnowledgeSharing, Summary: "Wrote the runbook", Impact: ImpactMedium, EvidenceRefs: []string{"m1"}},
		{Contributor: "Bob", Pillar: OwnershipInitiative, Summary: "Fixed the flaky test", Impact: ImpactLow, EvidenceRefs: []string{"m2"}},
	})
	team := BuildReport(units, kept, "test-model", []string{"proj"}, []string{"thread x: failed"})
	if len(team.People) != 2 {
		t.Fatalf("want two people in the team report, got %d", len(team.People))
	}

	mine := team.Personal(team.People[0]) // Alice
	data, _ := json.Marshal(mine)
	if strings.Contains(string(data), "Bob") || strings.Contains(string(data), "flaky") {
		t.Fatalf("Alice's report must not mention Bob or his work: %s", data)
	}
	if len(mine.People) != 1 || mine.People[0].Name != "Alice" {
		t.Fatalf("want only Alice, got %+v", mine.People)
	}
	if mine.Team.Counts[KnowledgeSharing] != 1 || mine.Team.Counts[OwnershipInitiative] != 0 {
		t.Errorf("totals should count only Alice's evidence, got %v", mine.Team.Counts)
	}
	if len(team.People) != 2 || team.Team.Counts[OwnershipInitiative] != 1 {
		t.Error("building a personal report must not change the team report")
	}
}
