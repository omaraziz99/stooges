package kpi

import (
	"strings"
	"testing"
	"time"
)

func TestEachLevelsWeightsAddUpTo100(t *testing.T) {
	for _, l := range Levels {
		total := 0
		for _, p := range ItemsFor(l.ID) {
			total += p.Weight
		}
		if total != 100 || len(ItemsFor(l.ID)) != 7 {
			t.Errorf("level %s: %d items weighing %d%%, want 7 items and 100%%", l.ID, len(ItemsFor(l.ID)), total)
		}
	}
}

func TestEvidenceMustUseTheContributorsLevel(t *testing.T) {
	at := time.Date(2026, 10, 1, 9, 0, 0, 0, time.UTC)
	u := Unit{ID: "x", Kind: "conversation", Channel: "orbit", Messages: []Message{
		{ID: "a", Author: "Maya", AuthorKey: "ka", At: at, Text: "I split the migration into three PRs with a rollback plan."},
		{ID: "b", Author: "Priya", AuthorKey: "kb", At: at, Text: "Proposal: every squad adopts the shared review checklist."},
	}}
	AssignLevels([]Unit{u}, Team{Default: LevelEngineer, People: map[string]string{"Priya": LevelSenior}})
	u.Levels = map[string]string{"Maya": LevelEngineer, "Priya": LevelSenior}

	kept, dropped := Validate(&u, []Finding{
		{Contributor: "Maya", Pillar: "se_problem_solving", Summary: "Split a migration.", Impact: ImpactMedium, EvidenceRefs: []string{"m1"}},
		{Contributor: "Maya", Pillar: "sse_direction", Summary: "Wrong level.", Impact: ImpactLow, EvidenceRefs: []string{"m1"}},
		{Contributor: "Priya", Pillar: "sse_standards", Summary: "Proposed a checklist.", Impact: ImpactHigh, EvidenceRefs: []string{"m2"}},
	})
	if len(kept) != 2 || len(dropped) != 1 || !strings.Contains(dropped[0], "not a KPI item of their level") {
		t.Fatalf("kept %d, dropped %v", len(kept), dropped)
	}
	if !strings.Contains(u.Transcript(), "Levels: Maya = se; Priya = sse") {
		t.Fatalf("transcript should list levels:\n%s", u.Transcript())
	}

	r := BuildReport([]Unit{u}, kept, "test", []string{"orbit"}, nil)
	for _, p := range r.People {
		if want := map[string]string{"Maya": LevelEngineer, "Priya": LevelSenior}[p.Name]; p.Level != want {
			t.Errorf("%s: level %q, want %q", p.Name, p.Level, want)
		}
	}
	if r.Team.Counts["se_problem_solving"] != 1 || r.Team.Counts["sse_standards"] != 1 || len(r.Levels) != 2 {
		t.Fatalf("unexpected report summary: %+v", r.Team.Counts)
	}
}
