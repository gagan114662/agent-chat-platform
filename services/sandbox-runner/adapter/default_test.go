package adapter

import "testing"

func TestDefaultRegistry(t *testing.T) {
	r := DefaultRegistry()
	for _, name := range []string{"fake", "claude-code"} {
		f, ok := r.Get(name)
		if !ok {
			t.Fatalf("expected %q registered", name)
		}
		if f().Identify().Name != name {
			t.Fatalf("factory for %q built wrong adapter", name)
		}
	}
}
