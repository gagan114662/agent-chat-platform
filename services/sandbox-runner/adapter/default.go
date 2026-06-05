package adapter

// DefaultRegistry returns the built-in adapter catalog (first-party adapters).
func DefaultRegistry() *Registry {
	r := NewRegistry()
	_ = r.Register("fake", func() Adapter { return NewFakeAdapter() })
	_ = r.Register("claude-code", func() Adapter { return NewClaudeCodeAdapter() })
	_ = r.Register("codex", func() Adapter { return NewCodexAdapter() })
	// Generic CLI-factory adapters (#91): cursor/devin/openclaw/hermes. Each
	// reuses the SAME shared hardening (quarantine #49, skills #48, env-scrub,
	// prompt bound, model/provider #58) via the package-level helpers; they
	// differ only in binary + argv + Identify name. All non-fake → default-deny
	// authorized (#38) via adapterAuthorized.
	_ = r.Register("cursor", func() Adapter { return newCLIAdapter("cursor", "cursor-agent", cursorArgs) })
	_ = r.Register("devin", func() Adapter { return newCLIAdapter("devin", "devin", devinArgs) })
	_ = r.Register("openclaw", func() Adapter { return newCLIAdapter("openclaw", "openclaw", openclawArgs) })
	_ = r.Register("hermes", func() Adapter { return newCLIAdapter("hermes", "hermes", hermesArgs) })
	return r
}
