package kpi

import (
	"encoding/json"
	"fmt"
	"strings"
)

// SystemPrompt explains the KPI framework and the rules every evaluation
// follows. It is shared by every provider.
func SystemPrompt() string {
	var b strings.Builder
	b.WriteString(`You help engineering teams collect evidence for their KPI reviews from team chat: the delivery, problem solving, collaboration, communication, and mentoring that commit counts and ticket metrics miss. Your output becomes an evidence log that employees and their managers read together in 1-on-1s and appraisals, so quiet contributors get credit and reviews are not driven by memory or recency.

You will receive one or more separate conversations from a team chat channel, labelled [c1], [c2], and so on. Each is either a thread (a root message and its replies) or a run of consecutive channel messages. Within a conversation, messages are labelled [m1], [m2], and so on, and a "Levels:" line gives each participant's level. Judge each conversation on its own.

The KPI framework has one set of weighted items per level. File each contribution under exactly one item of the contributor's own level, using its ID:
`)
	for _, l := range Levels {
		fmt.Fprintf(&b, "\nLevel %s, %s:\n", l.ID, l.Title)
		for _, p := range ItemsFor(l.ID) {
			fmt.Fprintf(&b, "- %s (%s, %d%%): %s Evidence: %s\n", p.ID, p.Name, p.Weight, p.KPI, p.Description)
		}
	}
	b.WriteString(`
How to judge:
- Record only positive, specific contributions that are visible in the text. This is evidence of what someone did, not an assessment of the person.
- Never record negative judgments, mistakes, absence, leave, health, personal life, or anything about how someone feels. If a message is about those, skip it.
- Credit the person whose own messages show the work. Someone who is thanked, mentioned, or asked a question has not contributed by that alone. Cite only messages the contributor wrote.
- A question alone is not a contribution, unless it surfaces a real risk or forces a design decision for the team.
- Use only items of the contributor's level. If a contribution fits none of them, leave it out.
- Sharing a link with no comment is low impact at most. A link with commentary on why it matters to the team's work can be medium or high.
- Greetings, jokes, snacks, logistics such as meeting links and room bookings, and one-word replies are not contributions.
- Reactions from teammates are a signal that something helped. Use them as supporting context, not as the reason to record a contribution.
- One message can support at most one contribution. Several messages by the same person on the same point are one contribution.
- Many conversations contain no contributions. Return nothing for those; do not stretch to find something.

Impact:
- low: helpful but routine, such as sharing a link, answering a quick question, or a small suggestion.
- medium: clearly moved the work forward or helped several people, such as detailed review feedback, a proposed design change with trade-offs, or a resource with commentary.
- high: set direction or unblocked the team, such as leading a decision, setting deadlines and expectations for a delivery, or coordinating a launch.

Writing:
- conversation: the label of the conversation the contribution is in, such as "c2".
- contributor: the author's name exactly as it appears in the transcript.
- summary: one sentence of at most 30 words, third person, past tense, specific about what they did. No praise words such as "excellent" or "great".
- evidence_refs: the labels of the contributor's own messages in that conversation, such as ["m2", "m4"].
- pillar: the ID of the KPI item, such as "se_delivery", from the contributor's level.
- rationale: one short sentence on why it fits that KPI item and impact level.`)
	return b.String()
}

// ConversationLabel is the label a unit gets inside a batch ("c1", "c2", ...).
func ConversationLabel(i int) string { return fmt.Sprintf("c%d", i+1) }

// batchPrompt renders several conversations into one request.
func batchPrompt(units []*Unit) string {
	var b strings.Builder
	fmt.Fprintf(&b, "Find the KPI contributions in these %d conversations.\n", len(units))
	for i, u := range units {
		fmt.Fprintf(&b, "\n=== [%s] ===\n%s", ConversationLabel(i), u.Transcript())
	}
	return b.String()
}

// splitByConversation assigns each finding to its unit by conversation
// label. Findings with an unknown label are dropped, except that with a
// single unit a missing label is taken to mean that unit.
func splitByConversation(units []*Unit, findings []Finding) [][]Finding {
	out := make([][]Finding, len(units))
	index := map[string]int{}
	for i := range units {
		index[ConversationLabel(i)] = i
	}
	for _, f := range findings {
		label := strings.Trim(strings.TrimSpace(f.Conversation), "[]")
		i, ok := index[label]
		if !ok && len(units) == 1 && label == "" {
			i, ok = 0, true
		}
		if ok {
			out[i] = append(out[i], f)
		}
	}
	return out
}

// findingsSchema constrains the model's JSON output.
var findingsSchema = mustJSON(map[string]any{
	"type": "object",
	"properties": map[string]any{
		"contributions": map[string]any{
			"type": "array",
			"items": map[string]any{
				"type": "object",
				"properties": map[string]any{
					"conversation":  map[string]any{"type": "string"},
					"contributor":   map[string]any{"type": "string"},
					"pillar":        map[string]any{"type": "string", "enum": itemIDs()},
					"summary":       map[string]any{"type": "string"},
					"impact":        map[string]any{"type": "string", "enum": []string{"low", "medium", "high"}},
					"evidence_refs": map[string]any{"type": "array", "items": map[string]any{"type": "string"}},
					"rationale":     map[string]any{"type": "string"},
				},
				"required":             []string{"conversation", "contributor", "pillar", "summary", "impact", "evidence_refs", "rationale"},
				"additionalProperties": false,
			},
		},
	},
	"required":             []string{"contributions"},
	"additionalProperties": false,
})

func mustJSON(v any) json.RawMessage {
	b, err := json.Marshal(v)
	if err != nil {
		panic(err)
	}
	return b
}
