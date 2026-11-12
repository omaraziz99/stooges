package kpi

import (
	"encoding/json"
	"fmt"
	"slices"
	"sort"
	"strings"
	"time"

	"github.com/btcsuite/btcd/btcec/v2"

	"stooges/be/internal/client"
	"stooges/be/internal/nostr"
)

// Shown to the model in place of a person who has not opted in.
const (
	excludedName = "A teammate (not opted in)"
	excludedText = "[not shown: this person has not opted in to KPI insights]"
)

// LoadChannel reads a channel's history from the relay and returns it as
// evaluation units. Reading needs no login. Deleted messages and reactions
// are honoured, and authors are shown by their display names.
//
// It refuses a channel its creator has not marked for KPI review, and reads
// only people who opted in: everyone else's messages become placeholders.
func LoadChannel(relayURL, channel string) ([]Unit, error) {
	c, err := client.Dial(relayURL)
	if err != nil {
		return nil, err
	}
	defer c.Close()

	meta, err := c.Query("channel", map[string]any{"kinds": []int{nostr.KindGroupMetadata}, "#d": []string{channel}})
	if err != nil {
		return nil, err
	}
	if len(meta) == 0 {
		return nil, fmt.Errorf("no channel called #%s on this relay", channel)
	}
	if meta[0].TagValue("kpi") != "on" {
		return nil, fmt.Errorf("channel is not marked for KPI insights: its creator can turn that on from the channel header in the app")
	}
	consents, err := c.Query("consent", map[string]any{
		"kinds": []int{nostr.KindAppData},
		"#d":    []string{nostr.KPIConsentTag},
		"limit": 1000,
	})
	if err != nil {
		return nil, err
	}
	chat, err := c.Query("chat", map[string]any{
		"kinds": []int{nostr.KindChatMessage, nostr.KindReaction, nostr.KindDeletion},
		"#h":    []string{channel},
		"limit": 1000,
	})
	if err != nil {
		return nil, err
	}
	profiles, err := c.Query("profiles", map[string]any{"kinds": []int{nostr.KindProfile}, "limit": 1000})
	if err != nil {
		return nil, err
	}
	return unitsFromEvents(channel, chat, profiles, consents), nil
}

// ReviewableChannels lists the channels marked for KPI review, the only ones
// the agent may read, in alphabetical order.
func ReviewableChannels(relayURL string) ([]string, error) {
	c, err := client.Dial(relayURL)
	if err != nil {
		return nil, err
	}
	defer c.Close()
	meta, err := c.Query("channels", map[string]any{"kinds": []int{nostr.KindGroupMetadata}, "limit": 1000})
	if err != nil {
		return nil, err
	}
	var out []string
	for _, m := range meta {
		if m.TagValue("kpi") == "on" {
			out = append(out, m.TagValue("d"))
		}
	}
	sort.Strings(out)
	return out, nil
}

// PublishReport signs the reports with the agent's key and sends them to the
// relay, replacing the previous ones: the team report for managers, and one
// per person holding only their own part. A personal report left from an
// earlier run, for someone who has since opted out, is blanked.
func PublishReport(relayURL string, agentKey *btcec.PrivateKey, report Report) error {
	c, err := client.Dial(relayURL)
	if err != nil {
		return err
	}
	defer c.Close()
	if err := c.Login(agentKey); err != nil {
		return err
	}
	now := time.Now()
	publish := func(tag string, content any) error {
		data, err := json.Marshal(content)
		if err != nil {
			return err
		}
		_, ok, reason, err := c.Publish(nostr.KindAppData, now, string(data), nostr.Tag{"d", tag})
		if err == nil && !ok {
			err = fmt.Errorf("relay rejected the report: %s", reason)
		}
		return err
	}

	if err := publish(nostr.KPIReportTag, report); err != nil {
		return err
	}
	current := map[string]bool{}
	for _, p := range report.People {
		tag := nostr.KPIReportTag + ":" + p.Pubkey
		current[tag] = true
		if err := publish(tag, report.Personal(p)); err != nil {
			return fmt.Errorf("report for %s: %w", p.Name, err)
		}
	}

	earlier, err := c.Query("mine", map[string]any{
		"kinds":   []int{nostr.KindAppData},
		"authors": []string{nostr.PubKeyHex(agentKey)},
		"limit":   1000,
	})
	if err != nil {
		return err
	}
	for _, e := range earlier {
		tag := e.TagValue("d")
		if strings.HasPrefix(tag, nostr.KPIReportTag+":") && !current[tag] && e.Content != "{}" {
			if err := publish(tag, struct{}{}); err != nil {
				return err
			}
		}
	}
	return nil
}

// unitsFromEvents rebuilds threads, reactions, and names from raw events.
// consents holds each person's latest opt-in choice. People who have not
// opted in keep their place in a conversation, with name and text withheld.
func unitsFromEvents(channel string, chat, profiles, consents []nostr.Event) []Unit {
	consented := map[string]bool{}
	for _, e := range consents {
		var body struct {
			Consent bool `json:"consent"`
		}
		consented[e.PubKey] = json.Unmarshal([]byte(e.Content), &body) == nil && body.Consent
	}

	names := map[string]string{}
	nameAt := map[string]int64{}
	for _, p := range profiles {
		var meta struct {
			Name        string `json:"name"`
			DisplayName string `json:"display_name"`
		}
		if json.Unmarshal([]byte(p.Content), &meta) != nil || p.CreatedAt < nameAt[p.PubKey] {
			continue
		}
		name := meta.DisplayName
		if name == "" {
			name = meta.Name
		}
		if name != "" {
			names[p.PubKey] = name
			nameAt[p.PubKey] = p.CreatedAt
		}
	}
	nameOf := func(pubkey string) string {
		if n, ok := names[pubkey]; ok {
			return n
		}
		return "user-" + pubkey[:8]
	}

	// Two keys can carry the same display name. Where that happens in this
	// channel, each is shown with part of its key, so they stay distinct.
	taken := map[string]map[string]bool{}
	for i := range chat {
		if !consented[chat[i].PubKey] {
			continue
		}
		name := nameOf(chat[i].PubKey)
		if taken[name] == nil {
			taken[name] = map[string]bool{}
		}
		taken[name][chat[i].PubKey] = true
	}
	labelOf := func(pubkey string) string {
		name := nameOf(pubkey)
		if len(taken[name]) > 1 {
			return fmt.Sprintf("%s (%s)", name, pubkey[:6])
		}
		return name
	}
	deleted := map[string]bool{} // "eventID|pubkey" deleted by its own author
	for _, e := range chat {
		if e.Kind == nostr.KindDeletion {
			for _, id := range e.TagValues("e") {
				deleted[id+"|"+e.PubKey] = true
			}
		}
	}
	alive := func(e *nostr.Event) bool { return !deleted[e.ID+"|"+e.PubKey] }

	sort.SliceStable(chat, func(i, j int) bool { return chat[i].CreatedAt < chat[j].CreatedAt })

	reactions := map[string]map[string][]string{} // target -> emoji -> names
	for i := range chat {
		e := &chat[i]
		if e.Kind != nostr.KindReaction || !alive(e) || !consented[e.PubKey] {
			continue
		}
		target := e.TagValue("e")
		emoji := e.Content
		if emoji == "" || emoji == "+" {
			emoji = "👍"
		}
		if reactions[target] == nil {
			reactions[target] = map[string][]string{}
		}
		who := labelOf(e.PubKey)
		if !contains(reactions[target][emoji], who) {
			reactions[target][emoji] = append(reactions[target][emoji], who)
		}
	}

	var top []Message
	replies := map[string][]Message{}
	for i := range chat {
		e := &chat[i]
		if e.Kind != nostr.KindChatMessage || !alive(e) {
			continue
		}
		m := Message{ID: e.ID, Author: labelOf(e.PubKey), AuthorKey: e.PubKey, At: time.Unix(e.CreatedAt, 0), Text: e.Content, Reactions: reactions[e.ID]}
		if !consented[e.PubKey] {
			m = Message{ID: e.ID, Author: excludedName, At: m.At, Text: excludedText, Excluded: true}
		}
		if root := rootOf(e); root != "" {
			replies[root] = append(replies[root], m)
		} else {
			top = append(top, m)
		}
	}
	// A conversation with nobody opted in has nothing to review.
	return slices.DeleteFunc(BuildUnits(channel, top, replies), func(u Unit) bool {
		return !slices.ContainsFunc(u.Messages, func(m Message) bool { return !m.Excluded })
	})
}

func rootOf(e *nostr.Event) string {
	for _, t := range e.Tags {
		if len(t) >= 4 && t[0] == "e" && t[3] == "root" {
			return t[1]
		}
	}
	return ""
}

func contains(list []string, s string) bool {
	for _, v := range list {
		if v == s {
			return true
		}
	}
	return false
}
