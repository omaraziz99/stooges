package kpi

import (
	"encoding/json"
	"fmt"
	"strings"
)

// SystemPrompt explains the rubric and the rules every evaluation follows.
// It is shared by every provider.
func SystemPrompt() string {
	var b strings.Builder
	b.WriteString(`You help engineering teams recognise "glue work": the leadership, knowledge sharing, industry awareness, and ownership that happens in team chat and that commit counts and ticket metrics miss. Your output becomes an evidence log that employees and their managers read together in 1-on-1s and appraisals, so quiet contributors get credit and reviews are not driven by memory or recency.

You will receive one or more separate conversations from a team chat channel, labelled [c1], [c2], and so on. Each is either a thread (a root message and its replies) or a run of consecutive channel messages. Within a conversation, messages are labelled [m1], [m2], and so on. Judge each conversation on its own. Return every clear contribution that fits one of these KPI pillars:

`)
	for _, p := range Pillars {
		fmt.Fprintf(&b, "- %s (%s): %s\n", p.ID, p.Name, p.Description)
	}
	b.WriteString(`
How to judge:
- Record only positive, specific contributions that are visible in the text. This is evidence of what someone did, not an assessment of the person.
- Never record negative judgments, mistakes, absence, leave, health, personal life, or anything about how someone feels. If a message is about those, skip it.
- Credit the person whose own messages show the work. Someone who is thanked, mentioned, or asked a question has not contributed by that alone. Cite only messages the contributor wrote.
- A question alone is not a contribution, unless it surfaces a real risk or forces a design decision for the team.
- Sharing a link with no comment is industry_intelligence at low impact at most. A link with commentary on why it matters to the team's work can be medium or high.
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
- rationale: one short sentence on why it fits the pillar and impact level.`)
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
var findingsSchema = json.RawMessage(`{
  "type": "object",
  "properties": {
    "contributions": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "conversation":  {"type": "string"},
          "contributor":   {"type": "string"},
          "pillar":        {"type": "string", "enum": ["technical_leadership", "knowledge_sharing", "industry_intelligence", "ownership_initiative"]},
          "summary":       {"type": "string"},
          "impact":        {"type": "string", "enum": ["low", "medium", "high"]},
          "evidence_refs": {"type": "array", "items": {"type": "string"}},
          "rationale":     {"type": "string"}
        },
        "required": ["conversation", "contributor", "pillar", "summary", "impact", "evidence_refs", "rationale"],
        "additionalProperties": false
      }
    }
  },
  "required": ["contributions"],
  "additionalProperties": false
}`)
