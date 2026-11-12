package accounts

// The browser's half of an account, in Go, so the seed can create demo
// accounts that the app logs into like any other. It must match
// fe/src/lib/auth.ts exactly.

import (
	"context"
	"crypto/pbkdf2"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/btcsuite/btcd/btcec/v2"
	"golang.org/x/crypto/bcrypt"
	"golang.org/x/crypto/chacha20poly1305"
	"golang.org/x/crypto/scrypt"

	"stooges/be/internal/nostr"
	"stooges/be/internal/store"
)

// Provision creates an email account for an existing chat key, exactly as
// signing up in the app would, and sets its type. If the seed made the account
// before, its password and type are reset, so re-running is safe and the seed
// file's password always works. created reports whether a new account was made.
func Provision(ctx context.Context, st *store.Store, email, password string, priv *btcec.PrivateKey, role string) (created bool, err error) {
	email = normalizeEmail(email)
	if !validEmail(email) {
		return false, fmt.Errorf("invalid email %q", email)
	}
	if len(password) < 8 {
		return false, fmt.Errorf("password for %s is shorter than 8 characters", email)
	}
	existing, exists, err := st.GetAccount(ctx, email)
	if err != nil {
		return false, err
	}
	if exists && existing.PubKey != nostr.PubKeyHex(priv) {
		return false, fmt.Errorf("%s already belongs to a different account; not changing it", email)
	}
	authKey, err := AuthKey(email, password)
	if err != nil {
		return false, err
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(authKey), bcrypt.DefaultCost)
	if err != nil {
		return false, err
	}
	ncryptsec, err := EncryptKey(priv.Serialize(), password)
	if err != nil {
		return false, err
	}
	// Already there (an earlier seed): reset its password and type, so the
	// password in the seed file always works.
	if exists {
		_, err := st.SetCredentials(ctx, email, string(hash), ncryptsec, role)
		return false, err
	}
	acct := store.Account{Email: email, PubKey: nostr.PubKeyHex(priv), AuthHash: string(hash), Ncryptsec: ncryptsec, Role: role}
	err = st.CreateAccount(ctx, acct, time.Now().Unix())
	if errors.Is(err, store.ErrAccountExists) {
		return false, fmt.Errorf("%s: that chat key already belongs to another account", email)
	}
	return err == nil, err
}

const pbkdf2Iterations = 600_000

// AuthKey is the login secret the browser derives from a password:
// hex(PBKDF2-SHA256(password, "stooges-auth:"+email, 600000, 32 bytes)).
func AuthKey(email, password string) (string, error) {
	key, err := pbkdf2.Key(sha256.New, password, []byte("stooges-auth:"+normalizeEmail(email)), pbkdf2Iterations, 32)
	if err != nil {
		return "", err
	}
	return hex.EncodeToString(key), nil
}

// EncryptKey encrypts a 32-byte secret key with a password as a NIP-49
// ncryptsec, with the same settings as nostr-tools (scrypt log_n 16, key
// security byte 0x02). NIP-49 asks for an NFKC-normalised password; callers
// pass ASCII passwords, for which that is a no-op.
func EncryptKey(secret []byte, password string) (string, error) {
	if len(secret) != 32 {
		return "", fmt.Errorf("secret key must be 32 bytes, got %d", len(secret))
	}
	const logN = 16
	salt := make([]byte, 16)
	nonce := make([]byte, chacha20poly1305.NonceSizeX)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	if _, err := rand.Read(nonce); err != nil {
		return "", err
	}
	key, err := scrypt.Key([]byte(password), salt, 1<<logN, 8, 1, 32)
	if err != nil {
		return "", err
	}
	aead, err := chacha20poly1305.NewX(key)
	if err != nil {
		return "", err
	}
	keySecurity := []byte{0x02} // "unknown": the client-side handling isn't known
	payload := []byte{0x02, logN}
	payload = append(payload, salt...)
	payload = append(payload, nonce...)
	payload = append(payload, keySecurity...)
	payload = aead.Seal(payload, nonce, secret, keySecurity)
	return bech32Encode("ncryptsec", payload)
}

// bech32Encode is BIP-173 bech32 without the 90-character limit, which
// ncryptsec exceeds (as nostr-tools also allows).
func bech32Encode(hrp string, data []byte) (string, error) {
	const charset = "qpzry9x8gf2tvdw0s3jn54khce6mua7l"
	// Regroup 8-bit bytes into 5-bit words, padding the last.
	var words []byte
	acc, bits := 0, 0
	for _, b := range data {
		acc = acc<<8 | int(b)
		bits += 8
		for bits >= 5 {
			bits -= 5
			words = append(words, byte(acc>>bits&31))
		}
	}
	if bits > 0 {
		words = append(words, byte(acc<<(5-bits)&31))
	}

	polymod := func(values []byte) uint32 {
		gen := [5]uint32{0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3}
		chk := uint32(1)
		for _, v := range values {
			top := chk >> 25
			chk = (chk&0x1ffffff)<<5 ^ uint32(v)
			for i := range 5 {
				if top>>i&1 == 1 {
					chk ^= gen[i]
				}
			}
		}
		return chk
	}
	var expanded []byte
	for _, c := range hrp {
		expanded = append(expanded, byte(c>>5))
	}
	expanded = append(expanded, 0)
	for _, c := range hrp {
		expanded = append(expanded, byte(c&31))
	}
	values := append(append(expanded, words...), 0, 0, 0, 0, 0, 0)
	mod := polymod(values) ^ 1

	var sb strings.Builder
	sb.WriteString(hrp)
	sb.WriteByte('1')
	for _, w := range words {
		sb.WriteByte(charset[w])
	}
	for i := range 6 {
		sb.WriteByte(charset[mod>>(5*(5-i))&31])
	}
	return sb.String(), nil
}
