package nostr

import (
	"encoding/json"
	"fmt"
	"slices"
)

// Filter selects events, as sent by clients in REQ messages (NIP-01).
// Tag filters such as {"#h": ["general"]} are collected into Tags, keyed by
// the tag letter without the "#".
type Filter struct {
	IDs     []string
	Authors []string
	Kinds   []int
	Tags    map[string][]string
	Since   *int64
	Until   *int64
	Limit   int
}

// UnmarshalJSON parses a filter, including the dynamic "#x" tag keys.
func (f *Filter) UnmarshalJSON(data []byte) error {
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	for key, val := range raw {
		var err error
		switch key {
		case "ids":
			err = json.Unmarshal(val, &f.IDs)
		case "authors":
			err = json.Unmarshal(val, &f.Authors)
		case "kinds":
			err = json.Unmarshal(val, &f.Kinds)
		case "since":
			err = json.Unmarshal(val, &f.Since)
		case "until":
			err = json.Unmarshal(val, &f.Until)
		case "limit":
			err = json.Unmarshal(val, &f.Limit)
		default:
			if len(key) == 2 && key[0] == '#' {
				var vals []string
				if err = json.Unmarshal(val, &vals); err == nil {
					if f.Tags == nil {
						f.Tags = map[string][]string{}
					}
					f.Tags[key[1:]] = vals
				}
			}
			// Unknown keys (e.g. "search") are ignored.
		}
		if err != nil {
			return fmt.Errorf("filter field %q: %w", key, err)
		}
	}
	return nil
}

// Matches reports whether the event satisfies every condition in the filter.
func (f *Filter) Matches(e *Event) bool {
	if len(f.IDs) > 0 && !slices.Contains(f.IDs, e.ID) {
		return false
	}
	if len(f.Authors) > 0 && !slices.Contains(f.Authors, e.PubKey) {
		return false
	}
	if len(f.Kinds) > 0 && !slices.Contains(f.Kinds, e.Kind) {
		return false
	}
	if f.Since != nil && e.CreatedAt < *f.Since {
		return false
	}
	if f.Until != nil && e.CreatedAt > *f.Until {
		return false
	}
	for name, want := range f.Tags {
		found := false
		for _, v := range e.TagValues(name) {
			if slices.Contains(want, v) {
				found = true
				break
			}
		}
		if !found {
			return false
		}
	}
	return true
}
