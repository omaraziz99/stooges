package kpi

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"sync"
	"time"
)

// Report is what the dashboard reads.
type Report struct {
	GeneratedAt   time.Time    `json:"generated_at"`
	Model         string       `json:"model"`
	Channels      []string     `json:"channels"`
	From          time.Time    `json:"from"`
	To            time.Time    `json:"to"`
	Conversations int          `json:"conversations"`
	Skipped       []string     `json:"skipped,omitempty"`
	Pillars       []PillarInfo `json:"pillars"`
	Team          TeamSummary  `json:"team"`
	People        []Person     `json:"people"`
}

// TeamSummary counts evidence per pillar, overall and per month.
type TeamSummary struct {
	Counts  map[Pillar]int `json:"counts"`
	ByMonth []MonthCounts  `json:"by_month"`
}

// MonthCounts is one month of team evidence.
type MonthCounts struct {
	Month  string         `json:"month"` // "2026-09"
	Counts map[Pillar]int `json:"counts"`
}

// Person is one contributor's evidence log. There is deliberately no total
// score: evidence is for discussion, not ranking.
type Person struct {
	Name     string         `json:"name"`
	Messages int            `json:"messages"`
	Counts   map[Pillar]int `json:"counts"`
	Impact   map[Impact]int `json:"impact"`
	Evidence []Evidence     `json:"evidence"`
	Review   *Review        `json:"review,omitempty"`
}

// EvalOptions controls an evaluation run.
type EvalOptions struct {
	Model     string // part of the cache key
	Cache     *Cache // nil means no caching
	BatchSize int    // conversations per request
	Parallel  int    // requests in flight at once
	// Progress is called after each request with the batch size, the
	// evidence kept, and any error.
	Progress func(done, total, size, kept int, err error)
}

// EvalResult summarises a run.
type EvalResult struct {
	Evidence  []Evidence
	Cached    int         // conversations answered from the cache
	Sent      int         // conversations the model reviewed in this run
	Requests  int         // model requests made
	Skipped   []string    // conversations without a result, with the reason
	Quota     *QuotaError // set when the run stopped early on quota
	Completed bool        // every conversation has a result
}

// Evaluate judges every unit, reusing cached results and sending the rest
// in batches. If the provider's quota runs out it stops sending, keeps what
// it has (the caller should save the cache), and reports Quota.
func Evaluate(ctx context.Context, ev Evaluator, units []Unit, opt EvalOptions) EvalResult {
	cache := opt.Cache
	if cache == nil {
		cache, _ = OpenCache("")
	}
	batchSize := max(1, opt.BatchSize)
	parallel := max(1, opt.Parallel)

	findings := make([][]Finding, len(units))
	have := make([]bool, len(units))
	failure := make([]string, len(units))
	var res EvalResult

	var pending []int
	for i := range units {
		if f, ok := cache.findings(evaluationKey(opt.Model, &units[i])); ok {
			findings[i], have[i] = f, true
			res.Cached++
		} else {
			pending = append(pending, i)
		}
	}
	var batches [][]int
	for start := 0; start < len(pending); start += batchSize {
		batches = append(batches, pending[start:min(start+batchSize, len(pending))])
	}

	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	sem := make(chan struct{}, parallel)
	var wg sync.WaitGroup
	var mu sync.Mutex
	done := 0

	for _, batch := range batches {
		wg.Add(1)
		go func() {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()

			mu.Lock()
			stopped := res.Quota != nil
			mu.Unlock()
			var got [][]Finding
			var err error
			if stopped {
				err = ErrQuotaExhausted
			} else {
				ptrs := make([]*Unit, len(batch))
				for j, i := range batch {
					ptrs[j] = &units[i]
				}
				got, err = ev.EvaluateBatch(ctx, ptrs)
				if err == nil && len(got) != len(batch) {
					err = fmt.Errorf("model returned %d results for %d conversations", len(got), len(batch))
				}
			}

			mu.Lock()
			defer mu.Unlock()
			if !stopped {
				res.Requests++
				if err == nil {
					res.Sent += len(batch)
				}
			}
			var qe *QuotaError
			if errors.As(err, &qe) && res.Quota == nil {
				res.Quota = qe
				cancel() // don't spend more requests; in-flight ones are abandoned
			}
			kept := 0
			for j, i := range batch {
				if err != nil {
					failure[i] = reasonFor(err, res.Quota)
					continue
				}
				findings[i], have[i] = got[j], true
				cache.putFindings(evaluationKey(opt.Model, &units[i]), got[j])
				valid, _ := Validate(&units[i], got[j])
				kept += len(valid)
			}
			done++
			if opt.Progress != nil {
				var shown error
				if err != nil {
					shown = errors.New(reasonFor(err, res.Quota))
				}
				opt.Progress(done, len(batches), len(batch), kept, shown)
			}
		}()
	}
	wg.Wait()

	res.Completed = true
	for i := range units {
		if !have[i] {
			res.Completed = false
			res.Skipped = append(res.Skipped, fmt.Sprintf("%s %s: %s", units[i].Kind, units[i].ID[:min(12, len(units[i].ID))], failure[i]))
			continue
		}
		valid, _ := Validate(&units[i], findings[i])
		res.Evidence = append(res.Evidence, valid...)
	}
	return res
}

func reasonFor(err error, quota *QuotaError) string {
	switch {
	case quota != nil && (errors.Is(err, context.Canceled) || errors.Is(err, ErrQuotaExhausted)):
		return "not reviewed yet: " + quota.Error()
	case errors.Is(err, ErrRefused):
		return ErrRefused.Error()
	default:
		return err.Error()
	}
}

// BuildReport aggregates evidence per person and per month.
func BuildReport(units []Unit, evidence []Evidence, model string, channels []string, skipped []string) Report {
	r := Report{
		GeneratedAt:   time.Now().UTC(),
		Model:         model,
		Channels:      channels,
		Conversations: len(units),
		Skipped:       skipped,
		Pillars:       Pillars,
		Team:          TeamSummary{Counts: zeroCounts()},
	}

	people := map[string]*Person{}
	person := func(name string) *Person {
		p, ok := people[name]
		if !ok {
			p = &Person{Name: name, Counts: zeroCounts(), Impact: map[Impact]int{ImpactLow: 0, ImpactMedium: 0, ImpactHigh: 0}}
			people[name] = p
		}
		return p
	}

	// Everyone who wrote a message appears, even with no evidence yet.
	for _, u := range units {
		for _, m := range u.Messages {
			person(m.Author).Messages++
			if r.From.IsZero() || m.At.Before(r.From) {
				r.From = m.At
			}
			if m.At.After(r.To) {
				r.To = m.At
			}
		}
	}

	months := map[string]map[Pillar]int{}
	for _, e := range evidence {
		p := person(e.Contributor)
		p.Counts[e.Pillar]++
		p.Impact[e.Impact]++
		p.Evidence = append(p.Evidence, e)
		r.Team.Counts[e.Pillar]++
		month := e.At.Format("2006-01")
		if months[month] == nil {
			months[month] = zeroCounts()
		}
		months[month][e.Pillar]++
	}

	for month, counts := range months {
		r.Team.ByMonth = append(r.Team.ByMonth, MonthCounts{Month: month, Counts: counts})
	}
	sort.Slice(r.Team.ByMonth, func(i, j int) bool { return r.Team.ByMonth[i].Month < r.Team.ByMonth[j].Month })

	for _, p := range people {
		sort.Slice(p.Evidence, func(i, j int) bool { return p.Evidence[i].At.Before(p.Evidence[j].At) })
		if p.Evidence == nil {
			p.Evidence = []Evidence{}
		}
		r.People = append(r.People, *p)
	}
	// Alphabetical, not by volume: the report is not a leaderboard.
	sort.Slice(r.People, func(i, j int) bool { return r.People[i].Name < r.People[j].Name })
	return r
}

func zeroCounts() map[Pillar]int {
	m := map[Pillar]int{}
	for _, p := range Pillars {
		m[p.ID] = 0
	}
	return m
}
