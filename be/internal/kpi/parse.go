package kpi

import (
	"encoding/json"
	"errors"
	"fmt"
	"time"
)

// Agent is a model provider that can both evaluate conversations and write reviews.
type Agent interface {
	Evaluator
	Reviewer
	// ModelName identifies the model, for the report and the cache key.
	ModelName() string
}

// ErrQuotaExhausted means the provider's quota is used up for longer than is
// worth waiting (e.g. a daily free-tier limit). Runs stop early and keep
// what they have so far.
var ErrQuotaExhausted = errors.New("API quota exhausted")

// QuotaError carries how long until the quota resets, when the provider says.
type QuotaError struct {
	RetryAfter time.Duration
	Message    string
}

func (e *QuotaError) Error() string {
	if e.RetryAfter > 0 {
		return fmt.Sprintf("%s (resets in about %s)", ErrQuotaExhausted, e.RetryAfter.Round(time.Minute))
	}
	return ErrQuotaExhausted.Error()
}

func (e *QuotaError) Unwrap() error { return ErrQuotaExhausted }

// parseFindings reads the structured output of an evaluation call.
func parseFindings(text string) ([]Finding, error) {
	var out struct {
		Contributions []Finding `json:"contributions"`
	}
	if err := json.Unmarshal([]byte(text), &out); err != nil {
		return nil, fmt.Errorf("parse model output: %w", err)
	}
	return out.Contributions, nil
}

// parseReview reads the structured output of a review call.
func parseReview(text string) (*Review, error) {
	var rv Review
	if err := json.Unmarshal([]byte(text), &rv); err != nil {
		return nil, fmt.Errorf("parse model output: %w", err)
	}
	return &rv, nil
}
