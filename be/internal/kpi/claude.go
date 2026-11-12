package kpi

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/anthropics/anthropic-sdk-go/v2"
)

// DefaultModel is the Claude model used when -provider claude is chosen.
const DefaultModel = "claude-opus-5-5"

// Claude evaluates conversations and writes per-person reviews. It
// implements Agent.
type Claude struct {
	Client anthropic.Client
	Model  string
}

// NewClaude uses the default credentials (ANTHROPIC_API_KEY or an
// `ant auth login` profile).
func NewClaude(model string) *Claude {
	if model == "" {
		model = DefaultModel
	}
	return &Claude{Client: anthropic.NewClient(), Model: model}
}

// ErrRefused means the model declined the request.
var ErrRefused = errors.New("model declined this request")

// ModelName implements Agent.
func (c *Claude) ModelName() string { return c.Model }

// structured sends one request and returns the JSON text that matches schema.
func (c *Claude) structured(ctx context.Context, system, user string, schema []byte) (string, error) {
	resp, err := c.Client.Beta.Messages.New(ctx, anthropic.BetaMessageNewParams{
		Model:     anthropic.Model(c.Model),
		MaxTokens: 16000,
		// Each system prompt is the same for every request of its kind, so it caches.
		System: []anthropic.BetaTextBlockParam{{
			Text:         system,
			CacheControl: anthropic.NewBetaCacheControlEphemeralParam(),
		}},
		Messages: []anthropic.BetaMessageParam{
			anthropic.NewBetaUserMessage(anthropic.NewBetaTextBlock(user)),
		},
		OutputConfig: anthropic.BetaOutputConfigParam{
			// Judging contributions is judgment-heavy work, so use high effort.
			Effort: anthropic.BetaOutputConfigEffortHigh,
			Format: anthropic.BetaJSONOutputFormatParam{Schema: schema},
		},
		// If a request is declined for policy reasons, let the API retry it on a
		// fallback model in the same call.
		Fallbacks: anthropic.BetaFallbacksParamOfDefault(),
		Betas:     []anthropic.AnthropicBeta{anthropic.AnthropicBetaServerSideFallback2026_07_01},
	})
	if err != nil {
		return "", err
	}
	if resp.StopReason == anthropic.BetaStopReasonRefusal {
		return "", ErrRefused
	}
	if resp.StopReason == anthropic.BetaStopReasonMaxTokens {
		return "", fmt.Errorf("response was cut off at max_tokens")
	}
	var text strings.Builder
	for _, block := range resp.Content {
		if t, ok := block.AsAny().(anthropic.BetaTextBlock); ok {
			text.WriteString(t.Text)
		}
	}
	return text.String(), nil
}

// EvaluateBatch finds the KPI contributions in several conversations at once.
func (c *Claude) EvaluateBatch(ctx context.Context, units []*Unit) ([][]Finding, error) {
	text, err := c.structured(ctx, SystemPrompt(), batchPrompt(units), findingsSchema)
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
func (c *Claude) Review(ctx context.Context, p *Person, from, to time.Time) (*Review, error) {
	text, err := c.structured(ctx, ReviewSystemPrompt(), reviewUserPrompt(p, from, to), reviewSchema)
	if err != nil {
		return nil, err
	}
	return parseReview(text)
}
