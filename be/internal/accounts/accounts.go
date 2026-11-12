// Package accounts adds email + password sign-up and log-in on top of the
// relay's key-based identities.
//
// The password never reaches the server. The browser derives two things from it:
//   - an auth key (PBKDF2 of the password, salted with the email), which the
//     server stores only as a bcrypt hash and checks at log-in;
//   - an encrypted copy of the user's chat key (NIP-49 "ncryptsec", scrypt +
//     XChaCha20), which the server stores and hands back after a successful
//     log-in for the browser to decrypt.
//
// So a leaked database holds no usable keys or passwords. The flip side: a
// forgotten password can't be reset without losing the identity.
package accounts

import (
	"encoding/hex"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/btcsuite/btcd/btcec/v2/schnorr"
	"golang.org/x/crypto/bcrypt"

	"stooges/be/internal/origin"
	"stooges/be/internal/store"
)

const (
	maxBody         = 16 * 1024
	maxEmail        = 254
	maxAttempts     = 10               // failed log-ins per email per window
	attemptWindow   = 15 * time.Minute // before the counter resets
	genericLoginErr = "Wrong email or password."
)

var (
	emailPattern = regexp.MustCompile(`^[^\s@]+@[^\s@]+\.[^\s@]+$`)
	hex64        = regexp.MustCompile(`^[0-9a-f]{64}$`)
)

// Handler serves POST /api/signup and POST /api/login.
type Handler struct {
	store   *store.Store
	log     *slog.Logger
	allowed []string // normalized ALLOWED_ORIGINS; empty = any

	mu       sync.Mutex
	failures map[string]*attempts

	dummyHash []byte // compared against when an email is unknown, so timing doesn't reveal it
}

type attempts struct {
	count int
	since time.Time
}

// New creates the accounts API.
func New(st *store.Store, log *slog.Logger, allowedOrigins []string) *Handler {
	dummy, _ := bcrypt.GenerateFromPassword([]byte("stooges-dummy-auth-key"), bcrypt.DefaultCost)
	return &Handler{
		store:     st,
		log:       log,
		allowed:   origin.Normalize(allowedOrigins),
		failures:  map[string]*attempts{},
		dummyHash: dummy,
	}
}

type signupRequest struct {
	Email     string `json:"email"`
	AuthKey   string `json:"auth_key"`
	PubKey    string `json:"pubkey"`
	Ncryptsec string `json:"ncryptsec"`
}

type loginRequest struct {
	Email   string `json:"email"`
	AuthKey string `json:"auth_key"`
}

type loginResponse struct {
	PubKey    string `json:"pubkey"`
	Ncryptsec string `json:"ncryptsec"`
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	from := r.Header.Get("Origin")
	if !origin.Allowed(h.allowed, from) {
		h.log.Warn("rejected accounts request from origin not in ALLOWED_ORIGINS", "origin", from)
		writeError(w, http.StatusForbidden, "This site is not allowed to use the accounts API.")
		return
	}
	if from != "" {
		w.Header().Set("Access-Control-Allow-Origin", from)
		w.Header().Set("Vary", "Origin")
	}
	if r.Method == http.MethodOptions {
		w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		w.Header().Set("Access-Control-Max-Age", "600")
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "Use POST.")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxBody)

	switch r.URL.Path {
	case "/api/signup":
		h.signup(w, r)
	case "/api/login":
		h.login(w, r)
	default:
		writeError(w, http.StatusNotFound, "Not found.")
	}
}

func (h *Handler) signup(w http.ResponseWriter, r *http.Request) {
	var req signupRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid request.")
		return
	}
	email := normalizeEmail(req.Email)
	switch {
	case !validEmail(email):
		writeError(w, http.StatusBadRequest, "Enter a valid email address.")
		return
	case !hex64.MatchString(req.AuthKey):
		writeError(w, http.StatusBadRequest, "Invalid request.")
		return
	case !validPubKey(req.PubKey):
		writeError(w, http.StatusBadRequest, "Invalid request.")
		return
	case !strings.HasPrefix(req.Ncryptsec, "ncryptsec1") || len(req.Ncryptsec) > 400:
		writeError(w, http.StatusBadRequest, "Invalid request.")
		return
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(req.AuthKey), bcrypt.DefaultCost)
	if err != nil {
		h.log.Error("bcrypt failed", "err", err)
		writeError(w, http.StatusInternalServerError, "Something went wrong. Try again.")
		return
	}
	acct := store.Account{Email: email, PubKey: req.PubKey, AuthHash: string(hash), Ncryptsec: req.Ncryptsec}
	err = h.store.CreateAccount(r.Context(), acct, time.Now().Unix())
	if errors.Is(err, store.ErrAccountExists) {
		writeError(w, http.StatusConflict, "An account with this email already exists. Log in instead.")
		return
	}
	if err != nil {
		h.log.Error("create account failed", "err", err)
		writeError(w, http.StatusInternalServerError, "Something went wrong. Try again.")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]string{"pubkey": req.PubKey})
}

func (h *Handler) login(w http.ResponseWriter, r *http.Request) {
	var req loginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid request.")
		return
	}
	email := normalizeEmail(req.Email)
	if !validEmail(email) || !hex64.MatchString(req.AuthKey) {
		writeError(w, http.StatusUnauthorized, genericLoginErr)
		return
	}
	if h.locked(email) {
		writeError(w, http.StatusTooManyRequests, "Too many attempts. Try again in a few minutes.")
		return
	}

	acct, ok, err := h.store.GetAccount(r.Context(), email)
	if err != nil {
		h.log.Error("account lookup failed", "err", err)
		writeError(w, http.StatusInternalServerError, "Something went wrong. Try again.")
		return
	}
	hash := h.dummyHash
	if ok {
		hash = []byte(acct.AuthHash)
	}
	if bcrypt.CompareHashAndPassword(hash, []byte(req.AuthKey)) != nil || !ok {
		h.fail(email)
		writeError(w, http.StatusUnauthorized, genericLoginErr)
		return
	}
	h.clear(email)
	writeJSON(w, http.StatusOK, loginResponse{PubKey: acct.PubKey, Ncryptsec: acct.Ncryptsec})
}

// ---- brute-force protection (in memory; resets on restart) ----

func (h *Handler) locked(email string) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	a := h.failures[email]
	if a == nil {
		return false
	}
	if time.Since(a.since) > attemptWindow {
		delete(h.failures, email)
		return false
	}
	return a.count >= maxAttempts
}

func (h *Handler) fail(email string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	a := h.failures[email]
	if a == nil || time.Since(a.since) > attemptWindow {
		a = &attempts{since: time.Now()}
		h.failures[email] = a
	}
	a.count++
}

func (h *Handler) clear(email string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	delete(h.failures, email)
}

// ---- helpers ----

func normalizeEmail(s string) string { return strings.ToLower(strings.TrimSpace(s)) }

func validEmail(s string) bool { return len(s) <= maxEmail && emailPattern.MatchString(s) }

func validPubKey(s string) bool {
	if !hex64.MatchString(s) {
		return false
	}
	b, _ := hex.DecodeString(s)
	_, err := schnorr.ParsePubKey(b)
	return err == nil
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}
