package files

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/btcsuite/btcd/btcec/v2"

	"stooges/be/internal/nostr"
)

var pngBytes = append([]byte("\x89PNG\r\n\x1a\n"), bytes.Repeat([]byte{0}, 64)...)

func authHeader(t *testing.T, key *btcec.PrivateKey, url, method string, body []byte) string {
	t.Helper()
	sum := sha256.Sum256(body)
	ev := &nostr.Event{
		CreatedAt: time.Now().Unix(),
		Kind:      kindHTTPAuth,
		Tags:      []nostr.Tag{{"u", url}, {"method", method}, {"payload", hex.EncodeToString(sum[:])}},
	}
	if err := ev.Sign(key); err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(ev)
	return "Nostr " + base64.StdEncoding.EncodeToString(raw)
}

func upload(t *testing.T, srv *httptest.Server, body []byte, auth string) *http.Response {
	t.Helper()
	req, _ := http.NewRequest(http.MethodPost, srv.URL+"/files", bytes.NewReader(body))
	if auth != "" {
		req.Header.Set("Authorization", auth)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { res.Body.Close() })
	return res
}

func newServer(t *testing.T) *httptest.Server {
	h, err := New(t.TempDir(), slog.New(slog.NewTextHandler(io.Discard, nil)), nil)
	if err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(h)
	t.Cleanup(srv.Close)
	return srv
}

func TestUploadAndServeAnImage(t *testing.T) {
	srv := newServer(t)
	key, _ := btcec.NewPrivateKey()
	res := upload(t, srv, pngBytes, authHeader(t, key, srv.URL+"/files", "POST", pngBytes))
	if res.StatusCode != http.StatusCreated {
		b, _ := io.ReadAll(res.Body)
		t.Fatalf("upload: %d %s", res.StatusCode, b)
	}
	var out struct{ URL, Type string }
	json.NewDecoder(res.Body).Decode(&out)
	if out.Type != "image/png" || !strings.HasSuffix(out.URL, ".png") {
		t.Fatalf("unexpected upload result %+v", out)
	}

	got, err := http.Get(out.URL)
	if err != nil {
		t.Fatal(err)
	}
	defer got.Body.Close()
	body, _ := io.ReadAll(got.Body)
	if !bytes.Equal(body, pngBytes) || got.Header.Get("Content-Type") != "image/png" ||
		got.Header.Get("X-Content-Type-Options") != "nosniff" || !strings.Contains(got.Header.Get("Content-Security-Policy"), "sandbox") {
		t.Fatalf("bad download: %q %v", body, got.Header)
	}
}

func TestUploadRejectsBadAuthAndUnsafeTypes(t *testing.T) {
	srv := newServer(t)
	key, _ := btcec.NewPrivateKey()
	url := srv.URL + "/files"

	if res := upload(t, srv, pngBytes, ""); res.StatusCode != http.StatusUnauthorized {
		t.Fatalf("unsigned upload: want 401, got %d", res.StatusCode)
	}
	// Signed for a different file: a captured header can't upload something else.
	other := append([]byte{}, pngBytes...)
	other[20] = 1
	if res := upload(t, srv, pngBytes, authHeader(t, key, url, "POST", other)); res.StatusCode != http.StatusUnauthorized {
		t.Fatalf("auth for another body: want 401, got %d", res.StatusCode)
	}
	html := []byte("<!doctype html><script>alert(1)</script>")
	if res := upload(t, srv, html, authHeader(t, key, url, "POST", html)); res.StatusCode != http.StatusUnsupportedMediaType {
		t.Fatalf("html upload: want 415, got %d", res.StatusCode)
	}
	svg := []byte(`<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>`)
	if res := upload(t, srv, svg, authHeader(t, key, url, "POST", svg)); res.StatusCode != http.StatusUnsupportedMediaType {
		t.Fatalf("svg upload: want 415, got %d", res.StatusCode)
	}
	big := make([]byte, MaxBytes+1)
	copy(big, pngBytes)
	if res := upload(t, srv, big, authHeader(t, key, url, "POST", big)); res.StatusCode != http.StatusRequestEntityTooLarge {
		t.Fatalf("oversized upload: want 413, got %d", res.StatusCode)
	}
}
