package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadDotEnv(t *testing.T) {
	path := filepath.Join(t.TempDir(), ".env")
	os.WriteFile(path, []byte(`# comment
STOOGES_TEST_PLAIN=abc
export STOOGES_TEST_EXPORTED = "quoted value"
STOOGES_TEST_SINGLE='single'
STOOGES_TEST_SHELL=from-file
not a variable line
`), 0o600)
	t.Setenv("STOOGES_TEST_SHELL", "from-shell")
	for _, k := range []string{"STOOGES_TEST_PLAIN", "STOOGES_TEST_EXPORTED", "STOOGES_TEST_SINGLE"} {
		t.Setenv(k, "")
		os.Unsetenv(k)
	}

	if err := LoadDotEnv(path); err != nil {
		t.Fatal(err)
	}
	want := map[string]string{
		"STOOGES_TEST_PLAIN":    "abc",
		"STOOGES_TEST_EXPORTED": "quoted value",
		"STOOGES_TEST_SINGLE":   "single",
		"STOOGES_TEST_SHELL":    "from-shell", // shell wins over the file
	}
	for k, v := range want {
		if got := os.Getenv(k); got != v {
			t.Errorf("%s = %q, want %q", k, got, v)
		}
	}
	if err := LoadDotEnv(filepath.Join(t.TempDir(), "missing")); err != nil {
		t.Errorf("missing file should be fine, got %v", err)
	}
}
