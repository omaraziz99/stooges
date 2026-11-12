package kpi

// SampleAgent fills a report without any AI: simple keyword rules sort
// messages into the framework's items. It exists so the dashboard can be
// demoed and developed with no API key or quota (`go run ./cmd/kpi -sample`).
// Its output is labelled as sample data everywhere it appears, and every
// item's rationale names the keyword that matched. It is not an assessment.

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"
)

// SampleModelName is the report's "model" for sample runs.
const SampleModelName = "keyword rules"

// sampleRule maps keywords to an item for each level, with a summary verb.
type sampleRule struct {
	words  []string
	items  map[string]Pillar // level -> item
	action string
}

// Checked in order; the first rule with a matching keyword wins.
var sampleRules = []sampleRule{
	{[]string{"walkthrough", "session", "onboarding", "guide", "how-to", "write-up", "wrote up", "docs"},
		map[string]Pillar{LevelEngineer: "se_mentorship", LevelSenior: "sse_mentorship"}, "Shared knowledge"},
	{[]string{"every squad", "standard", "architecture", "adopt", "convention", "rfc"},
		map[string]Pillar{LevelEngineer: "se_improvement", LevelSenior: "sse_direction"}, "Set technical direction"},
	{[]string{"root cause", "trade-off", "tradeoff", "option a", "option b", "proposal", "investigat", "because"},
		map[string]Pillar{LevelEngineer: "se_problem_solving", LevelSenior: "sse_problem_solving"}, "Worked through a problem"},
	{[]string{"automat", "pipeline", "lint", "faster", "dashboard", "alert", "monitor", "flaky"},
		map[string]Pillar{LevelEngineer: "se_improvement", LevelSenior: "sse_standards"}, "Improved how the team works"},
	{[]string{"deadline", "by friday", "go/no-go", "on track", "risk", "blocker", "i'll own", "i'll take", "owner"},
		map[string]Pillar{LevelEngineer: "se_accountability", LevelSenior: "sse_alignment"}, "Took ownership of a commitment"},
	{[]string{"shipped", "merged", "released", "deployed", "rolled out", "launch", "fixed", " pr "},
		map[string]Pillar{LevelEngineer: "se_delivery", LevelSenior: "sse_ownership"}, "Delivered work"},
	{[]string{"pair", "review", "unblock", "happy to help", "i can help"},
		map[string]Pillar{LevelEngineer: "se_collaboration", LevelSenior: "sse_mentorship"}, "Helped teammates"},
	{[]string{"heads up", "fyi", "update", "status", "summary"},
		map[string]Pillar{LevelEngineer: "se_communication", LevelSenior: "sse_alignment"}, "Kept people informed"},
	{[]string{"try", "trial", "pilot", "roll out to"},
		map[string]Pillar{LevelEngineer: "se_improvement", LevelSenior: "sse_change"}, "Championed a change"},
}

// SampleAgent implements Agent with keyword rules.
type SampleAgent struct{}

func (SampleAgent) ModelName() string { return SampleModelName }

// EvaluateBatch records at most one item per person per conversation: the
// first of their messages that matches a rule.
func (SampleAgent) EvaluateBatch(_ context.Context, units []*Unit) ([][]Finding, error) {
	out := make([][]Finding, len(units))
	for i, u := range units {
		credited := map[string]bool{}
		for j, m := range u.Messages {
			text := " " + strings.ToLower(m.Text) + " "
			if m.Excluded || credited[m.Author] || len([]rune(m.Text)) < 40 {
				continue
			}
			level := LevelEngineer
			if u.Levels != nil && u.Levels[m.Author] != "" {
				level = u.Levels[m.Author]
			}
			for _, rule := range sampleRules {
				word := matchAny(text, rule.words)
				if word == "" {
					continue
				}
				item := rule.items[level]
				info, _ := ItemInfo(item)
				out[i] = append(out[i], Finding{
					Conversation: ConversationLabel(i),
					Contributor:  m.Author,
					Pillar:       item,
					Summary:      fmt.Sprintf("%s in #%s: “%s”", rule.action, u.Channel, truncate(m.Text, 90)),
					Impact:       sampleImpact(m),
					EvidenceRefs: []string{Ref(j)},
					Rationale:    fmt.Sprintf("The message mentions “%s”, which points to %s.", strings.TrimSpace(word), info.Name),
				})
				credited[m.Author] = true
				break
			}
		}
	}
	return out, nil
}

func matchAny(text string, words []string) string {
	for _, w := range words {
		if strings.Contains(text, w) {
			return w
		}
	}
	return ""
}

func sampleImpact(m Message) Impact {
	reactions := 0
	for _, people := range m.Reactions {
		for _, who := range people {
			if who != m.Author {
				reactions++
			}
		}
	}
	n := len([]rune(m.Text))
	switch {
	case reactions >= 3 || n > 220:
		return ImpactHigh
	case reactions >= 1 || n > 110:
		return ImpactMedium
	default:
		return ImpactLow
	}
}

// Review writes a template review from the person's evidence counts.
func (SampleAgent) Review(_ context.Context, p *Person, _, _ time.Time) (*Review, error) {
	type tally struct {
		item  PillarInfo
		index []int
	}
	byItem := map[Pillar]*tally{}
	for i, e := range p.Evidence {
		t := byItem[e.Pillar]
		if t == nil {
			info, _ := ItemInfo(e.Pillar)
			t = &tally{item: info}
			byItem[e.Pillar] = t
		}
		t.index = append(t.index, i+1)
	}
	var ranked []*tally
	for _, t := range byItem {
		ranked = append(ranked, t)
	}
	// Most evidence first; ties go to the item with more weight.
	sort.Slice(ranked, func(i, j int) bool {
		if len(ranked[i].index) != len(ranked[j].index) {
			return len(ranked[i].index) > len(ranked[j].index)
		}
		return ranked[i].item.Weight > ranked[j].item.Weight
	})

	rv := &Review{
		Headline: fmt.Sprintf("Most evidence under %s", ranked[0].item.Name),
		Summary: fmt.Sprintf("%s has %s of chat evidence across %s, most under %s (%d%% of their level's KPI).",
			p.Name, plural(len(p.Evidence), "piece", "pieces"), plural(len(ranked), "KPI item", "KPI items"),
			ranked[0].item.Name, ranked[0].item.Weight),
	}
	for _, t := range ranked[:min(3, len(ranked))] {
		rv.Highlights = append(rv.Highlights, Highlight{
			Pillar:   t.item.ID,
			Text:     fmt.Sprintf("Shown in %s of evidence.", plural(len(t.index), "piece", "pieces")),
			Evidence: t.index,
		})
	}
	rv.DiscussionPoints = []string{
		fmt.Sprintf("Which recent work best shows %s, and what helped it go well?", ranked[0].item.Name),
		"Which KPI items does chat not capture for you, and where would we see that work instead?",
	}
	if err := ValidateReview(rv, len(p.Evidence)); err != nil {
		return nil, err
	}
	return rv, nil
}

// plural writes a count with the right noun: "1 piece", "3 pieces".
func plural(n int, one, many string) string {
	if n == 1 {
		return fmt.Sprintf("1 %s", one)
	}
	return fmt.Sprintf("%d %s", n, many)
}
