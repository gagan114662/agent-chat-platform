package mcprbac

import "testing"

func TestDefaultRoleTiers(t *testing.T) {
	p := DefaultPolicy()
	cases := []struct {
		role, tier string
		want       bool
	}{
		{"admin", "safe", true}, {"admin", "sensitive", true}, {"admin", "money", true},
		{"member", "safe", true}, {"member", "sensitive", true}, {"member", "money", false},
		{"viewer", "safe", true}, {"viewer", "sensitive", false}, {"viewer", "money", false},
	}
	for _, c := range cases {
		if got := p.Allowed(c.role, c.tier); got != c.want {
			t.Fatalf("Allowed(%q,%q)=%v want %v", c.role, c.tier, got, c.want)
		}
	}
}

func TestDenyByDefaultForUnknownRoleOrTier(t *testing.T) {
	p := DefaultPolicy()
	if p.Allowed("", "safe") {
		t.Fatal("empty role must be denied")
	}
	if p.Allowed("stranger", "safe") {
		t.Fatal("unknown role must be denied")
	}
	if p.Allowed("admin", "nuclear") {
		t.Fatal("unknown tier must be denied")
	}
}
