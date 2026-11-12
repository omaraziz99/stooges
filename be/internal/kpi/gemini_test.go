package kpi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

func fakeGemini(t *testing.T, handler http.HandlerFunc) *Gemini {
	t.Helper()
	srv := httptest.NewServer(handler)
	t.Cleanup(srv.Close)
	g := NewGemini("test-key", "test-model")
	g.Endpoint = srv.URL + "/%s"
	g.MaxRetries = 2
	return g
}

func answer(text string) string {
	b, _ := json.Marshal(map[string]any{"candidates": []any{map[string]any{
		"finishReason": "STOP",
		"content": map[string]any{"parts": []any{
			map[string]any{"text": "thinking...", "thought": true},
			map[string]any{"text": text},
		}},
	}}})
	return string(b)
}

func TestGeminiRequestAndParse(t *testing.T) {
	var gotKeyHeader, gotPath string
	var gotBody geminiRequest
	g := fakeGemini(t, func(w http.ResponseWriter, r *http.Request) {
		gotKeyHeader = r.Header.Get("x-goog-api-key")
		gotPath = r.URL.String()
		raw, _ := io.ReadAll(r.Body)
		json.Unmarshal(raw, &gotBody)
		io.WriteString(w, answer(`{"contributions":[{"contributor":"Alice","pillar":"se_accountability","summary":"s","impact":"high","evidence_refs":["m1"],"rationale":"r"}]}`))
	})

	u := &Unit{ID: "u", Kind: "thread", Channel: "proj", Messages: []Message{msg("1", "Alice", 0, "Release is on Friday")}}
	got, err := g.EvaluateBatch(context.Background(), []*Unit{u})
	if err != nil {
		t.Fatal(err)
	}
	// The fake answer omits "conversation": with one unit it is assumed.
	findings := got[0]
	if len(findings) != 1 || findings[0].Contributor != "Alice" {
		t.Fatalf("thought parts must be skipped and the answer parsed, got %+v", findings)
	}
	if gotKeyHeader != "test-key" || strings.Contains(gotPath, "test-key") {
		t.Errorf("key must go in the header, not the URL (path %q)", gotPath)
	}
	if gotPath != "/test-model" {
		t.Errorf("model should be in the path, got %q", gotPath)
	}
	if gotBody.GenerationConfig.ResponseMimeType != "application/json" || !strings.Contains(string(gotBody.GenerationConfig.ResponseJSONSchema), "contributions") {
		t.Errorf("request should ask for JSON matching the findings schema")
	}
	if !strings.Contains(gotBody.SystemInstruction.Parts[0].Text, "KPI framework") {
		t.Errorf("system prompt should be sent as systemInstruction")
	}
}

func TestGeminiRetriesRateLimits(t *testing.T) {
	var calls atomic.Int32
	g := fakeGemini(t, func(w http.ResponseWriter, r *http.Request) {
		if calls.Add(1) == 1 {
			w.WriteHeader(http.StatusTooManyRequests)
			io.WriteString(w, `{"error":{"code":429,"message":"slow down","status":"RESOURCE_EXHAUSTED"}}`)
			return
		}
		io.WriteString(w, answer(`{"headline":"h","summary":"s","highlights":[],"discussion_points":[]}`))
	})
	rv, err := g.Review(context.Background(), &Person{Name: "Alice", Evidence: []Evidence{{}}}, t0, t0)
	if err != nil || rv.Summary != "s" {
		t.Fatalf("should succeed after one 429, got %v %+v", err, rv)
	}
	if calls.Load() != 2 {
		t.Errorf("want 2 calls, got %d", calls.Load())
	}
}

func TestGeminiErrors(t *testing.T) {
	cases := map[string]struct {
		status   int
		body     string
		refused  bool
		contains string
	}{
		"bad key":       {400, `{"error":{"code":400,"message":"API key not valid","status":"INVALID_ARGUMENT"}}`, false, "API key not valid"},
		"blocked input": {200, `{"promptFeedback":{"blockReason":"SAFETY"}}`, true, "SAFETY"},
		"safety stop":   {200, `{"candidates":[{"finishReason":"SAFETY","content":{"parts":[]}}]}`, true, "SAFETY"},
		"cut off":       {200, `{"candidates":[{"finishReason":"MAX_TOKENS","content":{"parts":[{"text":"{"}]}}]}`, false, "cut off"},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			g := fakeGemini(t, func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(tc.status)
				io.WriteString(w, tc.body)
			})
			_, err := g.EvaluateBatch(context.Background(), []*Unit{{Messages: []Message{msg("1", "A", 0, "x")}}})
			if err == nil || !strings.Contains(err.Error(), tc.contains) || errors.Is(err, ErrRefused) != tc.refused {
				t.Fatalf("got %v", err)
			}
		})
	}
}
