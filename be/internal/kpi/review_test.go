package kpi

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"
)

func TestValidateReview(t *testing.T) {
	rv := &Review{
		Headline: "  Drives delivery deadlines  ",
		Summary:  "Set the delivery plan.",
		Highlights: []Highlight{
			{Pillar: OwnershipInitiative, Text: "Set deadlines.", Evidence: []int{1, 1, 2}},
			{Pillar: "vibes", Text: "Bad pillar.", Evidence: []int{1}},
			{Pillar: KnowledgeSharing, Text: "Points at nothing real.", Evidence: []int{0, 9}},
			{Pillar: TechnicalLeadership, Text: "  ", Evidence: []int{2}},
		},
		DiscussionPoints: []string{"What helps?", " ", "a", "b", "c", "d"},
	}
	if err := ValidateReview(rv, 2); err != nil {
		t.Fatal(err)
	}
	if rv.Headline != "Drives delivery deadlines" {
		t.Errorf("headline not trimmed: %q", rv.Headline)
	}
	if len(rv.Highlights) != 1 || len(rv.Highlights[0].Evidence) != 2 || rv.Highlights[0].Evidence[0] != 0 {
		t.Fatalf("want one highlight with 0-based evidence [0 1], got %+v", rv.Highlights)
	}
	if len(rv.DiscussionPoints) != maxDiscussionPoints {
		t.Errorf("discussion points should be capped at %d, got %v", maxDiscussionPoints, rv.DiscussionPoints)
	}
	if err := ValidateReview(&Review{Summary: " "}, 1); err == nil {
		t.Error("a review without a summary should be rejected")
	}
}

type fakeReviewer struct{ fail string }

func (f fakeReviewer) Review(_ context.Context, p *Person, _, _ time.Time) (*Review, error) {
	if p.Name == f.fail {
		return nil, errors.New("boom")
	}
	return &Review{Headline: "h", Summary: "s for " + p.Name, Highlights: []Highlight{{Pillar: p.Evidence[0].Pillar, Text: "t", Evidence: []int{1}}}}, nil
}

func TestWriteReviews(t *testing.T) {
	r := Report{People: []Person{
		{Name: "Alice", Evidence: []Evidence{{Pillar: IndustryIntelligence}}},
		{Name: "Bob", Evidence: []Evidence{}},
		{Name: "Carol", Evidence: []Evidence{{Pillar: KnowledgeSharing}}},
	}}
	failed, quota := WriteReviews(context.Background(), fakeReviewer{fail: "Carol"}, &r, ReviewOptions{Parallel: 2})
	if quota != nil {
		t.Fatalf("no quota error expected, got %v", quota)
	}
	if r.People[0].Review == nil || r.People[0].Review.Summary != "s for Alice" {
		t.Errorf("Alice should get a review, got %+v", r.People[0].Review)
	}
	if r.People[1].Review != nil {
		t.Error("people without evidence get no AI review")
	}
	if r.People[2].Review != nil || len(failed) != 1 || !strings.Contains(failed[0], "Carol") {
		t.Errorf("Carol's failed review should be reported, got %v", failed)
	}
}

func TestReviewPromptUsesOnlyEvidence(t *testing.T) {
	p := &Person{Name: "Maya Chen", Messages: 29, Evidence: []Evidence{{
		Pillar: OwnershipInitiative, Impact: ImpactHigh, At: t0, Channel: "proj",
		Summary: "Set the release plan.", Quote: "Code freeze 10 Oct, launch 24 Oct", Endorsements: 2,
	}}}
	prompt := reviewUserPrompt(p, t0, t0.AddDate(0, 3, 0))
	for _, want := range []string{"Maya Chen", "[1] se_accountability, high impact", "2 teammate reactions", "Code freeze 10 Oct"} {
		if !strings.Contains(prompt, want) {
			t.Errorf("prompt missing %q:\n%s", want, prompt)
		}
	}
	for _, p := range Pillars {
		if !strings.Contains(string(reviewSchema), string(p.ID)) {
			t.Errorf("review schema missing pillar %s", p.ID)
		}
	}
}
