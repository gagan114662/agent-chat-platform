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
	}
	for i, r := range bad {
		if err := r.Validate(); err == nil {
			t.Fatalf("bad request %d accepted: %+v", i, r)
		}
	}
}
