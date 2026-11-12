package kpi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"
)

// DefaultGeminiModel is used when GEMINI_MODEL is not set.
const DefaultGeminiModel = "gemini-3.5-flash"

const geminiEndpoint = "https://generativelanguage.googleapis.com/v1beta/models/%s:generateContent"

// maxQuotaWait is the longest rate-limit delay worth waiting out. Anything
// longer (such as a daily free-tier limit) stops the run instead.
const maxQuotaWait = 90 * time.Second

// Gemini evaluates conversations and writes reviews with Google's Gemini API.
// It uses the same prompts, schemas, and validation as the Claude version.
type Gemini struct {
	APIKey     string
	Model      string
	HTTP       *http.Client
	Endpoint   string // printf pattern with the model name; overridable in tests
	MaxRetries int
}

// NewGemini creates a client. The key is sent in a header, never in the URL.
func NewGemini(apiKey, model string) *Gemini {
	if model == "" {
		model = DefaultGeminiModel
	}
	return &Gemini{
		APIKey:     apiKey,
		Model:      model,
		HTTP:       &http.Client{Timeout: 3 * time.Minute},
		Endpoint:   geminiEndpoint,
		MaxRetries: 5,
	}
}

// ModelName implements Agent.
func (g *Gemini) ModelName() string { return g.Model }

// EvaluateBatch finds the KPI contributions in several conversations at once.
func (g *Gemini) EvaluateBatch(ctx context.Context, units []*Unit) ([][]Finding, error) {
	text, err := g.generate(ctx, SystemPrompt(), batchPrompt(units), findingsSchema)
	if err != nil {
		return nil, err
	}
	findings, err := parseFindings(text)
	if err != nil {
		return nil, err
	}
	return splitByConversation(units, findings), nil
}

// Review writes a manager-facing review from one person's evidence only.
func (g *Gemini) Review(ctx context.Context, p *Person, from, to time.Time) (*Review, error) {
	text, err := g.generate(ctx, ReviewSystemPrompt(), reviewUserPrompt(p, from, to), reviewSchema)
	if err != nil {
		return nil, err
	}
	return parseReview(text)
}

type geminiPart struct {
	Text    string `json:"text,omitempty"`
	Thought bool   `json:"thought,omitempty"`
}

type geminiContent struct {
	Role  string       `json:"role,omitempty"`
	Parts []geminiPart `json:"parts"`
}

type geminiRequest struct {
	SystemInstruction geminiContent   `json:"systemInstruction"`
	Contents          []geminiContent `json:"contents"`
	GenerationConfig  struct {
		ResponseMimeType   string          `json:"responseMimeType"`
		ResponseJSONSchema json.RawMessage `json:"responseJsonSchema"`
		MaxOutputTokens    int             `json:"maxOutputTokens"`
	} `json:"generationConfig"`
}

type geminiResponse struct {
	Candidates []struct {
		Content      geminiContent `json:"content"`
		FinishReason string        `json:"finishReason"`
	} `json:"candidates"`
	PromptFeedback struct {
		BlockReason string `json:"blockReason"`
	} `json:"promptFeedback"`
	Error *struct {
		Code    int    `json:"code"`
		Message string `json:"message"`
		Status  string `json:"status"`
		Details []struct {
			RetryDelay string `json:"retryDelay"` // e.g. "37s", from google.rpc.RetryInfo
		} `json:"details"`
	} `json:"error"`
}

var retryInRe = regexp.MustCompile(`retry in ([0-9hms.]+)`)

// retryDelay reads how long Google says to wait, from RetryInfo or the message.
func (r *geminiResponse) retryDelay() time.Duration {
	if r.Error == nil {
		return 0
	}
	for _, d := range r.Error.Details {
		if v, err := time.ParseDuration(d.RetryDelay); err == nil && v > 0 {
			return v
		}
	}
	if m := retryInRe.FindStringSubmatch(r.Error.Message); m != nil {
		if v, err := time.ParseDuration(m[1]); err == nil {
			return v
		}
	}
	return 0
}

// retryable is an error worth retrying, after Wait (0 means use backoff).
type retryable struct {
	err  error
	Wait time.Duration
}

func (r *retryable) Error() string { return r.err.Error() }
func (r *retryable) Unwrap() error { return r.err }

// generate sends one request and returns the JSON text matching schema.
// Short rate limits and server errors are retried; a long quota block is not.
func (g *Gemini) generate(ctx context.Context, system, user string, schema json.RawMessage) (string, error) {
	var req geminiRequest
	req.SystemInstruction = geminiContent{Parts: []geminiPart{{Text: system}}}
	req.Contents = []geminiContent{{Role: "user", Parts: []geminiPart{{Text: user}}}}
	req.GenerationConfig.ResponseMimeType = "application/json"
	req.GenerationConfig.ResponseJSONSchema = schema
	req.GenerationConfig.MaxOutputTokens = 32768
	body, err := json.Marshal(req)
	if err != nil {
		return "", err
	}

	backoff := 2 * time.Second
	for attempt := 0; ; attempt++ {
		text, err := g.call(ctx, body)
		var r *retryable
		if err == nil || !errors.As(err, &r) || attempt >= g.MaxRetries {
			if r != nil {
				return "", r.err
			}
			return text, err
		}
		wait := r.Wait
		if wait == 0 {
			wait = backoff
			backoff = min(backoff*2, 30*time.Second)
		}
		select {
		case <-ctx.Done():
			return "", ctx.Err()
		case <-time.After(wait):
		}
	}
}

// call makes one HTTP request. Retryable failures come back as *retryable.
func (g *Gemini) call(ctx context.Context, body []byte) (string, error) {
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, fmt.Sprintf(g.Endpoint, g.Model), bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("x-goog-api-key", g.APIKey)

	resp, err := g.HTTP.Do(httpReq)
	if err != nil {
		if ctx.Err() != nil {
			return "", ctx.Err()
		}
		return "", &retryable{err: fmt.Errorf("gemini request: %w", err)}
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", &retryable{err: fmt.Errorf("gemini response: %w", err)}
	}

	var out geminiResponse
	jsonErr := json.Unmarshal(raw, &out)

	if resp.StatusCode != http.StatusOK {
		msg := strings.TrimSpace(string(raw))
		if out.Error != nil {
			msg = fmt.Sprintf("%s: %s", out.Error.Status, firstLine(out.Error.Message))
		}
		err := fmt.Errorf("gemini HTTP %d: %s", resp.StatusCode, msg)
		switch {
		case resp.StatusCode == http.StatusTooManyRequests:
			wait := out.retryDelay()
			if wait > maxQuotaWait {
				return "", &QuotaError{RetryAfter: wait, Message: msg}
			}
			if wait > 0 {
				wait += time.Second
			}
			return "", &retryable{err: err, Wait: wait}
		case resp.StatusCode >= 500:
			return "", &retryable{err: err}
		default:
			return "", err
		}
	}
	if jsonErr != nil {
		return "", fmt.Errorf("parse gemini response: %w", jsonErr)
	}
	if out.PromptFeedback.BlockReason != "" {
		return "", fmt.Errorf("%w (%s)", ErrRefused, out.PromptFeedback.BlockReason)
	}
	if len(out.Candidates) == 0 {
		return "", &retryable{err: fmt.Errorf("gemini returned no candidates")}
	}
	c := out.Candidates[0]
	switch c.FinishReason {
	case "STOP", "":
	case "MAX_TOKENS":
		return "", fmt.Errorf("response was cut off at max output tokens")
	case "SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII", "RECITATION":
		return "", fmt.Errorf("%w (%s)", ErrRefused, c.FinishReason)
	default:
		return "", fmt.Errorf("gemini stopped early: %s", c.FinishReason)
	}

	var b strings.Builder
	for _, p := range c.Content.Parts {
		if !p.Thought { // skip thinking summaries, keep the answer
			b.WriteString(p.Text)
		}
	}
	return b.String(), nil
}

func firstLine(s string) string {
	if i := strings.IndexByte(s, '\n'); i >= 0 {
		return strings.TrimSpace(s[:i])
	}
	return s
}
