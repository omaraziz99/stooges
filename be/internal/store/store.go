// Package store persists events and channels in SQLite.
package store

import (
	"cmp"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	_ "modernc.org/sqlite" // pure-Go SQLite driver, no cgo needed

	"stooges/be/internal/nostr"
)

const (
	defaultLimit = 500
	maxLimit     = 1000
)

// ErrGroupExists is returned when creating a channel whose ID is taken.
var ErrGroupExists = errors.New("group already exists")

const schema = `
CREATE TABLE IF NOT EXISTS events (
	id         TEXT PRIMARY KEY,
	pubkey     TEXT    NOT NULL,
	created_at INTEGER NOT NULL,
	kind       INTEGER NOT NULL,
	tags       TEXT    NOT NULL,
	content    TEXT    NOT NULL,
	sig        TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS events_kind_created ON events(kind, created_at);
CREATE INDEX IF NOT EXISTS events_pubkey_kind ON events(pubkey, kind);

-- Single-letter tags are indexed so REQ filters like {"#h": [...]} are fast.
CREATE TABLE IF NOT EXISTS event_tags (
	event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
	name     TEXT NOT NULL,
	value    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS event_tags_name_value ON event_tags(name, value);
CREATE INDEX IF NOT EXISTS event_tags_event ON event_tags(event_id);

CREATE TABLE IF NOT EXISTS groups (
	id         TEXT PRIMARY KEY,
	name       TEXT    NOT NULL,
	about      TEXT    NOT NULL DEFAULT '',
	created_by TEXT    NOT NULL,
	created_at INTEGER NOT NULL
);

-- Email accounts. The chat key is stored only encrypted with the user's
-- password (NIP-49 ncryptsec), and the login secret only as a bcrypt hash.
CREATE TABLE IF NOT EXISTS accounts (
	email      TEXT PRIMARY KEY,
	pubkey     TEXT    NOT NULL UNIQUE,
	auth_hash  TEXT    NOT NULL,
	ncryptsec  TEXT    NOT NULL,
	role       TEXT    NOT NULL DEFAULT 'employee', -- account type: employee or manager
	created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS relay_meta (
	key   TEXT PRIMARY KEY,
	value TEXT NOT NULL
);
`

// Store wraps the SQLite database.
type Store struct {
	db *sql.DB
}

// Open opens (or creates) the database at path and applies the schema.
func Open(path string) (*Store, error) {
	dsn := "file:" + path +
		"?_pragma=foreign_keys(1)&_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)"
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	// One writer keeps SQLite simple and avoids "database is locked" errors.
	db.SetMaxOpenConns(1)
	if _, err := db.Exec(schema); err != nil {
		db.Close()
		return nil, fmt.Errorf("apply schema: %w", err)
	}
	// Databases created before these features lack their columns.
	for _, col := range []string{
		`ALTER TABLE groups ADD COLUMN kpi_review INTEGER NOT NULL DEFAULT 0`,
		`ALTER TABLE accounts ADD COLUMN role TEXT NOT NULL DEFAULT 'employee'`,
	} {
		if _, err := db.Exec(col); err != nil && !strings.Contains(err.Error(), "duplicate column") {
			db.Close()
			return nil, fmt.Errorf("apply schema: %w", err)
		}
	}
	return &Store{db: db}, nil
}

// Close closes the database.
func (s *Store) Close() error { return s.db.Close() }

// Save stores an event. It returns false without error when the event is a
// duplicate, or when a newer version of a replaceable event is already stored.
func (s *Store) Save(ctx context.Context, e *nostr.Event) (bool, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return false, err
	}
	defer tx.Rollback()

	if nostr.IsReplaceable(e.Kind) || nostr.IsAddressable(e.Kind) {
		newer, err := replaceOlder(ctx, tx, e)
		if err != nil || newer {
			return false, err
		}
	}

	tags, err := json.Marshal(e.Tags)
	if err != nil {
		return false, err
	}
	res, err := tx.ExecContext(ctx,
		`INSERT OR IGNORE INTO events (id, pubkey, created_at, kind, tags, content, sig)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		e.ID, e.PubKey, e.CreatedAt, e.Kind, string(tags), e.Content, e.Sig)
	if err != nil {
		return false, err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return false, nil // duplicate
	}
	for _, t := range e.Tags {
		if len(t) >= 2 && len(t[0]) == 1 {
			if _, err := tx.ExecContext(ctx,
				`INSERT INTO event_tags (event_id, name, value) VALUES (?, ?, ?)`,
				e.ID, t[0], t[1]); err != nil {
				return false, err
			}
		}
	}
	return true, tx.Commit()
}

// replaceOlder deletes older versions of a replaceable event. It reports
// true when a newer (or same-age) version already exists, so e should be dropped.
func replaceOlder(ctx context.Context, tx *sql.Tx, e *nostr.Event) (bool, error) {
	query := `SELECT id, created_at FROM events WHERE pubkey = ? AND kind = ?`
	args := []any{e.PubKey, e.Kind}
	if nostr.IsAddressable(e.Kind) {
		query += ` AND id IN (SELECT event_id FROM event_tags WHERE name = 'd' AND value = ?)`
		args = append(args, e.TagValue("d"))
	}
	rows, err := tx.QueryContext(ctx, query, args...)
	if err != nil {
		return false, err
	}
	var older []string
	for rows.Next() {
		var id string
		var created int64
		if err := rows.Scan(&id, &created); err != nil {
			rows.Close()
			return false, err
		}
		if created >= e.CreatedAt {
			rows.Close()
			return true, nil
		}
		older = append(older, id)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return false, err
	}
	for _, id := range older {
		if _, err := tx.ExecContext(ctx, `DELETE FROM events WHERE id = ?`, id); err != nil {
			return false, err
		}
	}
	return false, nil
}

// DeleteOwn deletes the given events, but only those authored by pubkey.
func (s *Store) DeleteOwn(ctx context.Context, ids []string, pubkey string) (int64, error) {
	if len(ids) == 0 {
		return 0, nil
	}
	args := []any{pubkey}
	for _, id := range ids {
		args = append(args, id)
	}
	res, err := s.db.ExecContext(ctx,
		`DELETE FROM events WHERE pubkey = ? AND id IN (`+placeholders(len(ids))+`)`, args...)
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}

// Query returns events matching the filter, newest first.
func (s *Store) Query(ctx context.Context, f nostr.Filter) ([]nostr.Event, error) {
	var where []string
	var args []any
	if len(f.IDs) > 0 {
		where = append(where, "e.id IN ("+placeholders(len(f.IDs))+")")
		args = appendStrings(args, f.IDs)
	}
	if len(f.Authors) > 0 {
		where = append(where, "e.pubkey IN ("+placeholders(len(f.Authors))+")")
		args = appendStrings(args, f.Authors)
	}
	if len(f.Kinds) > 0 {
		where = append(where, "e.kind IN ("+placeholders(len(f.Kinds))+")")
		for _, k := range f.Kinds {
			args = append(args, k)
		}
	}
	if f.Since != nil {
		where = append(where, "e.created_at >= ?")
		args = append(args, *f.Since)
	}
	if f.Until != nil {
		where = append(where, "e.created_at <= ?")
		args = append(args, *f.Until)
	}
	for name, vals := range f.Tags {
		if len(vals) == 0 {
			continue
		}
		where = append(where, "EXISTS (SELECT 1 FROM event_tags t WHERE t.event_id = e.id AND t.name = ? AND t.value IN ("+placeholders(len(vals))+"))")
		args = append(args, name)
		args = appendStrings(args, vals)
	}

	limit := f.Limit
	if limit <= 0 {
		limit = defaultLimit
	}
	limit = min(limit, maxLimit)

	query := `SELECT e.id, e.pubkey, e.created_at, e.kind, e.tags, e.content, e.sig FROM events e`
	if len(where) > 0 {
		query += " WHERE " + strings.Join(where, " AND ")
	}
	query += " ORDER BY e.created_at DESC, e.id LIMIT ?"
	args = append(args, limit)

	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []nostr.Event
	for rows.Next() {
		var e nostr.Event
		var tags string
		if err := rows.Scan(&e.ID, &e.PubKey, &e.CreatedAt, &e.Kind, &tags, &e.Content, &e.Sig); err != nil {
			return nil, err
		}
		if err := json.Unmarshal([]byte(tags), &e.Tags); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// Group is a channel.
type Group struct {
	ID        string
	Name      string
	About     string
	CreatedBy string
	KPIReview bool // a work channel the KPI agent may read

}

// CreateGroup records a new channel. It returns ErrGroupExists if the ID is taken.
func (s *Store) CreateGroup(ctx context.Context, g Group, createdAt int64) error {
	res, err := s.db.ExecContext(ctx,
		`INSERT OR IGNORE INTO groups (id, name, about, created_by, created_at, kpi_review) VALUES (?, ?, ?, ?, ?, ?)`,
		g.ID, g.Name, g.About, g.CreatedBy, createdAt, g.KPIReview)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrGroupExists
	}
	return nil
}

// GetGroup returns a channel; ok is false if it does not exist.
func (s *Store) GetGroup(ctx context.Context, id string) (g Group, ok bool, err error) {
	err = s.db.QueryRowContext(ctx,
		`SELECT id, name, about, created_by, kpi_review FROM groups WHERE id = ?`, id).
		Scan(&g.ID, &g.Name, &g.About, &g.CreatedBy, &g.KPIReview)
	if errors.Is(err, sql.ErrNoRows) {
		return g, false, nil
	}
	return g, err == nil, err
}

// SetGroupKPIReview turns KPI review of a channel on or off.
func (s *Store) SetGroupKPIReview(ctx context.Context, id string, on bool) error {
	_, err := s.db.ExecContext(ctx, `UPDATE groups SET kpi_review = ? WHERE id = ?`, on, id)
	return err
}

// DeleteGroup removes a channel, its metadata and every event posted in it.
// It returns how many events were deleted.
func (s *Store) DeleteGroup(ctx context.Context, id string) (int64, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	res, err := tx.ExecContext(ctx, `DELETE FROM events WHERE id IN (
		SELECT event_id FROM event_tags WHERE name = 'h' AND value = ?
		UNION
		SELECT t.event_id FROM event_tags t JOIN events e ON e.id = t.event_id
		 WHERE t.name = 'd' AND t.value = ? AND e.kind = ?)`, id, id, nostr.KindGroupMetadata)
	if err != nil {
		return 0, err
	}
	n, _ := res.RowsAffected()
	if _, err := tx.ExecContext(ctx, `DELETE FROM groups WHERE id = ?`, id); err != nil {
		return 0, err
	}
	return n, tx.Commit()
}

// GroupExists reports whether a channel with the given ID exists.
func (s *Store) GroupExists(ctx context.Context, id string) (bool, error) {
	var one int
	err := s.db.QueryRowContext(ctx, `SELECT 1 FROM groups WHERE id = ?`, id).Scan(&one)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	return err == nil, err
}

// ErrAccountExists is returned when the email (or key) is already registered.
var ErrAccountExists = errors.New("account already exists")

// Account types. Everyone who signs up is an employee; only the server makes
// managers, who may read everyone's KPI report.
const (
	RoleEmployee = "employee"
	RoleManager  = "manager"
)

// Account is a stored email account.
type Account struct {
	Email     string
	PubKey    string
	AuthHash  string // bcrypt hash of the client-derived login secret
	Ncryptsec string // the user's chat key, encrypted with their password
	Role      string // RoleEmployee (the default) or RoleManager
}

// CreateAccount stores a new account. It returns ErrAccountExists if the
// email or public key is taken.
func (s *Store) CreateAccount(ctx context.Context, a Account, createdAt int64) error {
	res, err := s.db.ExecContext(ctx,
		`INSERT OR IGNORE INTO accounts (email, pubkey, auth_hash, ncryptsec, role, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
		a.Email, a.PubKey, a.AuthHash, a.Ncryptsec, cmp.Or(a.Role, RoleEmployee), createdAt)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrAccountExists
	}
	return nil
}

// GetAccount looks up an account by email; ok is false if there is none.
func (s *Store) GetAccount(ctx context.Context, email string) (a Account, ok bool, err error) {
	err = s.db.QueryRowContext(ctx,
		`SELECT email, pubkey, auth_hash, ncryptsec, role FROM accounts WHERE email = ?`, email).
		Scan(&a.Email, &a.PubKey, &a.AuthHash, &a.Ncryptsec, &a.Role)
	if errors.Is(err, sql.ErrNoRows) {
		return Account{}, false, nil
	}
	return a, err == nil, err
}

// SetRole changes an account's type; ok is false if there is no such account.
func (s *Store) SetRole(ctx context.Context, email, role string) (ok bool, err error) {
	res, err := s.db.ExecContext(ctx, `UPDATE accounts SET role = ? WHERE email = ?`, role, email)
	if err != nil {
		return false, err
	}
	n, _ := res.RowsAffected()
	return n > 0, nil
}

// IsManager reports whether the account with this public key is a manager.
func (s *Store) IsManager(ctx context.Context, pubkey string) (bool, error) {
	var n int
	err := s.db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM accounts WHERE pubkey = ? AND role = ?`, pubkey, RoleManager).Scan(&n)
	return n > 0, err
}

// GetMeta reads a relay setting; ok is false if it is not set.
func (s *Store) GetMeta(ctx context.Context, key string) (value string, ok bool, err error) {
	err = s.db.QueryRowContext(ctx, `SELECT value FROM relay_meta WHERE key = ?`, key).Scan(&value)
	if errors.Is(err, sql.ErrNoRows) {
		return "", false, nil
	}
	return value, err == nil, err
}

// SetMeta writes a relay setting.
func (s *Store) SetMeta(ctx context.Context, key, value string) error {
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO relay_meta (key, value) VALUES (?, ?)
		 ON CONFLICT(key) DO UPDATE SET value = excluded.value`, key, value)
	return err
}

func placeholders(n int) string {
	return strings.TrimSuffix(strings.Repeat("?,", n), ",")
}

func appendStrings(args []any, vals []string) []any {
	for _, v := range vals {
		args = append(args, v)
	}
	return args
}
