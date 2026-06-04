package adapter

// DefaultRegistry returns the built-in adapter catalog (first-party adapters).
func DefaultRegistry() *Registry {
	r := NewRegistry()
	_ = r.Register("fake", func() Adapter { return NewFakeAdapter() })
	_ = r.Register("claude-code", func() Adapter { return NewClaudeCodeAdapter() })
	return r
}
