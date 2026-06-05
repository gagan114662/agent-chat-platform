package sandbox

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os"
	"os/exec"
	"strings"
)

// maxCommandBytes caps the command string length (defense-in-depth on top of the
// request-body MaxBytesReader). A command is a shell line, not a payload.
const maxCommandBytes = 64 * 1024

// maxExecOutputBytes caps the combined stdout+stderr captured from the command so
// a runaway command can't balloon the response.
const maxExecOutputBytes = 1 << 20 // 1 MiB

// ExecRequest runs an arbitrary shell command in a fresh clone of a repo. It is
// arbitrary code execution by design, so the HTTP handler default-denies it
// (ACP_ALLOW_EXEC) and the app route is admin-gated. The clone is discarded —
// /exec never commits or pushes.
type ExecRequest struct {
	RepoURL    string `json:"repoUrl"`
	BaseBranch string `json:"baseBranch"`
	Command    string `json:"command"`
	// Env is the per-repo, admin-configured environment applied to the command
	// (parity with #73). Optional; nil/empty = inherited env only. Trusted repo
	// config only (never cloned content).
	Env     map[string]string `json:"env,omitempty"`
	WorkDir string            `json:"-"`
}

// ExecResult carries the combined output and the command's exit code.
type ExecResult struct {
	Output   string `json:"output"`
	ExitCode int    `json:"exitCode"`
}

// Validate checks the request before any git command is shelled out. Mirrors
// RunRequest's scheme/ref gates (no Branch — exec never pushes) and additionally
// requires a non-empty, length-capped command.
func (r ExecRequest) Validate() error {
	if r.RepoURL == "" {
		return errors.New("repoUrl required")
	}
	if strings.HasPrefix(r.RepoURL, "-") {
		return errors.New("repoUrl must not start with '-'")
	}
	u, err := url.Parse(r.RepoURL)
	if err != nil {
		return fmt.Errorf("repoUrl invalid: %w", err)
	}
	switch u.Scheme {
	case "http", "https", "ssh", "git":
		if u.Host == "" {
			return fmt.Errorf("repoUrl scheme %q requires a host", u.Scheme)
		}
	case "file":
		if os.Getenv("ACP_ALLOW_FILE_REPO") != "1" {
			return errors.New("repoUrl scheme \"file\" not allowed (set ACP_ALLOW_FILE_REPO=1)")
		}
	default:
		return fmt.Errorf("repoUrl scheme %q not allowed", u.Scheme)
	}
	if r.Command == "" {
		return errors.New("command required")
	}
	if len(r.Command) > maxCommandBytes {
		return fmt.Errorf("command exceeds %d bytes", maxCommandBytes)
	}
	return validRef(r.BaseBranch, "baseBranch")
}

// Exec shallow-clones the base branch, size-checks it, then runs `bash -lc
// <command>` in the workdir, capturing combined stdout+stderr (capped at
// maxExecOutputBytes) and the exit code. The clone is discarded — exec never
// commits or pushes. A non-zero command exit is NOT an error: it is reported in
// ExecResult.ExitCode (the runner succeeded; the command failed). An error is
// only returned when the command could not be run (clone/size/start failure).
func Exec(ctx context.Context, req ExecRequest, limits Limits) (ExecResult, error) {
	if err := CloneIntoDepth(ctx, req.RepoURL, req.BaseBranch, req.WorkDir, limits.CloneDepth); err != nil {
		return ExecResult{}, fmt.Errorf("clone: %w", err)
	}
	if err := checkRepoSize(req.WorkDir, limits.MaxRepoBytes); err != nil {
		return ExecResult{}, err
	}

	cmd := exec.CommandContext(ctx, "bash", "-lc", req.Command)
	cmd.Dir = req.WorkDir
	if len(req.Env) > 0 {
		cmdEnv := os.Environ()
		for k, v := range req.Env {
			cmdEnv = append(cmdEnv, k+"="+v)
		}
		cmd.Env = cmdEnv
	}

	pr, pw := io.Pipe()
	cmd.Stdout = pw
	cmd.Stderr = pw
	if err := cmd.Start(); err != nil {
		return ExecResult{}, fmt.Errorf("exec start: %w", err)
	}

	var sb strings.Builder
	done := make(chan struct{})
	go func() {
		// Byte-cap the captured output: keep reading (so the pipe never blocks the
		// command) but stop appending once the cap is reached.
		sc := bufio.NewScanner(pr)
		sc.Buffer(make([]byte, 64*1024), 1024*1024)
		for sc.Scan() {
			line := sc.Text()
			if sb.Len() < maxExecOutputBytes {
				remaining := maxExecOutputBytes - sb.Len()
				if len(line)+1 > remaining {
					sb.WriteString(line[:min(len(line), remaining)])
				} else {
					sb.WriteString(line)
					sb.WriteByte('\n')
				}
			}
		}
		close(done)
	}()

	runErr := cmd.Wait()
	_ = pw.Close()
	<-done

	exitCode := 0
	if runErr != nil {
		var ee *exec.ExitError
		if errors.As(runErr, &ee) {
			exitCode = ee.ExitCode()
		} else {
			// Not a clean process exit (ctx timeout, signal, pipe error): surface it.
			return ExecResult{}, fmt.Errorf("exec: %w", runErr)
		}
	}
	return ExecResult{Output: sb.String(), ExitCode: exitCode}, nil
}
