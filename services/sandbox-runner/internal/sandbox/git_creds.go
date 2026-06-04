package sandbox

import "net/url"

type gitCred struct {
	cleanURL string   // URL with the password stripped (safe for argv)
	args     []string // prepended before the git subcommand (no secret)
	env      []string // carries the secret out-of-argv (process env only)
}

// newGitCred splits any userinfo password out of repoURL so it never appears in
// argv. The token is passed via the ACP_GIT_TOKEN env to an inline credential
// helper; the helper string itself contains no secret. If there's no password,
// it's a no-op (clean URL == input, no args/env).
func newGitCred(repoURL string) gitCred {
	u, err := url.Parse(repoURL)
	if err != nil || u.User == nil {
		return gitCred{cleanURL: repoURL}
	}
	pass, ok := u.User.Password()
	if !ok || pass == "" {
		return gitCred{cleanURL: repoURL}
	}
	user := u.User.Username()
	if user == "" {
		user = "x-access-token"
	}
	u.User = url.User(user) // keep username (not secret), drop password
	helper := "!f() { test \"$1\" = get && echo username=" + user + " && echo password=$ACP_GIT_TOKEN; }; f"
	return gitCred{
		cleanURL: u.String(),
		args:     []string{"-c", "credential.helper=" + helper},
		env:      []string{"ACP_GIT_TOKEN=" + pass, "GIT_TERMINAL_PROMPT=0"},
	}
}
