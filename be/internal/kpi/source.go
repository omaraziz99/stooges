package kpi

import (
	"encoding/json"
	"fmt"
	"sort"
	"time"

	"github.com/btcsuite/btcd/btcec/v2"

	"stooges/be/internal/client"
	"stooges/be/internal/nostr"
)

// ReportTag is the d tag of the KPI report event (kind 30078, NIP-78 app
// data). The relay only accepts it from the configured agent key, and the
// dashboard reads the latest one.
const ReportTag = "kpi-report"

// LoadChannel reads a channel's history from the relay and returns it as
// evaluation units. Reading needs no login. Deleted messages and reactions
// are honoured, and authors are shown by their display names.
func LoadChannel(relayURL, channel string) ([]Unit, error) {
	c, err := client.Dial(relayURL)
	if err != nil {
		return nil, err
	}
	defer c.Close()

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
	return unitsFromEvents(channel, chat, profiles), nil
}

// PublishReport signs the report with the agent's key and sends it to the
// relay, replacing the previous one.
func PublishReport(relayURL string, agentKey *btcec.PrivateKey, report []byte) error {
	c, err := client.Dial(relayURL)
	if err != nil {
		return err
	}
	defer c.Close()
	if err := c.Login(agentKey); err != nil {
		return err
	}
	_, ok, reason, err := c.Publish(nostr.KindAppData, time.Now(), string(report), nostr.Tag{"d", ReportTag})
	if err != nil {
		return err
	}
	if !ok {
		return fmt.Errorf("relay rejected the report: %s", reason)
	}
	return nil
}

// unitsFromEvents rebuilds threads, reactions, and names from raw events.
func unitsFromEvents(channel string, chat, profiles []nostr.Event) []Unit {
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
		if e.Kind != nostr.KindReaction || !alive(e) {
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
		who := nameOf(e.PubKey)
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
		m := Message{ID: e.ID, Author: nameOf(e.PubKey), At: time.Unix(e.CreatedAt, 0), Text: e.Content, Reactions: reactions[e.ID]}
		if root := rootOf(e); root != "" {
			replies[root] = append(replies[root], m)
		} else {
			top = append(top, m)
		}
	}
	return BuildUnits(channel, top, replies)
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
