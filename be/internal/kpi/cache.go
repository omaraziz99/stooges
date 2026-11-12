package kpi

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// Cache stores model results on disk so re-runs only send conversations that
// are new or changed, and a run cut short by a quota resumes where it
// stopped. Keys include the model, prompt, and schema, so editing any of
// them invalidates old entries automatically.
//
// The file holds summaries and quotes from team chat: keep it out of git.
type Cache struct {
	path     string
	mu       sync.Mutex
	Findings map[string][]Finding       `json:"findings"`
	Reviews  map[string]json.RawMessage `json:"reviews"`
}

// OpenCache loads the cache at path. An empty path gives an in-memory cache
// that is never saved; a missing file starts empty.
func OpenCache(path string) (*Cache, error) {
	c := &Cache{path: path, Findings: map[string][]Finding{}, Reviews: map[string]json.RawMessage{}}
	if path == "" {
		return c, nil
	}
	data, err := os.ReadFile(path)
	if errors.Is(err, fs.ErrNotExist) {
		return c, nil
	}
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal(data, c); err != nil {
		return nil, err
	}
	if c.Findings == nil {
		c.Findings = map[string][]Finding{}
	}
	if c.Reviews == nil {
		c.Reviews = map[string]json.RawMessage{}
	}
	return c, nil
}

// Save writes the cache atomically. It is a no-op for in-memory caches.
func (c *Cache) Save() error {
	if c.path == "" {
		return nil
	}
	c.mu.Lock()
	data, err := json.Marshal(c)
	c.mu.Unlock()
	if err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(c.path), ".kpi-cache-*")
	if err != nil {
		return err
	}
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		os.Remove(tmp.Name())
		return err
	}
	if err := tmp.Close(); err != nil {
		os.Remove(tmp.Name())
		return err
	}
	return os.Rename(tmp.Name(), c.path)
}

func (c *Cache) findings(key string) ([]Finding, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	f, ok := c.Findings[key]
	return f, ok
}

func (c *Cache) putFindings(key string, f []Finding) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if f == nil {
		f = []Finding{} // "nothing found" is a result worth caching too
	}
	c.Findings[key] = f
}

// review returns a fresh copy, since ValidateReview edits what it is given.
func (c *Cache) review(key string) (*Review, bool) {
	c.mu.Lock()
	raw, ok := c.Reviews[key]
	c.mu.Unlock()
	if !ok {
		return nil, false
	}
	var rv Review
	if json.Unmarshal(raw, &rv) != nil {
		return nil, false
	}
	return &rv, true
}

func (c *Cache) putReview(key string, rv *Review) {
	raw, err := json.Marshal(rv)
	if err != nil {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	c.Reviews[key] = raw
}

func hashKey(parts ...string) string {
	h := sha256.New()
	for _, p := range parts {
		h.Write([]byte(p))
		h.Write([]byte{0})
	}
	return hex.EncodeToString(h.Sum(nil))
}

func evaluationKey(model string, u *Unit) string {
	return hashKey("eval", model, SystemPrompt(), string(findingsSchema), u.Transcript())
}

func reviewKey(model string, p *Person, from, to time.Time) string {
	return hashKey("review", model, ReviewSystemPrompt(), string(reviewSchema), reviewUserPrompt(p, from, to))
}
