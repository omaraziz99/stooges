package kpi

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"
)

// Review is the written KPI review a manager sees for one person
// (e.g. via /kpi-<name>). It is drafted only from that person's evidence.
type Review struct {
	Headline         string      `json:"headline"`
	Summary          string      `json:"summary"`
	Highlights       []Highlight `json:"highlights"`
	DiscussionPoints []string    `json:"discussion_points"`
}

// Highlight is one strength, tied to pieces of the person's evidence.
type Highlight struct {
	Pillar Pillar `json:"pillar"`
	Text   string `json:"text"`
	// Evidence holds 1-based numbers from the model; after validation they
	// are 0-based indexes into Person.Evidence.
	Evidence []int `json:"evidence"`
}

// Reviewer writes a review from one person's evidence.
type Reviewer interface {
	Review(ctx context.Context, p *Person, from, to time.Time) (*Review, error)
}

const (
	maxHighlights       = 4
	maxDiscussionPoints = 4
)

// ValidateReview trims text, drops highlights with an unknown pillar or no
// valid evidence numbers, converts evidence numbers to 0-based indexes, and
// caps list lengths. It returns an error if nothing usable is left.
func ValidateReview(rv *Review, evidenceCount int) error {
	rv.Headline = strings.TrimSpace(rv.Headline)
	rv.Summary = strings.TrimSpace(rv.Summary)
	if rv.Summary == "" {
		return fmt.Errorf("review has no summary")
	}

	var highlights []Highlight
	for _, h := range rv.Highlights {
		h.Text = strings.TrimSpace(h.Text)
		if !ValidPillar(h.Pillar) || h.Text == "" {
			continue
		}
		var idx []int
		seen := map[int]bool{}
		for _, n := range h.Evidence {
			if n >= 1 && n <= evidenceCount && !seen[n] {
				seen[n] = true
				idx = append(idx, n-1)
			}
		}
		if len(idx) == 0 {
			continue // a highlight must point at real evidence
		}
		h.Evidence = idx
		highlights = append(highlights, h)
		if len(highlights) == maxHighlights {
			break
		}
	}
	rv.Highlights = highlights
	if rv.Highlights == nil {
		rv.Highlights = []Highlight{}
	}

	var points []string
	for _, p := range rv.DiscussionPoints {
		if p = strings.TrimSpace(p); p != "" {
			points = append(points, p)
		}
		if len(points) == maxDiscussionPoints {
			break
		}
	}
	rv.DiscussionPoints = points
	if rv.DiscussionPoints == nil {
		rv.DiscussionPoints = []string{}
	}
	return nil
}

// ReviewOptions controls WriteReviews.
type ReviewOptions struct {
	Model    string // part of the cache key
	Cache    *Cache // nil means no caching
	Parallel int
	Progress func(name string, cached bool, err error)
}

// WriteReviews drafts a review for every person with evidence, reusing
// cached reviews when their evidence hasn't changed. People without
// evidence get no review (the dashboard says so). It returns a reason for
// each review that failed, and the quota error if the quota ran out.
func WriteReviews(ctx context.Context, rw Reviewer, r *Report, opt ReviewOptions) (failed []string, quota *QuotaError) {
	cache := opt.Cache
	if cache == nil {
		cache, _ = OpenCache("")
	}
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	sem := make(chan struct{}, max(1, opt.Parallel))
	var wg sync.WaitGroup
	var mu sync.Mutex

	for i := range r.People {
		p := &r.People[i]
		if len(p.Evidence) == 0 {
			continue
		}
		key := reviewKey(opt.Model, p, r.From, r.To)
		rv, cached := cache.review(key)
		wg.Add(1)
		go func() {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()

			var err error
			if !cached {
				mu.Lock()
				stopped := quota != nil
				mu.Unlock()
				if stopped {
					err = ErrQuotaExhausted
				} else if rv, err = rw.Review(ctx, p, r.From, r.To); err == nil {
					cache.putReview(key, rv)
				}
			}
			if err == nil {
				err = ValidateReview(rv, len(p.Evidence))
			}

			mu.Lock()
			defer mu.Unlock()
			var qe *QuotaError
			if errors.As(err, &qe) && quota == nil {
				quota = qe
				cancel()
			}
			if err != nil {
				failed = append(failed, fmt.Sprintf("review for %s: %v", p.Name, reasonFor(err, quota)))
			} else {
				p.Review = rv
			}
			if opt.Progress != nil {
				opt.Progress(p.Name, cached, err)
			}
		}()
	}
	wg.Wait()
	return failed, quota
}

// ReviewSystemPrompt sets the rules for written reviews.
func ReviewSystemPrompt() string {
	var b strings.Builder
	b.WriteString(`You draft KPI review notes that a manager reads before a 1-on-1 with an engineer. You receive only the evidence log for one person: contributions that were found in team chat and checked against the original messages. Each item is numbered [1], [2], and so on, with its KPI item, impact level, date, a summary, and a quote. You are also told the person's level; their KPI items are weighted, so the items with more weight matter more to their review.

The KPI items, by level:
`)
	for _, l := range Levels {
		fmt.Fprintf(&b, "\nLevel %s, %s:\n", l.ID, l.Title)
		for _, p := range ItemsFor(l.ID) {
			fmt.Fprintf(&b, "- %s (%s, %d%%): %s\n", p.ID, p.Name, p.Weight, p.KPI)
		}
	}
	b.WriteString(`
Rules:
- Use only the evidence given. Do not invent projects, outcomes, or numbers, and do not speculate about work that is not in the log.
- This is recognition and a starting point for conversation, not a rating. Do not score, rank, or compare the person with anyone else.
- Do not judge personality, attitude, or effort, and do not mention weaknesses. Areas with no evidence are handled separately; leave them out.
- Chat shows only part of anyone's work. Write about what the evidence shows, not about the person overall.
- Plain, specific, neutral language. No praise words such as "excellent", "outstanding", or "rockstar".

Write:
- headline: one line of at most 15 words naming the clearest pattern in their contributions.
- summary: 2 to 4 sentences describing what the evidence shows, with the most significant contributions first.
- highlights: up to 4 strengths. Each names a KPI item of the person's level (its ID), says what they did in one sentence, and lists the evidence numbers that show it, such as [1, 3].
- discussion_points: 2 to 4 open questions the manager could ask in the 1-on-1, grounded in the evidence. For example, ask what support would help them keep doing something, or whether they want more of a kind of work.`)
	return b.String()
}

func reviewUserPrompt(p *Person, from, to time.Time) string {
	var b strings.Builder
	level := p.Level
	for _, l := range Levels {
		if l.ID == p.Level {
			level = fmt.Sprintf("%s (%s)", l.ID, l.Title)
		}
	}
	fmt.Fprintf(&b, "Person: %s\nLevel: %s\nPeriod: %s to %s\nMessages written in reviewed channels: %d\n\nEvidence:\n",
		p.Name, level, from.Format("2006-01-02"), to.Format("2006-01-02"), p.Messages)
	for i, e := range p.Evidence {
		fmt.Fprintf(&b, "\n[%d] %s, %s impact, %s, #%s", i+1, e.Pillar, e.Impact, e.At.Format("2006-01-02"), e.Channel)
		if e.Endorsements > 0 {
			fmt.Fprintf(&b, ", %d teammate reactions", e.Endorsements)
		}
		fmt.Fprintf(&b, "\nSummary: %s\nQuote: %s\n", e.Summary, e.Quote)
	}
	return b.String()
}

var reviewSchema = mustJSON(map[string]any{
	"type": "object",
	"properties": map[string]any{
		"headline": map[string]any{"type": "string"},
		"summary":  map[string]any{"type": "string"},
		"highlights": map[string]any{
			"type": "array",
			"items": map[string]any{
				"type": "object",
				"properties": map[string]any{
					"pillar":   map[string]any{"type": "string", "enum": itemIDs()},
					"text":     map[string]any{"type": "string"},
					"evidence": map[string]any{"type": "array", "items": map[string]any{"type": "integer"}},
				},
				"required":             []string{"pillar", "text", "evidence"},
				"additionalProperties": false,
			},
		},
		"discussion_points": map[string]any{"type": "array", "items": map[string]any{"type": "string"}},
	},
	"required":             []string{"headline", "summary", "highlights", "discussion_points"},
	"additionalProperties": false,
})
