package adapter

import (
	"context"
	"testing"
)

type stubAdapter struct{}

func (stubAdapter) Identify() Identity                              { return Identity{Name: "stub", Version: "0.0.1"} }
func (stubAdapter) Prepare(context.Context, PrepareContext) error   { return nil }
func (stubAdapter) Run(context.Context, string, string, Emit) error { return nil }
func (stubAdapter) ApplyFeedback(context.Context, string, Emit) error {
	return nil
}
func (stubAdapter) Teardown(context.Context) error { return nil }

func TestRegistry(t *testing.T) {
	r := NewRegistry()
	if err := r.Register("stub", func() Adapter { return stubAdapter{} }); err != nil {
		t.Fatal(err)
	}
	if err := r.Register("stub", func() Adapter { return stubAdapter{} }); err == nil {
		t.Fatal("expected duplicate-registration error")
	}
	f, ok := r.Get("stub")
	if !ok {
		t.Fatal("expected to find stub")
	}
	if f().Identify().Name != "stub" {
		t.Fatal("factory built wrong adapter")
	}
	if _, ok := r.Get("missing"); ok {
		t.Fatal("unexpected hit")
	}
	if len(r.List()) != 1 || r.List()[0] != "stub" {
		t.Fatalf("unexpected list: %v", r.List())
	}
}
