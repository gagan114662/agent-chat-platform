package sandbox

import (
	"os"
	"strconv"
	"time"
)

// Limits are the resource bounds for a sandbox run, read from env (all optional).
type Limits struct {
	Timeout       time.Duration // ACP_RUN_TIMEOUT_SEC (default 600s)
	MaxConcurrent int           // ACP_MAX_CONCURRENT_RUNS (default 8)
	CloneDepth    int           // ACP_CLONE_DEPTH (default 1; 0 = full clone)
	MaxRepoBytes  int64         // ACP_MAX_REPO_BYTES (default 1<<30 = 1 GiB; 0 = unlimited)
}

func envInt(key string, def int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return def
}

func LimitsFromEnv() Limits {
	return Limits{
		Timeout:       time.Duration(envInt("ACP_RUN_TIMEOUT_SEC", 600)) * time.Second,
		MaxConcurrent: envInt("ACP_MAX_CONCURRENT_RUNS", 8),
		CloneDepth:    envInt("ACP_CLONE_DEPTH", 1),
		MaxRepoBytes:  int64(envInt("ACP_MAX_REPO_BYTES", 1<<30)),
	}
}

// semaphore bounds concurrent runs. tryAcquire is non-blocking.
type semaphore chan struct{}

func newSemaphore(n int) semaphore {
	if n < 1 {
		n = 1
	}
	return make(semaphore, n)
}
func (s semaphore) tryAcquire() bool {
	select {
	case s <- struct{}{}:
		return true
	default:
		return false
	}
}
func (s semaphore) release() { <-s }
