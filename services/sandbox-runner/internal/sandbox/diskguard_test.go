package sandbox

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"
)

func TestCheckRepoSize(t *testing.T) {
	dir := t.TempDir()
	const n = 4096
	if err := os.WriteFile(filepath.Join(dir, "big.bin"), bytes.Repeat([]byte("x"), n), 0o644); err != nil {
		t.Fatal(err)
	}

	// Limit just below the file size: must error.
	if err := checkRepoSize(dir, n-1); err == nil {
		t.Fatalf("expected size-limit error for maxBytes=%d", n-1)
	}

	// Limit comfortably above: no error.
	if err := checkRepoSize(dir, n+1<<20); err != nil {
		t.Fatalf("expected no error for generous limit, got %v", err)
	}

	// Zero disables the check.
	if err := checkRepoSize(dir, 0); err != nil {
		t.Fatalf("expected no error when disabled (maxBytes=0), got %v", err)
	}
}
