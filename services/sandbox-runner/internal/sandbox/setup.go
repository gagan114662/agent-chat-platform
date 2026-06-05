package sandbox

import (
	"bufio"
	"context"
	"io"
	"os"
	"os/exec"
)

// runSetupScript runs the per-repo, admin-configured setup script in repoDir
// after clone and BEFORE the agent. The script is trusted repo config (never
// cloned-repo content), so there is no charset validation — it is a shell
// script by design. An empty script is a no-op (today's behavior unchanged).
//
// Combined stdout+stderr is streamed line-by-line to onLine (same pattern as
// the CLI adapters). A non-zero exit returns an error so the caller can fail
// the run before the agent. The command honors ctx (the #50 timeout/cancel).
//
// env carries the per-repo, admin-configured environment variables (#73) so the
// build/deps step sees them (e.g. private registry tokens). They are appended
// after the inherited process env, so a configured key overrides it — an
// intentional admin override. nil/empty env = today's behavior (inherited env).
func runSetupScript(ctx context.Context, repoDir, script string, env map[string]string, onLine func(string)) error {
	if script == "" {
		return nil
	}
	cmd := exec.CommandContext(ctx, "bash", "-lc", script)
	if repoDir != "" {
		cmd.Dir = repoDir
	}
	if len(env) > 0 {
		cmdEnv := os.Environ()
		for k, v := range env {
			cmdEnv = append(cmdEnv, k+"="+v)
		}
		cmd.Env = cmdEnv
	}
	pr, pw := io.Pipe()
	cmd.Stdout = pw
	cmd.Stderr = pw
	if err := cmd.Start(); err != nil {
		return err
	}
	done := make(chan struct{})
	go func() {
		sc := bufio.NewScanner(pr)
		sc.Buffer(make([]byte, 64*1024), 1024*1024)
		for sc.Scan() {
			if onLine != nil {
				onLine(sc.Text())
			}
		}
		close(done)
	}()
	runErr := cmd.Wait()
	_ = pw.Close()
	<-done
	return runErr
}
