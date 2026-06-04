package adapter

import (
	"os"
	"path/filepath"
)

// agentConfigPaths are repo-resident files/dirs that coding agents treat as
// trusted INSTRUCTIONS. On an untrusted clone they're an injection vector, so we
// move them aside for the duration of the run.
var agentConfigPaths = []string{
	".claude", "CLAUDE.md", "AGENTS.md", ".cursorrules", ".cursor",
	".github/copilot-instructions.md", ".aider.conf.yml", ".windsurfrules",
}

// quarantineRepoConfig moves any agent-instruction files in repoDir into a
// sibling temp dir and returns a restore func that moves them back (so the
// committed tree/diff is unchanged). Best-effort: missing paths are skipped.
func quarantineRepoConfig(repoDir string) (func(), error) {
	stash, err := os.MkdirTemp("", "acp-quarantine-*")
	if err != nil {
		return func() {}, err
	}
	type moved struct{ from, to string }
	var movedItems []moved
	for _, rel := range agentConfigPaths {
		src := filepath.Join(repoDir, rel)
		if _, err := os.Lstat(src); err != nil {
			continue // not present
		}
		dst := filepath.Join(stash, filepath.Base(rel)+"-"+sanitize(rel))
		if err := os.MkdirAll(filepath.Dir(dst), 0o700); err != nil {
			continue
		}
		if err := os.Rename(src, dst); err == nil {
			movedItems = append(movedItems, moved{from: src, to: dst})
		}
	}
	restore := func() {
		for _, m := range movedItems {
			_ = os.MkdirAll(filepath.Dir(m.from), 0o755)
			_ = os.Rename(m.to, m.from)
		}
		_ = os.RemoveAll(stash)
	}
	return restore, nil
}

// sanitize makes a relative path safe as a single filename component.
func sanitize(rel string) string {
	out := make([]rune, 0, len(rel))
	for _, r := range rel {
		if r == '/' || r == '\\' || r == filepath.Separator {
			out = append(out, '_')
		} else {
			out = append(out, r)
		}
	}
	return string(out)
}
