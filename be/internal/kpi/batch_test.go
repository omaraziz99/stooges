package kpi

import (
	"context"
	"io"
	"net/http"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// countingEvaluator records how many requests and conversations it saw.
type countingEvaluator struct {
	requests, units atomic.Int32
	quotaAfter      int32 // fail with a quota error from this request on (0 = never)
}

func (c *countingEvaluator) EvaluateBatch(_ context.Context, units []*Unit) ([][]Finding, error) {
	n := c.requests.Add(1)
	if c.quotaAfter > 0 && n >= c.quotaAfter {
		return nil, &QuotaError{RetryAfter: time.Hour}
	}
	c.units.Add(int32(len(units)))
	out := make([][]Finding, len(units))
	for i, u := range units {
		m := u.Messages[0]
		out[i] = []Finding{{Contributor: m.Author, Pillar: KnowledgeSharing, Summary: "s", Impact: ImpactLow, EvidenceRefs: []string{"m1"}}}
	}
	return out, nil
}

func manyUnits(n int) []Unit {
	units := make([]Unit, n)
	for i := range units {
		id := string(rune('a' + i))
		units[i] = Unit{ID: id, Kind: "conversation", Channel: "proj", Messages: []Message{msg(id, "Alice", i, "message "+id)}}
	}
	return units
}

func TestEvaluateBatchesAndCaches(t *testing.T) {
	units := manyUnits(10)
	cachePath := filepath.Join(t.TempDir(), "cache.json")
	cache, _ := OpenCache(cachePath)

	ev := &countingEvaluator{}
	res := Evaluate(context.Background(), ev, units, EvalOptions{Model: "m", Cache: cache, BatchSize: 4, Parallel: 2})
	if ev.requests.Load() != 3 || res.Requests != 3 || res.Sent != 10 || !res.Completed || len(res.Evidence) != 10 {
		t.Fatalf("10 conversations in batches of 4 = 3 requests; got %d requests, res %+v", ev.requests.Load(), res)
	}
	if err := cache.Save(); err != nil {
		t.Fatal(err)
	}

	// A second run, from the saved file, sends nothing.
	cache2, err := OpenCache(cachePath)
	if err != nil {
		t.Fatal(err)
	}
	ev2 := &countingEvaluator{}
	res2 := Evaluate(context.Background(), ev2, units, EvalOptions{Model: "m", Cache: cache2, BatchSize: 4})
	if ev2.requests.Load() != 0 || res2.Cached != 10 || len(res2.Evidence) != 10 {
		t.Fatalf("second run should be fully cached; got %d requests, res %+v", ev2.requests.Load(), res2)
	}

	// A changed conversation, or a different model, is sent again.
	units[0].Messages[0].Text = "edited"
	ev3 := &countingEvaluator{}
	Evaluate(context.Background(), ev3, units, EvalOptions{Model: "m", Cache: cache2, BatchSize: 4})
	if ev3.units.Load() != 1 {
		t.Errorf("only the edited conversation should be re-sent, got %d", ev3.units.Load())
	}
	ev4 := &countingEvaluator{}
	Evaluate(context.Background(), ev4, units, EvalOptions{Model: "other-model", Cache: cache2, BatchSize: 4})
	if ev4.units.Load() != 10 {
		t.Errorf("a different model should not reuse results, re-sent %d", ev4.units.Load())
	}
}

func TestEvaluateStopsOnQuotaAndResumes(t *testing.T) {
	units := manyUnits(12)
	cache, _ := OpenCache("")

	// Quota runs out on the 2nd request; parallel 1 so the order is fixed.
	ev := &countingEvaluator{quotaAfter: 2}
	res := Evaluate(context.Background(), ev, units, EvalOptions{Model: "m", Cache: cache, BatchSize: 4, Parallel: 1})
	if res.Quota == nil || res.Completed {
		t.Fatalf("run should stop on quota, got %+v", res)
	}
	if ev.requests.Load() != 2 {
		t.Errorf("no requests should be sent after the quota error, got %d", ev.requests.Load())
	}
	if len(res.Evidence) != 4 || len(res.Skipped) != 8 || !strings.Contains(res.Skipped[0], "not reviewed yet") {
		t.Errorf("first batch kept, rest marked as pending; got %d evidence, skipped %v", len(res.Evidence), res.Skipped)
	}

	// Next run: only the 8 missing conversations are sent.
	ev2 := &countingEvaluator{}
	res2 := Evaluate(context.Background(), ev2, units, EvalOptions{Model: "m", Cache: cache, BatchSize: 4, Parallel: 1})
	if !res2.Completed || res2.Cached != 4 || ev2.units.Load() != 8 || len(res2.Evidence) != 12 {
		t.Fatalf("resume should send only the 8 missing conversations, got %+v (sent %d)", res2, ev2.units.Load())
	}
}

func TestSplitByConversation(t *testing.T) {
	u := []*Unit{{ID: "a"}, {ID: "b"}}
	got := splitByConversation(u, []Finding{
		{Conversation: "c2", Contributor: "x"},
		{Conversation: "[c1]", Contributor: "y"},
		{Conversation: "c9", Contributor: "lost"},
		{Conversation: "", Contributor: "ambiguous"}, // two units: can't guess
	})
	if len(got[0]) != 1 || got[0][0].Contributor != "y" || len(got[1]) != 1 || got[1][0].Contributor != "x" {
		t.Fatalf("got %+v", got)
	}
}

func TestGeminiQuotaHandling(t *testing.T) {
	t.Run("daily quota stops immediately", func(t *testing.T) {
		var calls atomic.Int32
		g := fakeGemini(t, func(w http.ResponseWriter, r *http.Request) {
			calls.Add(1)
			w.WriteHeader(http.StatusTooManyRequests)
			io.WriteString(w, `{"error":{"code":429,"status":"RESOURCE_EXHAUSTED","message":"Quota exceeded. Please retry in 1h25m21.2s.","details":[{"@type":"type.googleapis.com/google.rpc.RetryInfo","retryDelay":"5121s"}]}}`)
		})
		_, err := g.EvaluateBatch(context.Background(), []*Unit{{Messages: []Message{msg("1", "A", 0, "x")}}})
		var qe *QuotaError
		if !asQuota(err, &qe) || qe.RetryAfter != 5121*time.Second {
			t.Fatalf("want QuotaError with retry delay, got %v", err)
		}
		if calls.Load() != 1 {
			t.Errorf("a daily quota must not be retried, got %d calls", calls.Load())
		}
	})

	t.Run("short rate limit waits and retries", func(t *testing.T) {
		var calls atomic.Int32
		g := fakeGemini(t, func(w http.ResponseWriter, r *http.Request) {
			if calls.Add(1) == 1 {
				w.WriteHeader(http.StatusTooManyRequests)
				io.WriteString(w, `{"error":{"code":429,"status":"RESOURCE_EXHAUSTED","message":"Please retry in 0.01s."}}`)
				return
			}
			io.WriteString(w, answer(`{"contributions":[]}`))
		})
		if _, err := g.EvaluateBatch(context.Background(), []*Unit{{Messages: []Message{msg("1", "A", 0, "x")}}}); err != nil {
			t.Fatalf("should recover after a short wait, got %v", err)
		}
	})
}

func asQuota(err error, target **QuotaError) bool {
	qe, ok := err.(*QuotaError)
	if ok {
		*target = qe
	}
	return ok
}
