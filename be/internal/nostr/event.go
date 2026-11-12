// Package nostr implements the parts of the Nostr protocol (NIP-01) the relay
// needs: event serialization, ID hashing, Schnorr signatures, and filters.
package nostr

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"strconv"
	"strings"

	"github.com/btcsuite/btcd/btcec/v2"
	"github.com/btcsuite/btcd/btcec/v2/schnorr"
)

// Event kinds used by the platform.
const (
	KindProfile       = 0     // user metadata (display name)
	KindDeletion      = 5     // NIP-09 delete own events
	KindReaction      = 7     // NIP-25 emoji reaction
	KindChatMessage   = 9     // NIP-29 group chat message
	KindEditGroup     = 9002  // NIP-29 edit group metadata; turns KPI review on or off
	KindCreateGroup   = 9007  // NIP-29 create group (channel)
	KindDeleteGroup   = 9008  // NIP-29 delete group (channel); creator only
	KindAuth          = 22242 // NIP-42 client authentication
	KindAppData       = 30078 // NIP-78 app data; the KPI report and each person's opt-in
	KindCalendarEvent = 31923 // NIP-52 time-based calendar event: a manager's performance review booking
	KindGroupMetadata = 39000 // NIP-29 group metadata, signed by the relay
)

// d tags of the kind 30078 events behind KPI insights.
const (
	KPIReportTag  = "kpi-report"  // the team report; one person's own is "kpi-report:<pubkey>"
	KPIConsentTag = "kpi-consent" // a person's opt-in, signed by them: {"consent": true|false}
)

// Tag is a single event tag, e.g. ["h", "general"].
type Tag []string

// Event is a signed Nostr event.
type Event struct {
	ID        string `json:"id"`
	PubKey    string `json:"pubkey"`
	CreatedAt int64  `json:"created_at"`
	Kind      int    `json:"kind"`
	Tags      []Tag  `json:"tags"`
	Content   string `json:"content"`
	Sig       string `json:"sig"`
}

// TagValue returns the first value of the first tag with the given name.
func (e *Event) TagValue(name string) string {
	for _, t := range e.Tags {
		if len(t) >= 2 && t[0] == name {
			return t[1]
		}
	}
	return ""
}

// TagValues returns the first value of every tag with the given name.
func (e *Event) TagValues(name string) []string {
	var out []string
	for _, t := range e.Tags {
		if len(t) >= 2 && t[0] == name {
			out = append(out, t[1])
		}
	}
	return out
}

// Serialize returns the canonical NIP-01 form used to compute the event ID:
// [0, pubkey, created_at, kind, tags, content], with strings escaped exactly as
// JavaScript's JSON.stringify does, so IDs match what JS clients compute.
func (e *Event) Serialize() []byte {
	var b bytes.Buffer
	b.WriteString(`[0,`)
	writeString(&b, e.PubKey)
	b.WriteByte(',')
	b.WriteString(strconv.FormatInt(e.CreatedAt, 10))
	b.WriteByte(',')
	b.WriteString(strconv.Itoa(e.Kind))
	b.WriteString(`,[`)
	for i, t := range e.Tags {
		if i > 0 {
			b.WriteByte(',')
		}
		b.WriteByte('[')
		for j, v := range t {
			if j > 0 {
				b.WriteByte(',')
			}
			writeString(&b, v)
		}
		b.WriteByte(']')
	}
	b.WriteString(`],`)
	writeString(&b, e.Content)
	b.WriteByte(']')
	return b.Bytes()
}

func writeString(b *bytes.Buffer, s string) {
	b.WriteByte('"')
	for _, r := range s {
		switch r {
		case '"':
			b.WriteString(`\"`)
		case '\\':
			b.WriteString(`\\`)
		case '\n':
			b.WriteString(`\n`)
		case '\r':
			b.WriteString(`\r`)
		case '\t':
			b.WriteString(`\t`)
		case '\b':
			b.WriteString(`\b`)
		case '\f':
			b.WriteString(`\f`)
		default:
			if r < 0x20 {
				fmt.Fprintf(b, `\u%04x`, r)
			} else {
				b.WriteRune(r)
			}
		}
	}
	b.WriteByte('"')
}

// ComputeID returns the lowercase hex SHA-256 of the serialized event.
func (e *Event) ComputeID() string {
	sum := sha256.Sum256(e.Serialize())
	return hex.EncodeToString(sum[:])
}

// Verify checks that the ID matches the content and the signature is valid.
func (e *Event) Verify() error {
	if e.ID != e.ComputeID() {
		return errors.New("id does not match event hash")
	}
	if len(e.PubKey) != 64 || strings.ToLower(e.PubKey) != e.PubKey {
		return errors.New("pubkey must be 64 lowercase hex characters")
	}
	pkBytes, err := hex.DecodeString(e.PubKey)
	if err != nil {
		return errors.New("pubkey is not valid hex")
	}
	pub, err := schnorr.ParsePubKey(pkBytes)
	if err != nil {
		return errors.New("pubkey is not a valid point")
	}
	sigBytes, err := hex.DecodeString(e.Sig)
	if err != nil || len(sigBytes) != 64 {
		return errors.New("sig must be 128 hex characters")
	}
	sig, err := schnorr.ParseSignature(sigBytes)
	if err != nil {
		return errors.New("sig is malformed")
	}
	idBytes, _ := hex.DecodeString(e.ID)
	if !sig.Verify(idBytes, pub) {
		return errors.New("signature verification failed")
	}
	return nil
}

// Sign sets the pubkey, ID, and signature using the given private key.
func (e *Event) Sign(priv *btcec.PrivateKey) error {
	if e.Tags == nil {
		e.Tags = []Tag{}
	}
	e.PubKey = hex.EncodeToString(schnorr.SerializePubKey(priv.PubKey()))
	e.ID = e.ComputeID()
	idBytes, _ := hex.DecodeString(e.ID)
	sig, err := schnorr.Sign(priv, idBytes)
	if err != nil {
		return err
	}
	e.Sig = hex.EncodeToString(sig.Serialize())
	return nil
}

// PubKeyHex returns the x-only public key of priv as lowercase hex.
func PubKeyHex(priv *btcec.PrivateKey) string {
	return hex.EncodeToString(schnorr.SerializePubKey(priv.PubKey()))
}

// IsReplaceable reports whether only the latest event per (pubkey, kind) is kept.
func IsReplaceable(kind int) bool {
	return kind == 0 || kind == 3 || (kind >= 10000 && kind < 20000)
}

// IsAddressable reports whether only the latest event per (pubkey, kind, d tag) is kept.
func IsAddressable(kind int) bool {
	return kind >= 30000 && kind < 40000
}
