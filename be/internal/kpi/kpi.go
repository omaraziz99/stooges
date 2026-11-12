// Package kpi turns team chat into an evidence log against an engineering
// KPI framework (see framework.go): the delivery, problem solving,
// collaboration, and mentoring that commit counts and ticket metrics miss.
// It groups messages into conversations, asks an evaluator (an AI model)
// what each person visibly contributed to their level's KPI items, and
// builds a report for 1-on-1s and appraisals.
//
// Design rules: it records positive, specific evidence only (never negative
// judgments or personal matters), every item links back to the source
// messages, and it never sums evidence into a single score.
package kpi

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"
)

// Pillar is the ID of one KPI item, such as "se_delivery".
type Pillar string

// Impact is how much a contribution moved the team forward.
type Impact string

const (
	ImpactLow    Impact = "low"
	ImpactMedium Impact = "medium"
	ImpactHigh   Impact = "high"
)

// Message is one chat message.
type Message struct {
	ID        string
	Author    string // display name, unique to one key within a unit
	AuthorKey string // public key; names are free text, so people are told apart by this
	// Excluded marks a placeholder for someone who has not opted in: it holds
	// neither their name nor their text, and is never credited or counted.
	Excluded bool
	At       time.Time
	Text     string
	// Reactions maps an emoji to the names of people who reacted with it.
	Reactions map[string][]string
}

// Unit is what the evaluator judges at once: a thread, or a run of
// top-level messages close together in time.
type Unit struct {
	ID       string    `json:"id"`   // first message ID
	Kind     string    `json:"kind"` // "thread" or "conversation"
	Channel  string    `json:"channel"`
	Messages []Message `json:"-"`
	// Levels maps each participant's name to their framework level. Nil
	// means levels are unknown and any item is accepted.
	Levels map[string]string `json:"-"`
}

// Participants returns the distinct authors in the unit, in order of appearance.
func (u *Unit) Participants() []string {
	var out []string
	seen := map[string]bool{}
	for _, m := range u.Messages {
		if !seen[m.Author] {
			seen[m.Author] = true
			out = append(out, m.Author)
		}
	}
	return out
}

// Ref is the short label a message gets in the transcript ("m1", "m2", ...).
func Ref(i int) string { return fmt.Sprintf("m%d", i+1) }

// Transcript renders the unit for the evaluator, one labelled message per block.
func (u *Unit) Transcript() string {
	var b strings.Builder
	fmt.Fprintf(&b, "Channel: #%s\nType: %s\n", u.Channel, u.Kind)
	if len(u.Levels) > 0 {
		var parts []string
		for _, name := range u.Participants() {
			if l, ok := u.Levels[name]; ok {
				parts = append(parts, fmt.Sprintf("%s = %s", name, l))
			}
		}
		fmt.Fprintf(&b, "Levels: %s\n", strings.Join(parts, "; "))
	}
	b.WriteByte('\n')
	for i, m := range u.Messages {
		fmt.Fprintf(&b, "[%s] %s (%s)", Ref(i), m.Author, m.At.Format("2006-01-02 15:04"))
		if i > 0 && u.Kind == "thread" {
			b.WriteString(" [reply]")
		}
		b.WriteString(":\n")
		b.WriteString(m.Text)
		b.WriteByte('\n')
		if len(m.Reactions) > 0 {
			emojis := make([]string, 0, len(m.Reactions))
			for e := range m.Reactions {
				emojis = append(emojis, e)
			}
			sort.Strings(emojis)
			var parts []string
			for _, e := range emojis {
				parts = append(parts, fmt.Sprintf("%s by %s", e, strings.Join(m.Reactions[e], ", ")))
			}
			fmt.Fprintf(&b, "(reactions: %s)\n", strings.Join(parts, "; "))
		}
		b.WriteByte('\n')
	}
	return b.String()
}

// ConversationGap splits top-level messages into separate conversations.
const ConversationGap = 45 * time.Minute

// BuildUnits groups a channel's messages: each thread (root plus replies) is
// one unit, and the remaining top-level messages are split into
// conversations wherever the gap between messages exceeds ConversationGap.
// topLevel must be the channel's root messages; replies maps a root ID to its replies.
func BuildUnits(channel string, topLevel []Message, replies map[string][]Message) []Unit {
	sorted := append([]Message(nil), topLevel...)
	sort.SliceStable(sorted, func(i, j int) bool { return sorted[i].At.Before(sorted[j].At) })

	var units []Unit
	var current []Message
	flush := func() {
		if len(current) > 0 {
			units = append(units, Unit{ID: current[0].ID, Kind: "conversation", Channel: channel, Messages: current})
			current = nil
		}
	}
	for _, m := range sorted {
		if rs := replies[m.ID]; len(rs) > 0 {
			thread := append([]Message{m}, rs...)
			sort.SliceStable(thread[1:], func(i, j int) bool { return thread[1+i].At.Before(thread[1+j].At) })
			units = append(units, Unit{ID: m.ID, Kind: "thread", Channel: channel, Messages: thread})
			continue
		}
		if len(current) > 0 && m.At.Sub(current[len(current)-1].At) > ConversationGap {
			flush()
		}
		current = append(current, m)
	}
	flush()
	sort.SliceStable(units, func(i, j int) bool { return units[i].Messages[0].At.Before(units[j].Messages[0].At) })
	return units
}

// Finding is one contribution as returned by an evaluator, before validation.
type Finding struct {
	Conversation string   `json:"conversation"` // batch label, e.g. "c2"
	Contributor  string   `json:"contributor"`
	Pillar       Pillar   `json:"pillar"`
	Summary      string   `json:"summary"`
	Impact       Impact   `json:"impact"`
	EvidenceRefs []string `json:"evidence_refs"`
	Rationale    string   `json:"rationale"`
}

// Evaluator finds KPI contributions in one unit.
type Evaluator interface {
	// EvaluateBatch judges several conversations in one request and returns
	// the findings for each, in the same order as units.
	EvaluateBatch(ctx context.Context, units []*Unit) ([][]Finding, error)
}

// Evidence is a validated contribution, linked to its source messages.
type Evidence struct {
	Contributor  string    `json:"contributor"`
	Pubkey       string    `json:"pubkey,omitempty"`
	Pillar       Pillar    `json:"pillar"`
	Summary      string    `json:"summary"`
	Impact       Impact    `json:"impact"`
	Rationale    string    `json:"rationale"`
	Channel      string    `json:"channel"`
	UnitID       string    `json:"unit_id"`
	UnitKind     string    `json:"unit_kind"`
	MessageIDs   []string  `json:"message_ids"`
	At           time.Time `json:"at"`
	Quote        string    `json:"quote"`
	Endorsements int       `json:"endorsements"` // reactions from other people on the cited messages
}

// Validate keeps findings that name a real participant, a known pillar and
// impact, and at least one message the contributor actually wrote. It
// returns the kept evidence and a reason for each dropped finding.
func Validate(u *Unit, findings []Finding) ([]Evidence, []string) {
	participants := map[string]bool{}
	for _, m := range u.Messages {
		if !m.Excluded {
			participants[m.Author] = true
		}
	}
	byRef := map[string]Message{}
	for i, m := range u.Messages {
		byRef[Ref(i)] = m
	}

	var kept []Evidence
	var dropped []string
	for _, f := range findings {
		switch {
		case !participants[f.Contributor]:
			dropped = append(dropped, fmt.Sprintf("unknown contributor %q", f.Contributor))
			continue
		case !ValidPillar(f.Pillar):
			dropped = append(dropped, fmt.Sprintf("unknown KPI item %q", f.Pillar))
			continue
		case u.Levels != nil && itemLevel(f.Pillar) != u.Levels[f.Contributor]:
			dropped = append(dropped, fmt.Sprintf("%s: %q is not a KPI item of their level", f.Contributor, f.Pillar))
			continue
		case f.Impact != ImpactLow && f.Impact != ImpactMedium && f.Impact != ImpactHigh:
			dropped = append(dropped, fmt.Sprintf("unknown impact %q", f.Impact))
			continue
		case strings.TrimSpace(f.Summary) == "":
			dropped = append(dropped, "empty summary")
			continue
		}

		// Cite only the contributor's own messages: credit goes to whoever wrote them.
		var cited []Message
		seen := map[string]bool{}
		for _, ref := range f.EvidenceRefs {
			m, ok := byRef[ref]
			if ok && !m.Excluded && m.Author == f.Contributor && !seen[m.ID] {
				seen[m.ID] = true
				cited = append(cited, m)
			}
		}
		if len(cited) == 0 {
			dropped = append(dropped, fmt.Sprintf("%s: no cited message written by them", f.Contributor))
			continue
		}

		ev := Evidence{
			Contributor: f.Contributor,
			Pubkey:      cited[0].AuthorKey,
			Pillar:      f.Pillar,
			Summary:     strings.TrimSpace(f.Summary),
			Impact:      f.Impact,
			Rationale:   strings.TrimSpace(f.Rationale),
			Channel:     u.Channel,
			UnitID:      u.ID,
			UnitKind:    u.Kind,
			At:          cited[0].At,
			Quote:       truncate(cited[0].Text, 220),
		}
		for _, m := range cited {
			ev.MessageIDs = append(ev.MessageIDs, m.ID)
			for _, people := range m.Reactions {
				for _, who := range people {
					if who != f.Contributor {
						ev.Endorsements++
					}
				}
			}
		}
		kept = append(kept, ev)
	}
	return kept, dropped
}

func truncate(s string, n int) string {
	r := []rune(strings.TrimSpace(s))
	if len(r) <= n {
		return string(r)
	}
	return strings.TrimSpace(string(r[:n])) + "…"
}

func itemLevel(id Pillar) string {
	info, _ := ItemInfo(id)
	return info.Level
}
