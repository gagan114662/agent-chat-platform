package sandbox

import "testing"

func TestRunRequestValidate(t *testing.T) {
	ok := RunRequest{RepoURL: "https://github.com/o/r.git", BaseBranch: "main", Intent: "x", Branch: "feature/x"}
	if err := ok.Validate(); err != nil {
		t.Fatalf("valid request rejected: %v", err)
	}
	bad := []RunRequest{
		{}, // empty
		{RepoURL: "ftp://x/y", BaseBranch: "main", Intent: "x", Branch: "b"},            // scheme
		{RepoURL: "https://h/r", BaseBranch: "main", Intent: "x", Branch: "-rf"},        // leading dash
		{RepoURL: "https://h/r", BaseBranch: "ma in", Intent: "x", Branch: "b"},         // whitespace
		{RepoURL: "https://h/r", BaseBranch: "main", Intent: "x", Branch: "a;rm -rf /"}, // shell meta
		{RepoURL: "https://h/r", BaseBranch: "main", Intent: "", Branch: "b"},           // no intent
		{RepoURL: "-oProxyCommand=evil", BaseBranch: "main", Intent: "x", Branch: "b"},  // repoUrl leading dash (arg injection)
		{RepoURL: "https:///r", BaseBranch: "main", Intent: "x", Branch: "b"},           // hostless https
	}
	for i, r := range bad {
		if err := r.Validate(); err == nil {
			t.Fatalf("bad request %d accepted: %+v", i, r)
		}
	}
}

func TestRunRequestValidateFileSchemeGated(t *testing.T) {
	r := RunRequest{RepoURL: "file:///tmp/repo", BaseBranch: "main", Intent: "x", Branch: "b"}
	// Default (prod): file:// is rejected.
	if err := r.Validate(); err == nil {
		t.Fatal("file:// accepted without ACP_ALLOW_FILE_REPO")
	}
	// Opt-in (tests/dev): file:// allowed.
	t.Setenv("ACP_ALLOW_FILE_REPO", "1")
	if err := r.Validate(); err != nil {
		t.Fatalf("file:// rejected even with ACP_ALLOW_FILE_REPO=1: %v", err)
	}
}
