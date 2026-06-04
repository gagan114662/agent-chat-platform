package adapter

import (
	"embed"
	"io/fs"
	"os"
	"path/filepath"
)

//go:embed builtin_skills
var builtinSkills embed.FS

// provisionBuiltinSkills writes the trusted built-in skill set into
// repoDir/.claude/skills/ so the agent has them for this run, and returns a
// cleanup that removes exactly what it wrote (so the committed tree is clean).
// Source: the embedded set, or ACP_BUILTIN_SKILLS_DIR if set. Call AFTER
// quarantineRepoConfig (which moves the repo's own .claude aside).
func provisionBuiltinSkills(repoDir string) (func(), error) {
	dst := filepath.Join(repoDir, ".claude", "skills")
	written := []string{} // top-level skill dirs we created, for cleanup
	cleanup := func() {
		for _, d := range written {
			_ = os.RemoveAll(d)
		}
		// prune now-empty .claude/skills and .claude if we created them
		_ = os.Remove(dst)
		_ = os.Remove(filepath.Join(repoDir, ".claude"))
	}

	if dir := os.Getenv("ACP_BUILTIN_SKILLS_DIR"); dir != "" {
		return provisionFromDir(os.DirFS(dir), dst, &written, cleanup)
	}
	sub, err := fs.Sub(builtinSkills, "builtin_skills")
	if err != nil {
		return func() {}, err
	}
	return provisionFromDir(sub, dst, &written, cleanup)
}

func provisionFromDir(src fs.FS, dst string, written *[]string, cleanup func()) (func(), error) {
	if err := os.MkdirAll(dst, 0o755); err != nil {
		return func() {}, err
	}
	err := fs.WalkDir(src, ".", func(p string, d fs.DirEntry, err error) error {
		if err != nil || p == "." {
			return err
		}
		target := filepath.Join(dst, p)
		if d.IsDir() {
			// remember top-level skill dirs for cleanup
			if filepath.Dir(p) == "." {
				*written = append(*written, target)
			}
			return os.MkdirAll(target, 0o755)
		}
		b, err := fs.ReadFile(src, p)
		if err != nil {
			return err
		}
		return os.WriteFile(target, b, 0o644)
	})
	if err != nil {
		cleanup()
		return func() {}, err
	}
	return cleanup, nil
}
