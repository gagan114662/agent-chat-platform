package sandbox

import (
	"testing"
	"time"
)

func TestLimitsFromEnvDefaults(t *testing.T) {
	// No env set: expect documented defaults.
	t.Setenv("ACP_RUN_TIMEOUT_SEC", "")
	t.Setenv("ACP_MAX_CONCURRENT_RUNS", "")
	t.Setenv("ACP_CLONE_DEPTH", "")
	t.Setenv("ACP_MAX_REPO_BYTES", "")

	l := LimitsFromEnv()
	if l.Timeout != 600*time.Second {
		t.Fatalf("Timeout = %v, want 600s", l.Timeout)
	}
	if l.MaxConcurrent != 8 {
		t.Fatalf("MaxConcurrent = %d, want 8", l.MaxConcurrent)
	}
	if l.CloneDepth != 1 {
		t.Fatalf("CloneDepth = %d, want 1", l.CloneDepth)
	}
	if l.MaxRepoBytes != 1<<30 {
		t.Fatalf("MaxRepoBytes = %d, want %d", l.MaxRepoBytes, int64(1<<30))
	}
}

func TestLimitsFromEnvOverrides(t *testing.T) {
	t.Setenv("ACP_RUN_TIMEOUT_SEC", "30")
	t.Setenv("ACP_MAX_CONCURRENT_RUNS", "3")
	t.Setenv("ACP_CLONE_DEPTH", "0")
	t.Setenv("ACP_MAX_REPO_BYTES", "1024")

	l := LimitsFromEnv()
	if l.Timeout != 30*time.Second {
		t.Fatalf("Timeout = %v, want 30s", l.Timeout)
	}
	if l.MaxConcurrent != 3 {
		t.Fatalf("MaxConcurrent = %d, want 3", l.MaxConcurrent)
	}
	if l.CloneDepth != 0 {
		t.Fatalf("CloneDepth = %d, want 0", l.CloneDepth)
	}
	if l.MaxRepoBytes != 1024 {
		t.Fatalf("MaxRepoBytes = %d, want 1024", l.MaxRepoBytes)
	}
}

func TestSemaphore(t *testing.T) {
	s := newSemaphore(2)
	if !s.tryAcquire() {
		t.Fatal("first tryAcquire should succeed")
	}
	if !s.tryAcquire() {
		t.Fatal("second tryAcquire should succeed")
	}
	if s.tryAcquire() {
		t.Fatal("third tryAcquire should fail (cap reached)")
	}
	s.release()
	if !s.tryAcquire() {
		t.Fatal("after release, tryAcquire should succeed again")
	}
}
