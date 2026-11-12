package accounts

import (
	"bytes"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/btcsuite/btcd/btcec/v2"

	"stooges/be/internal/nostr"
	"stooges/be/internal/store"
)

func newServer(t *testing.T, allowed ...string) *httptest.Server {
	t.Helper()
	st, err := store.Open(filepath.Join(t.TempDir(), "a.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	srv := httptest.NewServer(New(st, slog.New(slog.NewTextHandler(io.Discard, nil)), allowed))
	t.Cleanup(srv.Close)
	return srv
}

func post(t *testing.T, srv *httptest.Server, path string, body any, origin string) (int, map[string]string) {
	t.Helper()
	b, _ := json.Marshal(body)
	req, _ := http.NewRequest(http.MethodPost, srv.URL+path, bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	if origin != "" {
		req.Header.Set("Origin", origin)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	var out map[string]string
	json.NewDecoder(res.Body).Decode(&out)
	return res.StatusCode, out
}

func pubkey(t *testing.T) string {
	priv, _ := btcec.NewPrivateKey()
	return nostr.PubKeyHex(priv)
}

var authKey = strings.Repeat("ab", 32)

func TestSignupAndLogin(t *testing.T) {
	srv := newServer(t)
	pk := pubkey(t)
	signup := map[string]string{"email": " Maya@Example.com ", "auth_key": authKey, "pubkey": pk, "ncryptsec": "ncryptsec1abc"}

	if code, out := post(t, srv, "/api/signup", signup, ""); code != http.StatusCreated {
		t.Fatalf("signup: %d %v", code, out)
	}
	if code, out := post(t, srv, "/api/signup", signup, ""); code != http.StatusConflict || !strings.Contains(out["error"], "already exists") {
		t.Fatalf("duplicate email should be rejected: %d %v", code, out)
	}

	// Email is case- and space-insensitive.
	code, out := post(t, srv, "/api/login", map[string]string{"email": "maya@example.com", "auth_key": authKey}, "")
	if code != http.StatusOK || out["pubkey"] != pk || out["ncryptsec"] != "ncryptsec1abc" {
		t.Fatalf("login: %d %v", code, out)
	}

	// Wrong password and unknown email give the same answer.
	_, wrong := post(t, srv, "/api/login", map[string]string{"email": "maya@example.com", "auth_key": strings.Repeat("cd", 32)}, "")
	_, unknown := post(t, srv, "/api/login", map[string]string{"email": "nobody@example.com", "auth_key": authKey}, "")
	if wrong["error"] != genericLoginErr || unknown["error"] != genericLoginErr {
		t.Fatalf("errors must not reveal whether the email exists: %v / %v", wrong, unknown)
	}
}

func TestSignupValidation(t *testing.T) {
	srv := newServer(t)
	cases := map[string]map[string]string{
		"bad email":     {"email": "not-an-email", "auth_key": authKey, "pubkey": pubkey(t), "ncryptsec": "ncryptsec1x"},
		"bad auth key":  {"email": "a@b.co", "auth_key": "short", "pubkey": pubkey(t), "ncryptsec": "ncryptsec1x"},
		"bad pubkey":    {"email": "a@b.co", "auth_key": authKey, "pubkey": strings.Repeat("0", 64), "ncryptsec": "ncryptsec1x"},
		"bad ncryptsec": {"email": "a@b.co", "auth_key": authKey, "pubkey": pubkey(t), "ncryptsec": "nsec1plaintext"},
	}
	for name, body := range cases {
		if code, _ := post(t, srv, "/api/signup", body, ""); code != http.StatusBadRequest {
			t.Errorf("%s: want 400, got %d", name, code)
		}
	}
}

func TestLoginLockout(t *testing.T) {
	srv := newServer(t)
	post(t, srv, "/api/signup", map[string]string{"email": "a@b.co", "auth_key": authKey, "pubkey": pubkey(t), "ncryptsec": "ncryptsec1x"}, "")
	bad := map[string]string{"email": "a@b.co", "auth_key": strings.Repeat("00", 32)}
	for i := 0; i < maxAttempts; i++ {
		post(t, srv, "/api/login", bad, "")
	}
	if code, _ := post(t, srv, "/api/login", map[string]string{"email": "a@b.co", "auth_key": authKey}, ""); code != http.StatusTooManyRequests {
		t.Fatalf("after %d failures even the right password waits; got %d", maxAttempts, code)
	}
}

func TestCORS(t *testing.T) {
	srv := newServer(t, "https://stooges.vercel.app")

	req, _ := http.NewRequest(http.MethodOptions, srv.URL+"/api/login", nil)
	req.Header.Set("Origin", "https://stooges.vercel.app")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusNoContent || res.Header.Get("Access-Control-Allow-Origin") != "https://stooges.vercel.app" {
		t.Fatalf("preflight from an allowed origin: %d %q", res.StatusCode, res.Header.Get("Access-Control-Allow-Origin"))
	}

	if code, _ := post(t, srv, "/api/login", map[string]string{"email": "a@b.co", "auth_key": authKey}, "https://evil.example"); code != http.StatusForbidden {
		t.Fatalf("other origins must be refused, got %d", code)
	}
}
