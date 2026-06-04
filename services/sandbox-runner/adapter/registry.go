package adapter

import (
	"fmt"
	"sort"
	"sync"
)

// Factory builds a fresh Adapter instance.
type Factory func() Adapter

// Registry maps adapter names to factories (the published catalog).
type Registry struct {
	mu sync.RWMutex
	m  map[string]Factory
}

func NewRegistry() *Registry { return &Registry{m: map[string]Factory{}} }

func (r *Registry) Register(name string, f Factory) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, exists := r.m[name]; exists {
		return fmt.Errorf("adapter %q already registered", name)
	}
	r.m[name] = f
	return nil
}

func (r *Registry) Get(name string) (Factory, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	f, ok := r.m[name]
	return f, ok
}

func (r *Registry) List() []string {
	r.mu.RLock()
	defer r.mu.RUnlock()
	names := make([]string, 0, len(r.m))
	for n := range r.m {
		names = append(names, n)
	}
	sort.Strings(names)
	return names
}
