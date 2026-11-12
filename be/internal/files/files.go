// Package files stores chat attachments and serves them back.
//
//	POST /files            upload; body = the file, Authorization = NIP-98
//	GET  /files/<sha256>   download (an extension after the hash is ignored)
//
// Uploads must be signed by a Nostr key (NIP-98 HTTP auth, kind 27235) that
// commits to this URL, the method and the body's SHA-256, so a captured header
// can't be replayed for another file. Files are stored by content hash, so the
// same file uploaded twice is stored once.
//
// Only a few safe types are accepted, decided from the bytes, not from what
// the client claims. They are served with nosniff and a sandboxing CSP, and
// everything but images downloads instead of opening, so an upload can't run
// script on this origin.
package files

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"stooges/be/internal/nostr"
	"stooges/be/internal/origin"
)

const (
	MaxBytes       = 10 << 20 // 10 MB per file
	kindHTTPAuth   = 27235
	authMaxAge     = 60 * time.Second
	uploadsPerUser = 30 // per window, per key
	uploadWindow   = 10 * time.Minute
)

// Allowed types, detected from content. Extensions are for nicer URLs only.
var allowed = map[string]string{
	"image/png":       ".png",
	"image/jpeg":      ".jpg",
	"image/gif":       ".gif",
	"image/webp":      ".webp",
	"application/pdf": ".pdf",
	"text/plain":      ".txt",
	"application/zip": ".zip", // also .docx, .xlsx, .pptx
}

var hashPath = regexp.MustCompile(`^/files/([0-9a-f]{64})(\.[a-z0-9]{1,5})?$`)

// Handler serves /files.
type Handler struct {
	dir     string
	log     *slog.Logger
	allowed []string

	mu      sync.Mutex
	uploads map[string][]time.Time // pubkey -> recent upload times
}

// New stores files in dir, creating it if needed.
func New(dir string, log *slog.Logger, allowedOrigins []string) (*Handler, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	return &Handler{dir: dir, log: log, allowed: origin.Normalize(allowedOrigins), uploads: map[string][]time.Time{}}, nil
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	from := r.Header.Get("Origin")
	if from != "" && !origin.Allowed(h.allowed, from) {
		writeError(w, http.StatusForbidden, "This site is not allowed to upload files.")
		return
	}
	if from != "" {
		w.Header().Set("Access-Control-Allow-Origin", from)
		w.Header().Set("Vary", "Origin")
	}
	switch {
	case r.Method == http.MethodOptions:
		w.Header().Set("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
		w.Header().Set("Access-Control-Max-Age", "600")
		w.WriteHeader(http.StatusNoContent)
	case r.Method == http.MethodPost && r.URL.Path == "/files":
		h.upload(w, r)
	case r.Method == http.MethodGet || r.Method == http.MethodHead:
		h.serve(w, r)
	default:
		writeError(w, http.StatusNotFound, "Not found.")
	}
}

func (h *Handler) upload(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, MaxBytes)
	body, err := io.ReadAll(r.Body)
	var tooBig *http.MaxBytesError
	if errors.As(err, &tooBig) {
		writeError(w, http.StatusRequestEntityTooLarge, fmt.Sprintf("Files can be up to %d MB.", MaxBytes>>20))
		return
	}
	if err != nil || len(body) == 0 {
		writeError(w, http.StatusBadRequest, "The file is empty.")
		return
	}
	sum := sha256.Sum256(body)
	hash := hex.EncodeToString(sum[:])

	pubkey, err := verifyAuth(r, hash)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "Sign in again to upload: "+err.Error())
		return
	}
	if !h.allow(pubkey) {
		writeError(w, http.StatusTooManyRequests, "Too many uploads. Try again in a few minutes.")
		return
	}

	mimeType := detect(body)
	ext, ok := allowed[mimeType]
	if !ok {
		writeError(w, http.StatusUnsupportedMediaType, "That file type isn't supported. Use an image, PDF, text, or Office/zip file.")
		return
	}

	path := filepath.Join(h.dir, hash)
	if _, err := os.Stat(path); errors.Is(err, os.ErrNotExist) {
		tmp, err := os.CreateTemp(h.dir, "upload-*")
		if err == nil {
			_, err = tmp.Write(body)
			if cerr := tmp.Close(); err == nil {
				err = cerr
			}
			if err == nil {
				err = os.Rename(tmp.Name(), path)
			}
			if err != nil {
				os.Remove(tmp.Name())
			}
		}
		if err != nil {
			h.log.Error("store upload failed", "err", err)
			writeError(w, http.StatusInternalServerError, "Could not save the file. Try again.")
			return
		}
	}
	h.log.Info("file uploaded", "sha256", hash, "type", mimeType, "bytes", len(body), "pubkey", pubkey)
	writeJSON(w, http.StatusCreated, map[string]any{
		"url":    publicURL(r, "/files/"+hash+ext),
		"sha256": hash,
		"size":   len(body),
		"type":   mimeType,
	})
}

func (h *Handler) serve(w http.ResponseWriter, r *http.Request) {
	m := hashPath.FindStringSubmatch(r.URL.Path)
	if m == nil {
		writeError(w, http.StatusNotFound, "Not found.")
		return
	}
	f, err := os.Open(filepath.Join(h.dir, m[1]))
	if err != nil {
		writeError(w, http.StatusNotFound, "Not found.")
		return
	}
	defer f.Close()
	head := make([]byte, 512)
	n, _ := io.ReadFull(f, head)
	mimeType := detect(head[:n])
	if _, ok := allowed[mimeType]; !ok {
		mimeType = "application/octet-stream"
	}
	if _, err := f.Seek(0, io.SeekStart); err != nil {
		writeError(w, http.StatusInternalServerError, "Could not read the file.")
		return
	}

	hd := w.Header()
	hd.Set("Content-Type", mimeType)
	hd.Set("X-Content-Type-Options", "nosniff")
	hd.Set("Content-Security-Policy", "default-src 'none'; sandbox")
	hd.Set("Cross-Origin-Resource-Policy", "cross-origin") // the app is on another origin
	hd.Set("Cache-Control", "public, max-age=31536000, immutable")
	name := safeName(r.URL.Query().Get("name"), m[1]+allowed[mimeType])
	disposition := "attachment"
	if strings.HasPrefix(mimeType, "image/") {
		disposition = "inline"
	}
	hd.Set("Content-Disposition", mime.FormatMediaType(disposition, map[string]string{"filename": name}))
	http.ServeContent(w, r, "", time.Time{}, f)
}

// detect returns the content type of a file from its bytes. Text that starts
// with markup (SVG, HTML fragments Go doesn't recognise) is not plain text.
func detect(b []byte) string {
	t, _, _ := strings.Cut(http.DetectContentType(b), ";")
	if t == "text/plain" && strings.HasPrefix(strings.TrimSpace(string(b[:min(len(b), 512)])), "<") {
		return "text/markup"
	}
	return t
}

// verifyAuth checks a NIP-98 Authorization header for this request and body,
// and returns the signer's public key.
func verifyAuth(r *http.Request, bodyHash string) (string, error) {
	token, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Nostr ")
	if !ok {
		return "", errors.New("missing Nostr authorization")
	}
	raw, err := base64.StdEncoding.DecodeString(strings.TrimSpace(token))
	if err != nil {
		return "", errors.New("authorization is not base64")
	}
	var ev nostr.Event
	if err := json.Unmarshal(raw, &ev); err != nil {
		return "", errors.New("authorization is not an event")
	}
	if ev.Kind != kindHTTPAuth {
		return "", errors.New("wrong authorization kind")
	}
	if err := ev.Verify(); err != nil {
		return "", errors.New("bad signature")
	}
	if age := time.Since(time.Unix(ev.CreatedAt, 0)); age > authMaxAge || age < -authMaxAge {
		return "", errors.New("authorization expired")
	}
	if !strings.EqualFold(ev.TagValue("method"), r.Method) {
		return "", errors.New("authorization is for another method")
	}
	// Compare host and path only: behind a proxy the scheme the relay sees
	// may differ from the one the browser used.
	if u := ev.TagValue("u"); !sameEndpoint(u, r) {
		return "", errors.New("authorization is for another URL")
	}
	if ev.TagValue("payload") != bodyHash {
		return "", errors.New("authorization is for another file")
	}
	return ev.PubKey, nil
}

func sameEndpoint(u string, r *http.Request) bool {
	_, rest, ok := strings.Cut(u, "://")
	if !ok {
		return false
	}
	host, path, _ := strings.Cut(rest, "/")
	path, _, _ = strings.Cut(path, "?")
	return strings.EqualFold(host, r.Host) && "/"+path == r.URL.Path
}

func (h *Handler) allow(pubkey string) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	now := time.Now()
	recent := h.uploads[pubkey][:0]
	for _, t := range h.uploads[pubkey] {
		if now.Sub(t) < uploadWindow {
			recent = append(recent, t)
		}
	}
	if len(recent) >= uploadsPerUser {
		h.uploads[pubkey] = recent
		return false
	}
	h.uploads[pubkey] = append(recent, now)
	return true
}

// publicURL is the absolute URL of path as the browser reached this server.
func publicURL(r *http.Request, path string) string {
	scheme := "http"
	if r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https" {
		scheme = "https"
	}
	return scheme + "://" + r.Host + path
}

// safeName keeps a download name to plain characters, falling back to def.
func safeName(name, def string) string {
	name = strings.Map(func(c rune) rune {
		if c < 0x20 || strings.ContainsRune(`/\"<>:|?*`, c) {
			return -1
		}
		return c
	}, strings.TrimSpace(name))
	if name == "" || len(name) > 120 {
		return def
	}
	return name
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}
